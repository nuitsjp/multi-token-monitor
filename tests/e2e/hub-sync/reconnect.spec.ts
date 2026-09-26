import { test as base, expect, type IsolatedApp } from '../fixtures.ts';
import { createStats, startFakeHub, type FakeHub } from './fake-hub.ts';
import { connected, query, receivedAt, statsJson, watchEvents } from './sync.ts';

// 拡張シナリオ「受信が止まったHubへ再接続する」を検証する。
const test = base.extend<{ alpha: FakeHub; beta: FakeHub }>({
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
  hubs: async ({ alpha, beta }, use) => {
    await use([
      { id: 'alpha', name: 'Alpha Hub', url: alpha.url, token: alpha.token },
      { id: 'beta', name: 'Beta Hub', url: beta.url, token: beta.token },
    ]);
  },
});
test.use({ serveFrontend: false });

// 受信が止まるたびに出力する原因の分類と、次の再接続までの待ち時間（秒）。
function stops(app: IsolatedApp, hubId: string) {
  return [
    ...app.output.matchAll(new RegExp(`HubId=${hubId} Cause=(.+?) DelaySeconds=(\\d+)`, 'g')),
  ].map((match) => ({ cause: match[1], delay: Number(match[2]) }));
}

async function received(app: IsolatedApp) {
  await expect
    .poll(() => [receivedAt(app.databasePath, 'alpha'), receivedAt(app.databasePath, 'beta')])
    .toEqual([expect.any(String), expect.any(String)]);
}

test('理由を問わず再接続を続け、受信状態が変わったときだけ通知する', async ({
  app,
  request,
  alpha,
  beta,
}) => {
  test.setTimeout(60_000);
  const db = app.databasePath;
  await received(app);
  expect([connected(db, 'alpha'), connected(db, 'beta')]).toEqual([1, 1]);
  const saved = statsJson(db, 'alpha');
  const watcher = await watchEvents(app.url);
  await expect.poll(() => watcher.events.map((item) => item.event)).toEqual(['ready']);

  // --- ストリームの終了、認証の拒否、リダイレクトで受信が止まる
  alpha.fail('unauthorized', 'redirect');
  alpha.disconnect();
  await expect.poll(() => stops(app, 'alpha')).toHaveLength(3);
  expect(stops(app, 'alpha')).toEqual([
    { cause: 'disconnected', delay: 1 },
    { cause: 'authentication Status=401', delay: 2 },
    { cause: 'response Status=302', delay: 4 },
  ]);
  // 再接続中は受信状態の変化の1回だけ合図し、失敗が続いても合図しない。
  expect(connected(db, 'alpha')).toBe(0);
  expect(watcher.changed()).toBe(1);
  // 最後に保存した状態は保持され、他のHubの受信とWebサーバーは続く。
  expect(statsJson(db, 'alpha')).toBe(saved);
  expect(connected(db, 'beta')).toBe(1);
  const betaReceivedAt = receivedAt(db, 'beta');
  beta.send('stats', { ...beta.stats, updatedAt: new Date().toISOString() });
  await expect.poll(() => receivedAt(db, 'beta')).not.toBe(betaReceivedAt);
  expect((await request.get('/health')).status()).toBe(200);

  // --- 再接続した接続で全体状態を保存すると受信中に戻り、1回だけ合図する
  await expect.poll(() => connected(db, 'alpha'), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => watcher.changed()).toBe(3);
  expect(stops(app, 'alpha')).toHaveLength(3);

  // --- 不正な通知、保存の失敗でも再接続し、待ち時間は1秒からやり直す
  alpha.fail('invalid-notification', 'save-failure');
  alpha.disconnect();
  await expect.poll(() => stops(app, 'alpha')).toHaveLength(6);
  expect(stops(app, 'alpha').slice(3)).toEqual([
    { cause: 'disconnected', delay: 1 },
    { cause: 'invalid-notification', delay: 2 },
    { cause: 'database', delay: 4 },
  ]);
  // 保存の失敗はロールバックされ、最後に保存した状態が残る。
  expect(connected(db, 'alpha')).toBe(0);
  expect(statsJson(db, 'alpha')).toBe(saved);
  expect(query(db, 'SELECT device_id FROM devices WHERE hub_id = ?', 'alpha')).toHaveLength(3);
  expect(watcher.changed()).toBe(4);

  await expect.poll(() => connected(db, 'alpha'), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => watcher.changed()).toBe(5);
  watcher.close();

  // --- ログにはHub IDと原因の分類だけを出力し、URL・認証トークン・応答本文を含めない
  for (const secret of [alpha.url, beta.url, alpha.token, beta.token, '{"type":']) {
    expect(app.output).not.toContain(secret);
  }
});

test('連続して失敗するたびに待ち時間が倍になり、待っている間でも終了できる', async ({
  app,
  alpha,
}) => {
  test.setTimeout(60_000);
  await received(app);
  alpha.fail('unauthorized', 'unauthorized', 'unauthorized', 'unauthorized');
  alpha.disconnect();
  await expect
    .poll(() => stops(app, 'alpha').map((stop) => stop.delay), { timeout: 30_000 })
    .toEqual([1, 2, 4, 8, 16]);
  // 16秒の待機中に終了を依頼しても、待機の終わりを待たずに終了する。
  const stopping = Date.now();
  await app.stop();
  expect(Date.now() - stopping).toBeLessThan(5_000);
});
