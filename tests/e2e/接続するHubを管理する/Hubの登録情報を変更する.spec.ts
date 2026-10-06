import { test as base, expect } from '../fixtures.ts';
import { createStats, startFakeHub, type FakeHub } from '../hub-sync/fake-hub.ts';
import { query, statsJson, watchEvents } from '../hub-sync/sync.ts';

// 拡張シナリオ「Hubの登録情報を変更する」を検証する。接続情報の導入前から存在するHub（Legacy）と、画面から追加したHub（Lab）を変更する。
const test = base.extend<{ lab: FakeHub; other: FakeHub }>({
  // eslint-disable-next-line no-empty-pattern -- Playwrightは依存のないfixtureにも分割代入を要求する
  lab: async ({}, use) => {
    const hub = await startFakeHub('lab-secret-token', createStats(4));
    await use(hub);
    await hub.close();
  },
  // eslint-disable-next-line no-empty-pattern -- Playwrightは依存のないfixtureにも分割代入を要求する
  other: async ({}, use) => {
    const hub = await startFakeHub('other-secret-token', createStats(6));
    await use(hub);
    await hub.close();
  },
});
test.use({ hubs: [{ id: 'legacy', name: 'Legacy', url: '', token: '' }] });

test('登録済みのHubの表示名・URL・認証トークンを変更し、再起動なしに受信を切り替える', async ({
  page,
  app,
  lab,
  other,
}) => {
  const db = app.databasePath;
  const menu = page.getByRole('navigation', { name: 'Menu' });
  const list = page.getByRole('region', { name: 'Hubs' });
  const rows = list.getByRole('listitem');
  const addDialog = page.getByRole('dialog', { name: 'Add hub' });
  const dialog = page.getByRole('dialog', { name: 'Edit hub' });
  const hubRows = () =>
    query<{ hub_id: string; name: string; url: string; token: string }>(
      db,
      'SELECT hub_id, name, url, token FROM hubs ORDER BY rowid',
    );
  const watcher = await watchEvents(app.url);
  const edit = (index: number) => rows.nth(index).getByRole('button', { name: 'Edit hub' }).click();
  let labId = '';
  let labStats = '';
  let labAccepted = 0;

  await test.step('分岐条件', async () => {
    await page.goto('/');
    await menu.getByRole('link', { name: 'Settings' }).click();
    // 接続情報の導入前から存在するHubは受信せず、Reconnecting と表示する。
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText('Legacy');
    await expect(rows.nth(0)).toContainText('Reconnecting');
    // 画面から追加したHubが、最初の全体状態を受けて Connected になる。
    await list.getByRole('button', { name: 'Add hub' }).click();
    await addDialog.getByLabel('Name').fill('Lab');
    await addDialog.getByLabel('URL').fill(lab.url);
    await addDialog.getByLabel('Token').fill('lab-secret-token');
    await addDialog.getByRole('button', { name: 'Add hub' }).click();
    await expect(addDialog).toHaveCount(0);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('Connected');
    labId = hubRows()[1].hub_id;
    labStats = statsJson(db, labId)!;
    expect(labStats).toBeTruthy();
  });

  await test.step('手順1', async () => {
    await edit(1);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Name')).toHaveValue('Lab');
    await expect(dialog.getByLabel('URL')).toHaveValue(lab.url);
    // 認証トークンの現在値は表示しない。
    await expect(dialog.getByLabel('Token')).toHaveValue('');
    // 保存せずに閉じると、開き直したときは現在の登録値に戻る。
    await dialog.getByLabel('Name').fill('Discarded');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await edit(1);
    await expect(dialog.getByLabel('Name')).toHaveValue('Lab');
    await expect(dialog.getByLabel('Token')).toHaveValue('');
    expect(hubRows()[1].name).toBe('Lab');
  });

  await test.step('手順2', async () => {
    // 検証に該当する入力は、接続を試さず保存しない。
    await dialog.getByLabel('Name').fill(' ');
    await dialog.getByLabel('URL').fill('bad');
    await dialog.getByRole('button', { name: 'Save hub' }).click();
    await expect(dialog.getByText('Enter a name.')).toBeVisible();
    await expect(dialog.getByText('Enter a URL like http(s)://host[:port].')).toBeVisible();
    await expect(dialog.getByText('Enter a valid token.')).toHaveCount(0);
    expect(hubRows()[1]).toMatchObject({ name: 'Lab', url: lab.url, token: 'lab-secret-token' });
    labAccepted = lab.accepted;

    // 表示名だけの変更は、Token が空でも、接続を試さずに保存する。
    await dialog.getByLabel('Name').fill('Lab renamed');
    await dialog.getByLabel('URL').fill(lab.url);
    await dialog.getByRole('button', { name: 'Save hub' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('Lab renamed');
    expect(hubRows()[1]).toMatchObject({
      hub_id: labId,
      name: 'Lab renamed',
      url: lab.url,
      token: 'lab-secret-token',
    });
    expect(lab.accepted).toBe(labAccepted);

    // 認証トークンの拒否は Token の項目のそばに示し、保存しない。
    await edit(1);
    await dialog.getByLabel('Token').fill('wrong-token');
    await dialog.getByRole('button', { name: 'Save hub' }).click();
    await expect(dialog.getByText('The hub rejected the token.')).toBeVisible();
    await expect(dialog.getByLabel('Name')).toHaveValue('Lab renamed');
    expect(hubRows()[1].token).toBe('lab-secret-token');
    expect(lab.rejected).toBe(1);

    // 接続できない接続先も保存しない。
    await dialog.getByLabel('Token').fill('');
    await dialog.getByLabel('URL').fill('http://127.0.0.1:9');
    await dialog.getByRole('button', { name: 'Save hub' }).click();
    await expect(dialog.getByText('Could not connect to the hub.')).toBeVisible();
    expect(hubRows()[1].url).toBe(lab.url);

    // 接続できる接続先と認証トークンなら、同じIDのまま更新し、一覧の同じ位置に示す。
    await dialog.getByLabel('URL').fill(other.url);
    await dialog.getByLabel('Token').fill('other-secret-token');
    await dialog.getByRole('button', { name: 'Save hub' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('Lab renamed');
    await expect(rows.nth(1)).toContainText(other.url);
    expect(hubRows()[1]).toMatchObject({
      hub_id: labId,
      name: 'Lab renamed',
      url: other.url,
      token: 'other-secret-token',
    });
  });

  await test.step('手順3', async () => {
    // 変更前の接続は終わり、変更後の接続先へ再起動なしに受信を始める。
    await expect.poll(() => other.connected).toBe(1);
    await expect.poll(() => lab.connected).toBe(0);
    // 最初の全体状態で保存済みの最新状態が置き換わり、一覧は Connected になる。
    await expect.poll(() => statsJson(db, labId)).not.toBe(labStats);
    await expect(rows.nth(1)).toContainText('Connected');
    // 変更前の接続先へは、変更の後に再接続しない。
    await page.waitForTimeout(1500);
    expect(lab.accepted).toBe(labAccepted);
  });

  await test.step('受け入れ条件', async () => {
    // 接続情報が空だったHubは、Token を入れなければ保存せず、入れると受信を始める。
    const otherAccepted = other.accepted;
    await edit(0);
    await dialog.getByLabel('URL').fill(other.url);
    await dialog.getByRole('button', { name: 'Save hub' }).click();
    await expect(dialog.getByText('Enter a valid token.')).toBeVisible();
    expect(hubRows()[0]).toMatchObject({ name: 'Legacy', url: '', token: '' });
    expect(other.accepted).toBe(otherAccepted);
    await dialog.getByLabel('Token').fill('other-secret-token');
    await dialog.getByRole('button', { name: 'Save hub' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(rows.nth(0)).toContainText('Connected');
    expect(hubRows()[0]).toMatchObject({ hub_id: 'legacy', url: other.url });
    await expect.poll(() => other.connected).toBe(2);

    // 変更したHubの接続の失敗は、他のHubの受信とWebサーバーを止めない。
    expect((await page.request.get('/health')).status()).toBe(200);
    await expect(rows.nth(1)).toContainText('Connected');

    // 認証トークンは、DBの値を除き、画面・閲覧用API・通知・ログに現れない。URLは設定画面にだけ表示する。
    const secrets = ['lab-secret-token', 'other-secret-token', 'wrong-token'];
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
    expect(bodies[0]).toContain(other.url);
    for (const body of bodies.slice(1)) expect(body).not.toContain(other.url);
    watcher.close();
  });
});
