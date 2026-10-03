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
import { connected, query, receivedAt, statsJson, watchEvents } from './sync.ts';

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

  // --- freshness: 時刻・鮮度情報だけを更新し、利用量と上限、受信データは維持する
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

  // --- snapshot: 接続後に初めて全体状態を受けたHubも、保存確定で通知する
  const changedAfterFreshness = watcher.changed();
  silent.send('snapshot', silent.stats);
  await expect.poll(() => receivedAt(db, 'silent')).toBeTruthy();
  await expect.poll(() => watcher.changed()).toBeGreaterThan(changedAfterFreshness);

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

interface Point {
  limit_key: string;
  resets_at: string | null;
  base_received_at: string;
  base_remaining_percent: number;
  base_cost_usd: number;
  remaining_percent: number;
  cost_usd: number;
}

function points(databasePath: string, hubId: string) {
  return query<Point>(
    databasePath,
    // 1つ目の計測点のコストは枠ごとの基準点の合計、2つ目は枠の提供元と同じツールの現在の累計（allTime）の合計。
    `SELECT
       w.limit_key, w.resets_at, w.base_received_at, w.base_remaining_percent, w.remaining_percent,
       (SELECT TOTAL(b.cost_usd) FROM limit_window_baseline_costs b
        WHERE b.hub_id = w.hub_id AND b.provider = w.provider AND b.account_key = w.account_key
          AND b.kind = w.kind AND b.limit_key = w.limit_key) AS base_cost_usd,
       (SELECT TOTAL(u.cost_usd) FROM latest_token_usages u
        WHERE u.hub_id = w.hub_id AND u.tool = w.provider AND u.period = 'all_time') AS cost_usd
     FROM latest_limit_windows w WHERE w.hub_id = ? ORDER BY w.limit_key`,
    hubId,
  );
}

// 枠の提供元（codex）と同じツールの、全端末の累計の推定コスト。
function codexCost(stats: FakeStats) {
  return stats.devices
    .flatMap((device) => Object.values(device.periods.allTime.clientModelCosts.codex ?? {}))
    .reduce((sum, cost) => sum + cost, 0);
}

test('利用枠ごとに計測点を2つだけ保持し、周期の区切りか使用率の減少で1つ目を記録し直す', async ({
  app,
  alpha,
}) => {
  const db = app.databasePath;
  await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
  const snapshotAt = receivedAt(db, 'alpha')!;
  let stats = alpha.stats;
  const session = (value: FakeStats) => value.limits.providers[0].windows[0];
  // 残量・リセット時刻・コストの増加を指定して stats を送り、保存を待つ。
  const send = async (remaining: number, resetsAt: string | null, cost: number) => {
    const before = receivedAt(db, 'alpha');
    stats = structuredClone(stats);
    session(stats).remainingPercent = remaining;
    session(stats).usedPercent = 100 - remaining;
    session(stats).resetsAt = resetsAt;
    stats.devices[0].periods.allTime.clientModelCosts.codex['gpt-5'] += cost;
    alpha.send('stats', stats);
    await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);
    return receivedAt(db, 'alpha')!;
  };
  const sessionPoint = () => points(db, 'alpha').find((row) => row.limit_key === 'codex')!;
  const expectPoint = (
    actual: Point,
    base: { at: string; remaining: number; cost: number },
    remaining: number,
    cost: number,
  ) => {
    expect(actual.base_received_at).toBe(base.at);
    expect(actual.base_remaining_percent).toBe(base.remaining);
    expect(actual.base_cost_usd).toBeCloseTo(base.cost, 9);
    expect(actual.remaining_percent).toBe(remaining);
    expect(actual.cost_usd).toBeCloseTo(cost, 9);
  };

  // --- snapshot: 新しい枠は、今回の受信を1つ目の計測点にする
  const first = { at: snapshotAt, remaining: 90, cost: codexCost(stats) };
  expectPoint(sessionPoint(), first, 90, first.cost);

  // --- stats を3回以上受けても、1つ目は最初の受信のまま、2つ目は最新の受信になる
  // リセット時刻の値だけが揺れても、前回のリセット時刻を過ぎていなければ同じ周期とする。
  const hour = Date.now() + 60 * 60 * 1000;
  await send(85, new Date(hour + 5).toISOString(), 1);
  await send(80, new Date(hour + 11).toISOString(), 2);
  expectPoint(sessionPoint(), first, 80, codexCost(stats));
  expect(sessionPoint().resets_at).toBe(new Date(hour + 11).toISOString());
  // リセット時刻が無い枠（Weekly）も、残量が減っていなければ1つ目を引き継ぐ。
  const weekly = points(db, 'alpha').find((row) => row.limit_key === 'Weekly')!;
  expectPoint(weekly, { ...first, remaining: 60 }, 60, codexCost(stats));

  // --- freshness では計測点を変えない
  const beforeFreshness = points(db, 'alpha');
  const statsAt = receivedAt(db, 'alpha');
  const freshAt = new Date().toISOString();
  alpha.send('freshness', {
    updatedAt: freshAt,
    staleAfterMs: 123_456,
    limits: { updatedAt: freshAt },
    devices: [],
  });
  await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(statsAt);
  expect(points(db, 'alpha')).toEqual(beforeFreshness);

  // --- 使用率が減った場合は、その受信を1つ目にする
  const decreasedAt = await send(82, new Date(hour + 11).toISOString(), 1);
  const decreased = { at: decreasedAt, remaining: 82, cost: codexCost(stats) };
  expectPoint(sessionPoint(), decreased, 82, decreased.cost);

  // --- 受信時刻が前回のリセット時刻を過ぎた場合は、その受信を1つ目にする
  // 過ぎる前の受信は、リセット時刻が変わっても1つ目を引き継ぐ。
  await send(80, new Date(Date.now() - 1000).toISOString(), 1);
  expectPoint(sessionPoint(), decreased, 80, codexCost(stats));
  const resetAt = await send(80, new Date(hour).toISOString(), 1);
  expectPoint(
    sessionPoint(),
    { at: resetAt, remaining: 80, cost: codexCost(stats) },
    80,
    codexCost(stats),
  );
});

test('freshnessは保存済みの状態を読まずに、時刻と古さだけを更新する', async ({ app, alpha }) => {
  const db = app.databasePath;
  await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
  const snapshotAt = receivedAt(db, 'alpha');

  // 保存済みの受信データを、freshnessを適用できない内容に書き換える。
  // 保存済みの状態を読んで適用する実装なら、保存に失敗して再接続し、snapshotで置き換わる。
  const writer = new DatabaseSync(db, { timeout: 5000 });
  try {
    writer.prepare("UPDATE hub_states SET stats_json = '{}' WHERE hub_id = ?").run('alpha');
  } finally {
    writer.close();
  }

  const [device] = alpha.stats.devices;
  const freshAt = new Date().toISOString();
  alpha.send('freshness', {
    updatedAt: freshAt,
    staleAfterMs: 123_456,
    limits: { updatedAt: freshAt },
    devices: [
      { deviceId: device.deviceId, updatedAt: freshAt, receivedAt: freshAt, ageMs: 0, stale: true },
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
