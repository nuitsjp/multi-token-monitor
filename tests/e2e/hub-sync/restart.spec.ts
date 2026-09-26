import { test as base, expect } from '../fixtures.ts';
import { createStats, startFakeHub, type FakeHub } from './fake-hub.ts';
import { connected, query, receivedAt, statsJson } from './sync.ts';

// 拡張シナリオ「保存済みの状態があるまま再起動する」を検証する。
const test = base.extend<{ alpha: FakeHub }>({
  // eslint-disable-next-line no-empty-pattern -- Playwrightは依存のないfixtureにも分割代入を要求する
  alpha: async ({}, use) => {
    const hub = await startFakeHub('alpha-secret-token', createStats(1));
    await use(hub);
    await hub.close();
  },
  hubs: async ({ alpha }, use) => {
    await use([{ id: 'alpha', name: 'Alpha Hub', url: alpha.url, token: alpha.token }]);
  },
});
test.use({ serveFrontend: false });

function allTimeTokens(databasePath: string): number {
  return query<{ tokens: number }>(
    databasePath,
    "SELECT SUM(tokens) AS tokens FROM latest_token_usages WHERE period = 'all_time'",
  )[0].tokens;
}

test('再起動しても保存済みの状態を保持し、受信状態を戻して、最初の全体状態で置き換える', async ({
  app,
  alpha,
}) => {
  test.setTimeout(60_000);
  const db = app.databasePath;
  await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
  const saved = { stats: statsJson(db, 'alpha'), receivedAt: receivedAt(db, 'alpha') };
  const tokens = alpha.stats.periods.allTime.totalTokens;
  expect(allTimeTokens(db)).toBe(tokens);

  // --- 前回の起動を「再接続中」で終える。再接続はつながるが snapshot を受けない。
  alpha.sendSnapshot = false;
  alpha.fail('unauthorized');
  alpha.disconnect();
  await expect.poll(() => connected(db, 'alpha')).toBe(0);
  // 認証の拒否を経て、snapshot を受けない接続につながるまで待つ。
  // 切った接続が数え終わる前に通らないよう、拒否の回数を先に確かめる。
  await expect.poll(() => alpha.rejected, { timeout: 15_000 }).toBe(1);
  await expect.poll(() => alpha.connected, { timeout: 15_000 }).toBe(1);
  await app.stop();
  await expect.poll(() => alpha.connected).toBe(0);

  // --- 再起動: 受信する前でも前回保存した状態を読め、受信状態は受信中に戻る
  await app.start();
  await expect.poll(() => alpha.connected).toBe(1);
  expect(connected(db, 'alpha')).toBe(1);
  expect({ stats: statsJson(db, 'alpha'), receivedAt: receivedAt(db, 'alpha') }).toEqual(saved);
  await app.stop();
  await expect.poll(() => alpha.connected).toBe(0);

  // --- 再起動後に接続できないHubは、前回の状態を保持したまま再接続中になる
  alpha.fail('unauthorized');
  await app.start();
  await expect.poll(() => connected(db, 'alpha')).toBe(0);
  expect({ stats: statsJson(db, 'alpha'), receivedAt: receivedAt(db, 'alpha') }).toEqual(saved);
  expect(allTimeTokens(db)).toBe(tokens);

  // --- 再接続後の最初の全体状態で置き換え、同じ利用量を二重に加算しない
  alpha.sendSnapshot = true;
  alpha.disconnect();
  await expect.poll(() => receivedAt(db, 'alpha'), { timeout: 15_000 }).not.toBe(saved.receivedAt);
  expect(connected(db, 'alpha')).toBe(1);
  expect(JSON.parse(statsJson(db, 'alpha')!)).toEqual(alpha.stats);
  expect(allTimeTokens(db)).toBe(tokens);
});
