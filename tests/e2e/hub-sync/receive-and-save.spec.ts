import { DatabaseSync } from 'node:sqlite';
import { test as base, expect } from '../fixtures.ts';
import {
  createStats,
  isExpired,
  PERIODS,
  startFakeHub,
  type FakeHub,
  type FakeStats,
} from './fake-hub.ts';

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
    const hub = await startFakeHub('silent-secret-token', createStats(3), { sendSnapshot: false });
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

// 保存処理とは別の読み取り専用接続で読む。アプリの移行・保存中はロックの解放を待つ。
function query<T>(databasePath: string, sql: string, ...params: (string | number)[]): T[] {
  const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

function receivedAt(databasePath: string, hubId: string): string | undefined {
  return query<{ received_at: string }>(
    databasePath,
    'SELECT received_at FROM hub_states WHERE hub_id = ?',
    hubId,
  )[0]?.received_at;
}

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

// 通知配信APIを購読し、受け取った合図を記録する。
async function watchEvents(url: string) {
  const controller = new AbortController();
  const response = await fetch(`${url}/api/events`, { signal: controller.signal });
  const events: { event: string; data: string }[] = [];
  let raw = '';
  void (async () => {
    const decoder = new TextDecoder();
    const reader = response.body!.getReader();
    try {
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        raw += decoder.decode(chunk.value, { stream: true });
        let end;
        while ((end = raw.indexOf('\n\n')) >= 0) {
          const block = raw.slice(0, end);
          raw = raw.slice(end + 2);
          const field = (name: string) =>
            block
              .split('\n')
              .find((line) => line.startsWith(`${name}: `))
              ?.slice(name.length + 2) ?? '';
          events.push({ event: field('event'), data: field('data') });
        }
      }
    } catch {
      // 購読の終了による中断。
    }
  })();
  return {
    response,
    events,
    changed: () => events.filter((item) => item.event === 'overview.changed').length,
    close: () => controller.abort(),
  };
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
  const db = app.databasePath;

  // --- snapshot: 受信したHubごとに受信データとドメインモデルを保存する
  await expect
    .poll(() => [receivedAt(db, 'alpha'), receivedAt(db, 'beta')].every(Boolean))
    .toBe(true);
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
      { updated_at: hub.stats.updatedAt, active_days: hub.stats.historyPreview.summary.activeDays },
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
    expect(usageDevices(db, hubId, 'month')).toEqual([active.deviceId, todayExpired.deviceId]);
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

  // --- freshness: 時刻・鮮度情報だけを更新し、利用量と上限は維持する
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
  await expect.poll(() => watcher.changed()).toBeGreaterThan(changedAfterStats);
  const fresh = JSON.parse(
    query<{ stats_json: string }>(
      db,
      'SELECT stats_json FROM hub_states WHERE hub_id = ?',
      'alpha',
    )[0].stats_json,
  );
  expect(fresh).toEqual({
    ...next,
    updatedAt: freshAt,
    staleAfterMs: 123_456,
    limits: { ...next.limits, updatedAt: freshAt },
    devices: [
      { ...next.devices[0], updatedAt: freshAt, receivedAt: freshAt, ageMs: 0, stale: true },
      ...next.devices.slice(1),
    ],
  });
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
  expect(periodTotals(db, 'alpha')).toEqual(expectedTotals(next));
  expect(meters(db, 'alpha')).toEqual(statsMeters);

  // heartbeat を受けたHubは、その後も状態が変わっていない。
  expect(receivedAt(db, 'beta')).toBe(betaReceivedAt);
  expect(receivedAt(db, 'silent')).toBeUndefined();
  expect(silent.connected).toBe(1);

  // --- snapshot: 接続後に初めて全体状態を受けたHubも、保存確定で通知する
  const changedAfterFreshness = watcher.changed();
  silent.send('snapshot', silent.stats);
  await expect.poll(() => receivedAt(db, 'silent')).toBeTruthy();
  await expect.poll(() => watcher.changed()).toBeGreaterThan(changedAfterFreshness);

  // 合図には利用データを含めない。
  watcher.close();
  expect(new Set(watcher.events.map((item) => item.data))).toEqual(new Set(['{}']));

  // --- 共通の受け入れ条件: 失敗したHubは他のHubの受信とWebサーバーへ波及しない
  expect((await request.get('/health')).status()).toBe(200);
  expect(beta.connected).toBe(1);

  // --- 共通の受け入れ条件: URLと認証トークンをDBとログに含めない
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
  const tables = query<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table'");
  const dump = JSON.stringify(tables.map(({ name }) => query(db, `SELECT * FROM "${name}"`)));
  for (const secret of secrets) {
    expect(dump).not.toContain(secret);
    expect(JSON.stringify(watcher.events)).not.toContain(secret);
    expect(app.output).not.toContain(secret);
  }
});
