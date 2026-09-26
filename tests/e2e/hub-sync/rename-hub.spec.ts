import { test as base, expect } from '../fixtures.ts';
import { createStats, startFakeHub, type FakeHub } from './fake-hub.ts';
import { query, receivedAt, statsJson } from './sync.ts';

// 拡張シナリオ「表示名やURLを変えて再起動する」を検証する。
const test = base.extend<{ before: FakeHub; after: FakeHub }>({
  // eslint-disable-next-line no-empty-pattern -- Playwrightは依存のないfixtureにも分割代入を要求する
  before: async ({}, use) => {
    const hub = await startFakeHub('before-secret-token', createStats(1));
    await use(hub);
    await hub.close();
  },
  // eslint-disable-next-line no-empty-pattern
  after: async ({}, use) => {
    const hub = await startFakeHub('after-secret-token', createStats(4), { sendSnapshot: false });
    await use(hub);
    await hub.close();
  },
  hubs: async ({ before }, use) => {
    await use([{ id: 'alpha', name: 'Old Name', url: before.url, token: before.token }]);
  },
});
test.use({ serveFrontend: false });

function allTimeTokens(databasePath: string): number {
  return query<{ tokens: number }>(
    databasePath,
    "SELECT SUM(tokens) AS tokens FROM latest_token_usages WHERE period = 'all_time'",
  )[0].tokens;
}

test('同じIDで表示名とURLを変えると、新しい名前で読め、新しいURLの最初の全体状態で置き換える', async ({
  app,
  before,
  after,
}) => {
  const db = app.databasePath;
  await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
  const saved = { stats: statsJson(db, 'alpha'), receivedAt: receivedAt(db, 'alpha') };
  expect(allTimeTokens(db)).toBe(before.stats.periods.allTime.totalTokens);

  // --- 同じIDのまま表示名とURLを書き換えて起動する
  await app.stop();
  await expect.poll(() => before.connected).toBe(0);
  await app.writeHubs([{ id: 'alpha', name: 'New Name', url: after.url, token: after.token }]);
  await app.start();

  // 新しいURLだけに接続し、受信する前でも新しい表示名と前回の状態を読める。
  await expect.poll(() => after.connected).toBe(1);
  expect(before.connected).toBe(0);
  expect(query(db, 'SELECT hub_id, name FROM hubs')).toEqual([
    { hub_id: 'alpha', name: 'New Name' },
  ]);
  expect({ stats: statsJson(db, 'alpha'), receivedAt: receivedAt(db, 'alpha') }).toEqual(saved);

  // --- 新しいURLの最初の全体状態で置き換え、前回の利用量に加算しない
  after.sendSnapshot = true;
  after.disconnect();
  await expect.poll(() => receivedAt(db, 'alpha'), { timeout: 15_000 }).not.toBe(saved.receivedAt);
  expect(JSON.parse(statsJson(db, 'alpha')!)).toEqual(after.stats);
  expect(allTimeTokens(db)).toBe(after.stats.periods.allTime.totalTokens);
  expect(before.connected).toBe(0);
});
