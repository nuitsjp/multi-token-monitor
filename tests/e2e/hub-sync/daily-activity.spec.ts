import { test as base, expect } from '../fixtures.ts';
import { createStats, startFakeHub, withDaily, type FakeHub, type FakeStats } from './fake-hub.ts';
import { query, receivedAt } from './sync.ts';

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
  test.setTimeout(60_000);
  const db = app.databasePath;
  await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();

  // 最初の全体状態の日別が保存される。
  expect(days(db)).toEqual([
    { date: '2026-09-01', tokens: 100, cost_usd: 1.5 },
    { date: '2026-09-02', tokens: 200, cost_usd: null },
  ]);

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

  // 再起動後、Hubから受信する前でも、蓄積した行を読める。
  alpha.sendSnapshot = false;
  await app.stop();
  await app.start();
  await expect.poll(() => alpha.connected).toBe(1);
  expect(days(db)).toEqual(accumulated);

  // 再起動後の最初の全体状態は、受け取った日付だけを上書きし、他の日付の行を消さない。
  alpha.stats = withDaily(createStats(1), [{ date: '2026-09-03', tokens: 400 }]);
  alpha.sendSnapshot = true;
  const before = receivedAt(db, 'alpha');
  alpha.disconnect();
  await expect.poll(() => receivedAt(db, 'alpha'), { timeout: 15_000 }).not.toBe(before);
  expect(days(db)).toEqual([
    accumulated[0],
    accumulated[1],
    { date: '2026-09-03', tokens: 400, cost_usd: null },
  ]);
});
