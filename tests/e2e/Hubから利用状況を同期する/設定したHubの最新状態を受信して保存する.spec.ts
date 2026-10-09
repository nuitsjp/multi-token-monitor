import { DatabaseSync } from 'node:sqlite';
import { test as base, expect } from '../fixtures.ts';
import {
  createStats,
  isExpired,
  PERIODS,
  startFakeHub,
  withDaily,
  type FakeHub,
  type FakeStats,
} from '../hub-sync/fake-hub.ts';
import { connected, query, receivedAt, statsJson, watchEvents } from '../hub-sync/sync.ts';

base.describe(() => {
  // 主成功シナリオ「設定したHubの最新状態を受信して保存する」と、ユースケース共通の受け入れ条件を検証する。
  const test = base.extend<{ alpha: FakeHub; beta: FakeHub; silent: FakeHub }>({
    // eslint-disable-next-line no-empty-pattern -- Playwrightは依存のないfixtureにも分割代入を要求する
    alpha: async ({}, use) => {
      const hub = await startFakeHub('alpha-secret-token', createStats(1));
      await use(hub);
      await hub.close();
    },
    // eslint-disable-next-line no-empty-pattern
    beta: async ({}, use) => {
      const hub = await startFakeHub('beta-secret-token', createStats(2));
      await use(hub);
      await hub.close();
    },
    // eslint-disable-next-line no-empty-pattern
    silent: async ({}, use) => {
      const hub = await startFakeHub('silent-secret-token', createStats(3), {
        sendSnapshot: false,
      });
      await use(hub);
      await hub.close();
    },
    hubs: async ({ alpha, beta, silent }, use) => {
      await use([
        { id: 'alpha', name: 'Alpha Hub', url: alpha.url, token: alpha.token },
        { id: 'beta', name: 'Beta Hub', url: beta.url, token: beta.token },
        { id: 'silent', name: 'Silent Hub', url: silent.url, token: silent.token },
        // 認証に失敗するHub。他のHubとWebサーバーへ波及しないことだけを確かめる。
        { id: 'rejected', name: 'Rejected Hub', url: alpha.url, token: 'rejected-secret-token' },
      ]);
    },
  });
  test.use({ serveFrontend: false });

  const PERIOD_KEYS = { today: 'today', month: 'month', allTime: 'all_time' } as const;

  function periodTotals(databasePath: string, hubId: string) {
    const rows = query<{ period: string; tokens: number }>(
      databasePath,
      'SELECT period, SUM(tokens) AS tokens FROM latest_token_usages WHERE hub_id = ? GROUP BY period',
      hubId,
    );
    return Object.fromEntries(rows.map((row) => [row.period, row.tokens]));
  }

  function expectedTotals(stats: FakeStats) {
    return Object.fromEntries(
      PERIODS.map((name) => [PERIOD_KEYS[name], stats.periods[name].totalTokens]),
    );
  }

  function usageDevices(databasePath: string, hubId: string, period: string) {
    return query<{ device_id: string }>(
      databasePath,
      'SELECT DISTINCT device_id FROM latest_token_usages WHERE hub_id = ? AND period = ? ORDER BY device_id',
      hubId,
      period,
    ).map((row) => row.device_id);
  }

  function meters(databasePath: string, hubId: string) {
    return query<{ limit_key: string; remaining_percent: number; meter_changed_at: string }>(
      databasePath,
      'SELECT limit_key, remaining_percent, meter_changed_at FROM latest_limit_windows WHERE hub_id = ? ORDER BY limit_key',
      hubId,
    );
  }

  test('設定した全Hubから独立して受信し、最新状態を別のDB接続からHubごとに読める', async ({
    app,
    request,
    alpha,
    beta,
    silent,
  }) => {
    const { db } = await test.step('開始条件', async () => {
      const db = app.databasePath;
      await expect
        .poll(() => [receivedAt(db, 'alpha'), receivedAt(db, 'beta')].every(Boolean))
        .toBe(true);

      return { db };
    });

    await test.step('手順1', async () => {
      // --- snapshot: 受信したHubごとに受信データとドメインモデルを保存する
      await expect.poll(() => alpha.rejected).toBeGreaterThan(0);
      await expect.poll(() => silent.connected).toBe(1);

      // 未受信のHubも含めて、全HubをIDと表示名で識別できる。
      expect(query(db, 'SELECT hub_id, name FROM hubs ORDER BY hub_id')).toEqual([
        { hub_id: 'alpha', name: 'Alpha Hub' },
        { hub_id: 'beta', name: 'Beta Hub' },
        { hub_id: 'rejected', name: 'Rejected Hub' },
        { hub_id: 'silent', name: 'Silent Hub' },
      ]);
      expect(query(db, 'SELECT hub_id FROM hub_states ORDER BY hub_id')).toEqual([
        { hub_id: 'alpha' },
        { hub_id: 'beta' },
      ]);
    });

    const { watcher, betaReceivedAt, alphaSnapshotAt, snapshotMeters } =
      await test.step('手順2', async () => {
        for (const [hubId, hub] of [
          ['alpha', alpha],
          ['beta', beta],
        ] as const) {
          const [active, todayExpired, withoutWindows] = hub.stats.devices;
          const stored = query<{ stats_json: string }>(
            db,
            'SELECT stats_json FROM hub_states WHERE hub_id = ?',
            hubId,
          )[0];
          expect(JSON.parse(stored.stats_json)).toEqual(hub.stats);
          expect(
            query(db, 'SELECT updated_at, active_days FROM hub_summaries WHERE hub_id = ?', hubId),
          ).toEqual([
            {
              updated_at: hub.stats.updatedAt,
              active_days: hub.stats.historyPreview.summary.activeDays,
            },
          ]);
          expect(
            query(
              db,
              'SELECT device_id, hostname, stale FROM devices WHERE hub_id = ? ORDER BY device_id',
              hubId,
            ),
          ).toEqual(
            hub.stats.devices.map((device) => ({
              device_id: device.deviceId,
              hostname: device.hostname,
              stale: 0,
            })),
          );
          // 期間別の合計はHubの totalTokens（期限切れの端末分を除いた値）と一致する。
          expect(periodTotals(db, hubId)).toEqual(expectedTotals(hub.stats));
          // 期限切れの today・month は利用実績に含めない。
          expect(isExpired(todayExpired, 'today', Date.now())).toBe(true);
          expect(isExpired(withoutWindows, 'month', Date.now())).toBe(true);
          expect(usageDevices(db, hubId, 'today')).toEqual([active.deviceId]);
          expect(usageDevices(db, hubId, 'month')).toEqual([
            active.deviceId,
            todayExpired.deviceId,
          ]);
          expect(usageDevices(db, hubId, 'all_time')).toEqual(
            hub.stats.devices.map((device) => device.deviceId),
          );
          // メーターを表示する枠だけを保持する。
          expect(
            meters(db, hubId).map(({ limit_key, remaining_percent }) => ({
              limit_key,
              remaining_percent,
            })),
          ).toEqual([
            { limit_key: 'Weekly', remaining_percent: 60 },
            { limit_key: 'codex', remaining_percent: 90 },
          ]);
        }

        // 以後の保存確定を、閲覧側の通知の受け口で受け取る。
        const watcher = await watchEvents(app.url);
        expect(watcher.response.headers.get('content-type')).toBe('text/event-stream');
        await expect.poll(() => watcher.events.map((item) => item.event)).toEqual(['ready']);

        // --- heartbeat では保存も通知もしない
        const betaReceivedAt = receivedAt(db, 'beta');
        beta.heartbeat();
        silent.heartbeat();
        // 通知が来ないことを確かめるため、heartbeat の処理に十分な時間だけ待つ。
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(watcher.changed()).toBe(0);
        const alphaSnapshotAt = receivedAt(db, 'alpha')!;
        const snapshotMeters = meters(db, 'alpha');

        return { watcher, betaReceivedAt, alphaSnapshotAt, snapshotMeters };
      });

    const { next, changedAfterStats, alphaStatsAt } = await test.step('手順3', async () => {
      // --- stats: 当該Hubの最新状態を全体置換する
      const next = structuredClone(alpha.stats);
      next.updatedAt = new Date().toISOString();
      next.devices[0].periods.today.clientModels.codex['gpt-5'] += 1000;
      next.devices[0].periods.month.clientModels.codex['gpt-5'] += 1000;
      next.devices[0].periods.allTime.clientModels.codex['gpt-5'] += 1000;
      for (const name of PERIODS) next.periods[name].totalTokens += 1000;
      const session = next.limits.providers[0].windows[0];
      session.remainingPercent = 80;
      session.usedPercent = 20;
      alpha.send('stats', next);

      await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(alphaSnapshotAt);
      await expect.poll(() => watcher.changed()).toBeGreaterThan(0);
      const changedAfterStats = watcher.changed();
      const alphaStatsAt = receivedAt(db, 'alpha')!;
      expect(periodTotals(db, 'alpha')).toEqual(expectedTotals(next));
      expect(query(db, 'SELECT updated_at FROM hub_summaries WHERE hub_id = ?', 'alpha')).toEqual([
        { updated_at: next.updatedAt },
      ]);
      // 残量が変わった枠だけ meter_changed_at を今回の受信時刻にし、変わらない枠は引き継ぐ。
      const snapshotWeekly = snapshotMeters.find((meter) => meter.limit_key === 'Weekly')!;
      expect(meters(db, 'alpha')).toEqual([
        {
          limit_key: 'Weekly',
          remaining_percent: 60,
          meter_changed_at: snapshotWeekly.meter_changed_at,
        },
        { limit_key: 'codex', remaining_percent: 80, meter_changed_at: alphaStatsAt },
      ]);

      return { next, changedAfterStats, alphaStatsAt };
    });

    await test.step('手順4', async () => {
      // --- freshness: 時刻・鮮度情報だけを更新し、利用量と利用枠、受信データは維持する
      const statsMeters = meters(db, 'alpha');
      const freshAt = new Date().toISOString();
      alpha.send('freshness', {
        updatedAt: freshAt,
        staleAfterMs: 123_456,
        limits: { updatedAt: freshAt },
        devices: [
          {
            deviceId: next.devices[0].deviceId,
            updatedAt: freshAt,
            receivedAt: freshAt,
            ageMs: 0,
            stale: true,
          },
        ],
      });

      await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(alphaStatsAt);
      expect(watcher.changed()).toBe(changedAfterStats);
      const fresh = JSON.parse(
        query<{ stats_json: string }>(
          db,
          'SELECT stats_json FROM hub_states WHERE hub_id = ?',
          'alpha',
        )[0].stats_json,
      );
      expect(fresh).toEqual(next);
      expect(query(db, 'SELECT updated_at FROM hub_summaries WHERE hub_id = ?', 'alpha')).toEqual([
        { updated_at: freshAt },
      ]);
      expect(
        query(
          db,
          'SELECT device_id, updated_at, stale FROM devices WHERE hub_id = ? AND device_id = ?',
          'alpha',
          next.devices[0].deviceId,
        ),
      ).toEqual([{ device_id: next.devices[0].deviceId, updated_at: freshAt, stale: 1 }]);
      // 通知に含まれない端末の時刻と古さは変えない。
      expect(
        query(
          db,
          'SELECT device_id, updated_at, stale FROM devices WHERE hub_id = ? AND device_id <> ? ORDER BY device_id',
          'alpha',
          next.devices[0].deviceId,
        ),
      ).toEqual(
        next.devices.slice(1).map((device) => ({
          device_id: device.deviceId,
          updated_at: device.updatedAt,
          stale: 0,
        })),
      );
      expect(periodTotals(db, 'alpha')).toEqual(expectedTotals(next));
      expect(meters(db, 'alpha')).toEqual(statsMeters);
      // 時刻の更新は変更の合図とは別の種別で受け取り、Hub ID・時刻・古さだけを含む。
      await expect
        .poll(() => watcher.events.filter((item) => item.event === 'hub.freshness').length)
        .toBe(1);
      const freshness = watcher.events.find((item) => item.event === 'hub.freshness')!;
      expect(JSON.parse(freshness.data)).toEqual({
        hubId: 'alpha',
        receivedAt: receivedAt(db, 'alpha'),
        updatedAt: freshAt,
        devices: [{ deviceId: next.devices[0].deviceId, updatedAt: freshAt, stale: true }],
      });

      // heartbeat を受けたHubは、その後も状態が変わっていない。
      expect(receivedAt(db, 'beta')).toBe(betaReceivedAt);
      expect(receivedAt(db, 'silent')).toBeUndefined();
      expect(silent.connected).toBe(1);
    });

    await test.step('手順2', async () => {
      // --- snapshot: 接続後に初めて全体状態を受けたHubも、保存確定で通知する
      const changedAfterFreshness = watcher.changed();
      silent.send('snapshot', silent.stats);
      await expect.poll(() => receivedAt(db, 'silent')).toBeTruthy();
      await expect.poll(() => watcher.changed()).toBeGreaterThan(changedAfterFreshness);
    });

    await test.step('受け入れ条件', async () => {
      // 変更の合図には利用データを含めない。
      watcher.close();
      expect(
        new Set(
          watcher.events.filter((item) => item.event !== 'hub.freshness').map((item) => item.data),
        ),
      ).toEqual(new Set(['{}']));

      // --- 共通の受け入れ条件: 失敗したHubは他のHubの受信とWebサーバーへ波及しない
      expect((await request.get('/health')).status()).toBe(200);
      expect(beta.connected).toBe(1);

      // --- 共通の受け入れ条件: URLと認証トークンを登録情報（hubs）の外、通知、ログに含めない
      const secrets = [
        alpha.url,
        beta.url,
        silent.url,
        ...[alpha, beta, silent].map((hub) => new URL(hub.url).host),
        alpha.token,
        beta.token,
        silent.token,
        'rejected-secret-token',
      ];
      const tables = query<{ name: string }>(
        db,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'hubs'",
      );
      const dump = JSON.stringify(tables.map(({ name }) => query(db, `SELECT * FROM "${name}"`)));
      for (const secret of secrets) {
        expect(dump).not.toContain(secret);
        expect(JSON.stringify(watcher.events)).not.toContain(secret);
        expect(app.output).not.toContain(secret);
      }
    });

    await test.step('手順5', async () => {
      await app.stop();
      await expect
        .poll(() => [alpha.connected, beta.connected, silent.connected])
        .toEqual([0, 0, 0]);
    });
  });

  interface WindowRow {
    limit_key: string;
    resets_at: string | null;
    remaining_percent: number;
    meter_changed_at: string;
  }

  function windows(databasePath: string, hubId: string) {
    return query<WindowRow>(
      databasePath,
      'SELECT limit_key, resets_at, remaining_percent, meter_changed_at FROM latest_limit_windows WHERE hub_id = ? ORDER BY limit_key',
      hubId,
    );
  }

  test('報告されなくなった利用枠は次のリセット時刻まで最後の値を保持し、再び報告されたら最新値へ更新する', async ({
    app,
    alpha,
  }) => {
    const db = app.databasePath;
    await test.step('開始条件', async () => {
      await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
    });

    let stats = alpha.stats;
    const original = structuredClone(stats.limits.providers[0].windows);
    // stats を送り、保存を待って受信時刻を返す。
    const send = async (change: (value: FakeStats) => void) => {
      const before = receivedAt(db, 'alpha');
      stats = structuredClone(stats);
      change(stats);
      alpha.send('stats', stats);
      await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);
      return receivedAt(db, 'alpha')!;
    };
    // メーターを表示する枠をすべて報告から外す（契約は報告に残る）。
    const unreport = (value: FakeStats) => {
      value.limits.providers[0].windows = original.filter((window) => !window.showMeter);
    };
    // 元の枠を、Session の残量とリセット時刻を指定して報告する。
    const report = (remaining: number, resetsAt?: string) => (value: FakeStats) => {
      const windows = structuredClone(original);
      windows[0].remainingPercent = remaining;
      windows[0].usedPercent = 100 - remaining;
      if (resetsAt) windows[0].resetsAt = resetsAt;
      value.limits.providers[0].windows = windows;
    };
    const row = (limitKey: string) =>
      windows(db, 'alpha').find((item) => item.limit_key === limitKey);
    const count = (table: string) =>
      query<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${table} WHERE hub_id = 'alpha'`)[0].n;
    // 閲覧側が読む利用枠の一覧。
    const shown = async () => {
      const overview = (await (await fetch(`${app.url}/api/overview`)).json()) as {
        limitWindows: { hubId: string; limitKey: string; remainingPercent: number }[];
      };
      return overview.limitWindows
        .filter((window) => window.hubId === 'alpha')
        .map((window) => `${window.limitKey}:${window.remainingPercent}`)
        .sort();
    };

    const first = await test.step('手順2', async () => {
      // --- snapshot で、Session（リセット時刻あり）と Weekly（リセット時刻なし）の最新値を保存する
      const session = row('codex')!;
      expect(session.remaining_percent).toBe(90);
      expect(row('Weekly')!.remaining_percent).toBe(60);
      expect(await shown()).toEqual(['Weekly:60', 'codex:90']);
      return { session };
    });

    await test.step('手順3', async () => {
      // --- 報告から外れた枠は、次のリセット時刻より前なら、最後の値のまま残る。
      // リセット時刻を持たない枠は、報告されなくなった保存で消える。契約は消えない。
      await send((value) => {
        unreport(value);
        value.devices[0].periods.allTime.clientModelCosts.codex['gpt-5'] += 1;
      });
      expect(row('codex')).toMatchObject({
        remaining_percent: 90,
        meter_changed_at: first.session.meter_changed_at,
        resets_at: first.session.resets_at,
      });
      expect(row('Weekly')).toBeUndefined();
      expect(count('hub_accounts')).toBe(1);
      // 保持している枠は、報告中と同じように一覧に含まれる。
      expect(await shown()).toEqual(['codex:90']);
    });

    await test.step('手順3', async () => {
      // --- 再び報告された枠は、残量とメーター更新時刻を最新値へ更新する
      const at = await send(report(85));
      expect(row('codex')).toMatchObject({
        remaining_percent: 85,
        meter_changed_at: at,
      });
      // 消えていた Weekly は、新しい枠として最新値を保存する。
      expect(row('Weekly')).toMatchObject({ meter_changed_at: at, remaining_percent: 60 });
    });

    await test.step('手順3', async () => {
      // --- 外れている間に残量が増えた枠も、再び報告された受信で最新値へ更新する
      await send(unreport);
      const at = await send(report(95));
      expect(row('codex')).toMatchObject({
        remaining_percent: 95,
        meter_changed_at: at,
      });
    });

    await test.step('手順3', async () => {
      // --- 報告されなくなった枠は、最後に記録した次のリセット時刻を過ぎた保存で消える
      const resetsAt = Date.now() + 3000;
      await send(report(95, new Date(resetsAt).toISOString()));
      await send(unreport);
      expect(row('codex')).toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, resetsAt - Date.now() + 200));
      await send(unreport);
      expect(row('codex')).toBeUndefined();
    });

    await test.step('受け入れ条件', async () => {
      // 枠がすべて消えても、契約は報告されなくなっただけでは消えず、一覧には出ない。
      expect(count('hub_accounts')).toBe(1);
      expect(count('latest_limit_windows')).toBe(0);
      expect(await shown()).toEqual([]);
    });
  });

  test('freshnessは保存済みの状態を読まずに、時刻と古さだけを更新する', async ({ app, alpha }) => {
    const { db } = await test.step('開始条件', async () => {
      const db = app.databasePath;
      await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();

      return { db };
    });

    const { snapshotAt } = await test.step('手順2', async () => {
      const snapshotAt = receivedAt(db, 'alpha');

      // 保存済みの受信データを、freshnessを適用できない内容に書き換える。
      // 保存済みの状態を読んで適用する実装なら、保存に失敗して再接続し、snapshotで置き換わる。
      const writer = new DatabaseSync(db, { timeout: 5000 });
      try {
        writer.prepare("UPDATE hub_states SET stats_json = '{}' WHERE hub_id = ?").run('alpha');
      } finally {
        writer.close();
      }

      return { snapshotAt };
    });

    await test.step('手順4', async () => {
      const [device] = alpha.stats.devices;
      const freshAt = new Date().toISOString();
      alpha.send('freshness', {
        updatedAt: freshAt,
        staleAfterMs: 123_456,
        limits: { updatedAt: freshAt },
        devices: [
          {
            deviceId: device.deviceId,
            updatedAt: freshAt,
            receivedAt: freshAt,
            ageMs: 0,
            stale: true,
          },
        ],
      });

      await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(snapshotAt);
      expect(statsJson(db, 'alpha')).toBe('{}');
      expect(connected(db, 'alpha')).toBe(1);
      expect(query(db, 'SELECT updated_at FROM hub_summaries WHERE hub_id = ?', 'alpha')).toEqual([
        { updated_at: freshAt },
      ]);
      expect(
        query(
          db,
          'SELECT updated_at, stale FROM devices WHERE hub_id = ? AND device_id = ?',
          'alpha',
          device.deviceId,
        ),
      ).toEqual([{ updated_at: freshAt, stale: 1 }]);
    });
  });
});
base.describe(() => {
  // 主成功シナリオ「設定したHubの最新状態を受信して保存する」と、拡張シナリオ「保存済みの状態があるまま再起動する」のうち、
  // 日別の集計行を日付ごとに蓄積する条件を検証する。
  const test = base.extend<{ alpha: FakeHub }>({
    // eslint-disable-next-line no-empty-pattern -- Playwrightは依存のないfixtureにも分割代入を要求する
    alpha: async ({}, use) => {
      const stats = withDaily(createStats(1), [
        { date: '2026-09-01', tokens: 100, cost: 1.5 },
        { date: '2026-09-02', tokens: 200 },
      ]);
      const hub = await startFakeHub('alpha-secret-token', stats);
      await use(hub);
      await hub.close();
    },
    hubs: async ({ alpha }, use) => {
      await use([{ id: 'alpha', name: 'Alpha Hub', url: alpha.url, token: alpha.token }]);
    },
  });
  test.use({ serveFrontend: false });

  function days(databasePath: string) {
    return query<{ date: string; tokens: number; cost_usd: number | null }>(
      databasePath,
      "SELECT date, tokens, cost_usd FROM daily_token_usages WHERE hub_id = 'alpha' ORDER BY date",
    );
  }

  // 保存の確定を、受信時刻の更新で待つ。
  async function sendStats(hub: FakeHub, db: string, stats: FakeStats) {
    const before = receivedAt(db, 'alpha');
    hub.send('stats', stats);
    await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);
  }

  test('日別の集計行は受け取った日付だけを上書きまたは追加し、他の日付の行と再起動前の蓄積を残す', async ({
    app,
    alpha,
  }) => {
    const { db } = await test.step('開始条件', async () => {
      test.setTimeout(60_000);
      const db = app.databasePath;
      await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();

      return { db };
    });

    await test.step('手順2', async () => {
      // 最初の全体状態の日別が保存される。
      expect(days(db)).toEqual([
        { date: '2026-09-01', tokens: 100, cost_usd: 1.5 },
        { date: '2026-09-02', tokens: 200, cost_usd: null },
      ]);
    });

    const { accumulated } = await test.step('手順3', async () => {
      // 履歴に無い古い日付は残り、受け取った日付は上書き・追加される。
      const update = () =>
        withDaily(createStats(1), [
          { date: '2026-09-02', tokens: 250, cost: 2 },
          { date: '2026-09-03', tokens: 300 },
        ]);
      await sendStats(alpha, db, update());
      const accumulated = [
        { date: '2026-09-01', tokens: 100, cost_usd: 1.5 },
        { date: '2026-09-02', tokens: 250, cost_usd: 2 },
        { date: '2026-09-03', tokens: 300, cost_usd: null },
      ];
      expect(days(db)).toEqual(accumulated);

      // 同じ状態を2回受信しても、トークン数は変わらない。
      await sendStats(alpha, db, update());
      expect(days(db)).toEqual(accumulated);

      // 日別の履歴を含まない受信では、保存済みの行が消えない。
      await sendStats(alpha, db, createStats(1));
      expect(days(db)).toEqual(accumulated);

      return { accumulated };
    });

    await test.step('手順5', async () => {
      // 再起動後、Hubから受信する前でも、蓄積した行を読める。
      alpha.sendSnapshot = false;
      await app.stop();
    });

    await test.step('手順1', async () => {
      await app.start();
      await expect.poll(() => alpha.connected).toBe(1);
      expect(days(db)).toEqual(accumulated);
    });

    await test.step('手順2', async () => {
      // 再起動後の最初の全体状態は、受け取った日付だけを上書きし、他の日付の行を消さない。
      alpha.stats = withDaily(createStats(1), [{ date: '2026-09-03', tokens: 400 }]);
      alpha.sendSnapshot = true;
      const before = receivedAt(db, 'alpha');
      alpha.disconnect();
      await expect.poll(() => receivedAt(db, 'alpha'), { timeout: 15_000 }).not.toBe(before);
    });

    await test.step('受け入れ条件', async () => {
      expect(days(db)).toEqual([
        accumulated[0],
        accumulated[1],
        { date: '2026-09-03', tokens: 400, cost_usd: null },
      ]);
    });
  });
});
