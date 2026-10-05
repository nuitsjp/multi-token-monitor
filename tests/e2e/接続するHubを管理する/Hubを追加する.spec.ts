import { test as base, expect } from '../fixtures.ts';
import { createStats, startFakeHub, type FakeHub } from '../hub-sync/fake-hub.ts';
import { query, watchEvents } from '../hub-sync/sync.ts';

// 主成功シナリオ「Hubを追加する」を検証する。登録済みのHubが0件の状態から、画面で追加する。
const test = base.extend<{ lab: FakeHub }>({
  // eslint-disable-next-line no-empty-pattern -- Playwrightは依存のないfixtureにも分割代入を要求する
  lab: async ({}, use) => {
    // 最初の全体状態は、テストが送るまで返さない。
    const hub = await startFakeHub('lab-secret-token', createStats(4), { sendSnapshot: false });
    await use(hub);
    await hub.close();
  },
});
test.use({ hubs: [] });

test('Settingsから追加したHubが、再起動なしに受信を開始して反映される', async ({
  page,
  app,
  lab,
}) => {
  const db = app.databasePath;
  const menu = page.getByRole('navigation', { name: 'Menu' });
  const dialog = page.getByRole('dialog', { name: 'Add hub' });
  const list = page.getByRole('region', { name: 'Hubs' });
  const hubRows = () =>
    query<{ hub_id: string; name: string; url: string; token: string }>(
      db,
      'SELECT hub_id, name, url, token FROM hubs ORDER BY rowid',
    );
  const watcher = await watchEvents(app.url);

  await test.step('開始条件', async () => {
    await page.goto('/');
    await menu.getByRole('link', { name: 'Settings' }).click();
  });

  await test.step('手順1', async () => {
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
    await expect(list).toContainText('No hubs registered.');
    await expect(list.getByRole('button', { name: 'Add hub' })).toBeVisible();
    // 追加フォームは通常表示しない。
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Token')).toHaveCount(0);
    // Settings はメニューの一番下に置く。
    await expect(menu.locator(':scope > a').last()).toHaveText('Settings');
  });

  await test.step('手順2', async () => {
    await list.getByRole('button', { name: 'Add hub' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Name')).toHaveValue('');
    const add = dialog.getByRole('button', { name: 'Add hub' });

    // 検証に該当する入力は保存せず、ポップアップを開いたまま項目のそばに理由を示す。
    await add.click();
    await expect(dialog.getByText('Enter a name.')).toBeVisible();
    await expect(dialog.getByText('Enter a URL like http(s)://host[:port].')).toBeVisible();
    await expect(dialog.getByText('Enter a valid token.')).toBeVisible();
    await dialog.getByLabel('Name').fill('Lab');
    await dialog.getByLabel('URL').fill(`${lab.url}/path`);
    await dialog.getByLabel('Token').fill('lab-secret-token');
    await add.click();
    await expect(dialog.getByText('Enter a URL like http(s)://host[:port].')).toBeVisible();
    await expect(dialog.getByText('Enter a name.')).toHaveCount(0);
    await expect(dialog.getByLabel('Name')).toHaveValue('Lab');
    expect(hubRows()).toEqual([]);
    expect(lab.connected + lab.rejected).toBe(0);

    // 満たす入力で保存し、ポップアップを閉じて一覧の末尾に示す。
    await dialog.getByLabel('URL').fill(lab.url);
    await add.click();
    await expect(dialog).toHaveCount(0);
    const rows = list.getByRole('listitem');
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText('Lab');
    await expect(rows.nth(0)).toContainText(lab.url);
    // 最初の全体状態を受けるまでは Not received。
    await expect(rows.nth(0)).toContainText('Not received');
    const [saved] = hubRows();
    expect(saved).toMatchObject({ name: 'Lab', url: lab.url, token: 'lab-secret-token' });
    expect(saved.hub_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // アプリケーションを起動し直さずに、入力したトークンで受信を始める。
    await expect.poll(() => lab.connected).toBe(1);
    expect(lab.rejected).toBe(0);
  });

  await test.step('手順3', async () => {
    lab.send('snapshot', lab.stats);
    const rows = list.getByRole('listitem');
    await expect(rows.nth(0)).toContainText('Connected');
    const [{ hub_id: hubId }] = hubRows();
    expect(query(db, 'SELECT hub_id FROM hub_states WHERE hub_id = ?', hubId)).toHaveLength(1);
    // 他のページを開き直さずに、追加したHubの利用状況が反映される。
    await menu.getByRole('link', { name: 'By hub' }).click();
    await expect(page.getByRole('radio', { name: 'Lab' })).toBeChecked();
    await expect(page.locator('.by-hub-summary')).toContainText('Tokens');
  });

  await test.step('受け入れ条件', async () => {
    await menu.getByRole('link', { name: 'Settings' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);

    // 同じ表示名・同じURLのHubを複数追加でき、IDは別々に採番される。接続できないHubは Reconnecting になる。
    await list.getByRole('button', { name: 'Add hub' }).click();
    await dialog.getByLabel('Name').fill('Lab');
    await dialog.getByLabel('URL').fill(lab.url);
    await dialog.getByLabel('Token').fill('lab-secret-token');
    await dialog.getByRole('button', { name: 'Add hub' }).click();
    await list.getByRole('button', { name: 'Add hub' }).click();
    await dialog.getByLabel('Name').fill('Down');
    await dialog.getByLabel('URL').fill('http://127.0.0.1:9');
    await dialog.getByLabel('Token').fill('down-token');
    await dialog.getByRole('button', { name: 'Add hub' }).click();
    // 閉じる動作の途中の入力欄を、画面の内容として読まない。
    await expect(dialog).toHaveCount(0);
    const rows = list.getByRole('listitem');
    await expect(rows).toHaveCount(3);
    expect(new Set(hubRows().map((row) => row.hub_id)).size).toBe(3);
    await expect(rows.nth(2)).toContainText('Reconnecting');
    // 追加したHubへの接続の失敗は、他のHubの受信とWebサーバーを止めない。
    await expect(rows.nth(0)).toContainText('Connected');
    expect((await page.request.get('/health')).status()).toBe(200);

    // 認証トークンは、DBの値を除き、画面・閲覧用API・通知・ログに現れない。
    const secrets = ['lab-secret-token', 'down-token'];
    const bodies = await Promise.all(
      ['/api/hubs', '/api/overview', '/api/hub-usage', '/api/limit-history'].map(async (path) =>
        (await page.request.get(path)).text(),
      ),
    );
    for (const secret of secrets) {
      for (const body of bodies) expect(body).not.toContain(secret);
      expect(await page.content()).not.toContain(secret);
      expect(JSON.stringify(watcher.events)).not.toContain(secret);
      expect(app.output).not.toContain(secret);
    }
    // URLは設定画面にだけ表示し、他の閲覧用APIには含めない。
    expect(bodies[0]).toContain(lab.url);
    for (const body of bodies.slice(1)) expect(body).not.toContain(lab.url);
    watcher.close();
  });
});
