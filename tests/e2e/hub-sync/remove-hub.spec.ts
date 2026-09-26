import { test as base, expect, type HubConfigEntry } from '../fixtures.ts';
import { createStats, startFakeHub, type FakeHub } from './fake-hub.ts';
import { query, receivedAt, statsJson } from './sync.ts';

// 拡張シナリオ「設定から外したHubを起動時に削除する」を検証する。
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
    await use([entry('alpha', 'Alpha Hub', alpha), entry('beta', 'Beta Hub', beta)]);
  },
});
test.use({ serveFrontend: false });

function entry(id: string, name: string, hub: FakeHub): HubConfigEntry {
  return { id, name, url: hub.url, token: hub.token };
}

const HUB_TABLES = [
  'hubs',
  'hub_states',
  'hub_summaries',
  'devices',
  'latest_token_usages',
  'latest_limit_windows',
];

// Hubに属する全テーブルの行。
function hubRows(databasePath: string, hubId: string) {
  return Object.fromEntries(
    HUB_TABLES.map((table) => [
      table,
      query(databasePath, `SELECT * FROM ${table} WHERE hub_id = ? ORDER BY 1, 2, 3`, hubId),
    ]),
  );
}

function accounts(databasePath: string) {
  return query<{ account_key: string }>(
    databasePath,
    'SELECT account_key FROM accounts ORDER BY account_key',
  ).map((row) => row.account_key);
}

test('設定から外したHubを保存済みの状態ごと削除し、戻すと未受信から受信し直す', async ({
  app,
  alpha,
  beta,
}) => {
  test.setTimeout(60_000);
  const db = app.databasePath;
  await expect
    .poll(() => [receivedAt(db, 'alpha'), receivedAt(db, 'beta')])
    .toEqual([expect.any(String), expect.any(String)]);
  expect(accounts(db)).toEqual(['account-1', 'account-2']);
  // 残すHubが再起動後に保存し直さないようにし、削除の前後で行を比べる。
  alpha.sendSnapshot = false;
  const alphaRows = hubRows(db, 'alpha');

  // --- Betaを設定から外して起動する
  await app.stop();
  await app.writeHubs([entry('alpha', 'Alpha Hub', alpha)]);
  await app.start();

  // 外したHubの行はすべて消え、参照されなくなったアカウントも残らない。
  for (const [table, rows] of Object.entries(hubRows(db, 'beta'))) {
    expect(rows, table).toEqual([]);
  }
  expect(accounts(db)).toEqual(['account-1']);
  // 設定に残したHubの行は変わらない。
  expect(hubRows(db, 'alpha')).toEqual(alphaRows);
  // ログには削除したHubのIDだけを出す。
  expect(app.output).toContain('HubId=beta');
  for (const secret of ['Beta Hub', beta.url, beta.token]) {
    expect(app.output).not.toContain(secret);
  }

  // --- Betaを同じIDで設定に戻して起動すると、未受信のHubとして登録される
  await app.stop();
  beta.sendSnapshot = false;
  beta.stats = createStats(3);
  await app.writeHubs([entry('alpha', 'Alpha Hub', alpha), entry('beta', 'Beta Hub', beta)]);
  await app.start();
  expect(query(db, 'SELECT hub_id, name FROM hubs ORDER BY hub_id')).toEqual([
    { hub_id: 'alpha', name: 'Alpha Hub' },
    { hub_id: 'beta', name: 'Beta Hub' },
  ]);
  expect(statsJson(db, 'beta')).toBeUndefined();

  // 受信後は、そのとき受け取った状態だけを保持する。
  await expect.poll(() => beta.connected).toBe(1);
  beta.sendSnapshot = true;
  beta.disconnect();
  await expect.poll(() => statsJson(db, 'beta'), { timeout: 15_000 }).toBeTruthy();
  expect(JSON.parse(statsJson(db, 'beta')!)).toEqual(beta.stats);
  expect(
    query<{ tokens: number }>(
      db,
      "SELECT SUM(tokens) AS tokens FROM latest_token_usages WHERE hub_id = 'beta' AND period = 'all_time'",
    )[0].tokens,
  ).toBe(beta.stats.periods.allTime.totalTokens);
  expect(accounts(db)).toEqual(['account-1', 'account-3']);
});
