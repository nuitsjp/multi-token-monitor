import { test, expect } from '../fixtures.ts';

// HTTP契約はAPIへ直接接続して検証し、ブラウザのシナリオではdev時にViteを経由する。
test.use({ serveFrontend: false });

test('HTTP契約はcamelCaseで保存結果を返し、他者の取得を拒否する', async ({ request, app }) => {
  // Arrange
  const headers = { Origin: app.url };
  expect((await request.post('/api/demo/sign-in', { headers, data: { user: 'alice' } })).ok()).toBe(
    true,
  );

  // Act
  const response = await request.post('/api/notes/save', {
    headers,
    data: { title: ' 契約の確認 ', body: '本文' },
  });
  const note = await response.json();
  const aliceNotes = await (await request.get('/api/notes')).json();
  expect((await request.post('/api/demo/sign-in', { headers, data: { user: 'bob' } })).ok()).toBe(
    true,
  );
  const other = await request.get(`/api/notes/${note.id}`);
  const bobNotes = await (await request.get('/api/notes')).json();

  // Assert
  expect(response.status()).toBe(200);
  expect(Object.keys(note).sort()).toEqual(['body', 'id', 'title', 'updatedAt', 'version']);
  expect(note).toMatchObject({ title: '契約の確認', body: '本文', version: 1 });
  expect(note.id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(Number.isNaN(Date.parse(note.updatedAt))).toBe(false);
  expect(aliceNotes).toEqual([note]);
  expect(app.rows()).toEqual([
    { owner_id: 'alice', title: '契約の確認', body: '本文', version: 1 },
  ]);
  expect(other.status()).toBe(404);
  expect(await other.json()).toMatchObject({ status: 404, detail: '対象のメモが見つかりません。' });
  expect(bobNotes).toEqual([]);
});

test('タイトルは前後の空白を除いた文字数で検証する', async ({ request, app }) => {
  // Arrange
  const headers = { Origin: app.url };
  expect((await request.post('/api/demo/sign-in', { headers, data: { user: 'alice' } })).ok()).toBe(
    true,
  );
  const longest = 'あ'.repeat(100);

  // Act
  const accepted = await request.post('/api/notes/save', {
    headers,
    data: { title: `\u3000${longest} `, body: '' },
  });
  const rejected = await request.post('/api/notes/save', {
    headers,
    data: { title: ` ${longest}い `, body: '' },
  });

  // Assert
  expect(accepted.status()).toBe(200);
  expect(rejected.status()).toBe(400);
  expect(await rejected.json()).toMatchObject({
    errors: { Title: ['タイトルは1〜100文字で入力してください。'] },
  });
  expect(app.rows()).toEqual([{ owner_id: 'alice', title: longest, body: '', version: 1 }]);
});

test('HTTP境界は不正なJSONと入力形状を拒否しDBを変更しない', async ({ request, app }) => {
  // Arrange
  const headers = { Origin: app.url };
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
  expect((await request.post('/api/demo/sign-in', { headers, data: { user: 'alice' } })).ok()).toBe(
    true,
  );
  const invalidShapes = [
    null,
    {},
    { title: '本文欠落' },
    { title: 123, body: '' },
    { title: null, body: '' },
    { title: 'null本文', body: null },
    { title: '明示null ID', body: '', id: null, version: null },
    { title: '明示null 版', body: '', id: '00000000-0000-4000-8000-000000000001', version: null },
    { title: '明示null IDのみ', body: '', id: null, version: 1 },
    { title: '余分な項目', body: '', ownerId: 'bob' },
    { title: '大小文字', body: '', Title: '別名' },
    { title: '版文字列', body: '', id: '00000000-0000-4000-8000-000000000001', version: '1' },
    { title: '不正ID', body: '', id: 'not-a-uuid', version: 1 },
    { title: '不正版', body: '', id: '00000000-0000-4000-8000-000000000001', version: 0 },
    { title: '版欠落', body: '', id: '00000000-0000-4000-8000-000000000001' },
    { title: 'ID欠落', body: '', version: 1 },
  ];

  // Act
  const shapeResponses = [];
  for (const input of invalidShapes)
    shapeResponses.push(
      await request.post('/api/notes/save', { headers: jsonHeaders, data: JSON.stringify(input) }),
    );
  const duplicate = await request.post('/api/notes/save', {
    headers: jsonHeaders,
    data: '{"title":"重複キー","body":"","title":"重複キー"}',
  });
  const multiple = await request.post('/api/notes/save', {
    headers,
    data: { title: '   ', body: 'x'.repeat(10_001) },
  });
  const broken = await request.post('/api/notes/save', { headers: jsonHeaders, data: '{' });
  const oversized = await request.post('/api/notes/save', {
    headers,
    data: { title: '上限超過', body: 'x'.repeat(1024 * 1024) },
  });

  // Assert
  for (const [index, response] of shapeResponses.entries()) {
    expect(response.status(), JSON.stringify(invalidShapes[index])).toBe(400);
    expect(await response.json()).toMatchObject({ status: 400, errors: expect.any(Object) });
  }
  expect(duplicate.status()).toBe(400);
  expect(await duplicate.json()).toMatchObject({ status: 400, errors: expect.any(Object) });
  expect(multiple.status()).toBe(400);
  expect(multiple.headers()['content-type']).toContain('application/problem+json');
  expect(await multiple.json()).toMatchObject({
    status: 400,
    errors: {
      Title: ['タイトルは1〜100文字で入力してください。'],
      Body: ['本文は10,000文字以内で入力してください。'],
    },
  });
  expect(broken.status()).toBe(400);
  expect(await broken.json()).toMatchObject({ status: 400, errors: expect.any(Object) });
  expect(oversized.status()).toBe(413);
  expect(await oversized.json()).toMatchObject({
    status: 413,
    detail: 'リクエストが大きすぎます。',
  });
  expect(app.rows()).toEqual([]);
});

test('削除入力のUUIDと版を検証し、不正入力ではDBを変更しない', async ({ request, app }) => {
  // Arrange
  const headers = { Origin: app.url };
  expect((await request.post('/api/demo/sign-in', { headers, data: { user: 'alice' } })).ok()).toBe(
    true,
  );
  const saved = await request.post('/api/notes/save', {
    headers,
    data: { title: '削除しないメモ', body: '本文' },
  });
  expect(saved.status()).toBe(200);
  const note = await saved.json();
  const cases = [
    { input: { id: 'not-a-uuid', version: note.version }, field: 'Id' },
    { input: { id: note.id, version: 0 }, field: 'Version' },
  ];

  // Act
  const responses = [];
  for (const { input } of cases)
    responses.push(await request.post('/api/notes/remove', { headers, data: input }));

  // Assert
  for (const [index, response] of responses.entries()) {
    expect(response.status(), JSON.stringify(cases[index].input)).toBe(400);
    expect(await response.json()).toMatchObject({
      status: 400,
      errors: { [cases[index].field]: expect.any(Array) },
    });
  }
  expect(app.rows()).toEqual([
    {
      owner_id: 'alice',
      title: '削除しないメモ',
      body: '本文',
      version: 1,
    },
  ]);
});

test('HTTP境界は未認証操作と異なるoriginからの更新を拒否する', async ({ request, app }) => {
  // Arrange
  const headers = { Origin: app.url };

  // Act
  const session = await (await request.get('/api/session')).json();
  const anonymous = await request.get('/api/notes');
  expect((await request.post('/api/demo/sign-in', { headers, data: { user: 'alice' } })).ok()).toBe(
    true,
  );
  const foreign = await request.post('/api/notes/save', {
    headers: { Origin: 'https://other.example' },
    data: { title: '保存しない', body: '' },
  });
  const missingOrigin = await request.post('/api/notes/save', {
    data: { title: '保存しない', body: '' },
  });

  // Assert
  expect(session).toEqual({ user: null, mode: 'demo' });
  expect(anonymous.status()).toBe(401);
  expect(await anonymous.json()).toMatchObject({ status: 401, detail: '利用者を確認できません。' });
  expect(foreign.status()).toBe(403);
  expect(missingOrigin.status()).toBe(403);
  expect(app.rows()).toEqual([]);
});

test('HTTP境界は許可していない接続先名でのAPI呼び出しを拒否する', async ({ request, app }) => {
  // Arrange
  const port = new URL(app.url).port;

  // Act
  const foreignHost = await request.get('/api/session', {
    headers: { Host: `other.example:${port}` },
  });
  const localhost = await request.get('/api/session', { headers: { Host: `localhost:${port}` } });

  // Assert
  expect(foreignHost.status()).toBe(403);
  expect(await foreignHost.json()).toMatchObject({ status: 403, detail: '接続先が不正です。' });
  expect(localhost.status()).toBe(200);
});

test('同一.NETサーバーがSPAを配信し、未知APIにはHTMLを返さない', async ({ request, app }) => {
  test.skip(app.mode !== 'hosted', 'SPAの一体配信はhostedモードだけで検証します。');

  // Arrange
  const unknownPaths = ['/api/not-found', '/events/not-found'];

  // Act
  const page = await request.get('/import/confirm', { headers: { Accept: 'text/html' } });
  const unknown = [];
  for (const path of unknownPaths)
    unknown.push(await request.get(path, { headers: { Accept: 'text/html' } }));

  // Assert
  expect(page.status()).toBe(200);
  expect(page.headers()['content-type']).toContain('text/html');
  expect(await page.text()).toContain('<div id="root">');
  for (const response of unknown) {
    expect(response.status()).toBe(404);
    expect(response.headers()['content-type'] ?? '').not.toContain('text/html');
  }
});
