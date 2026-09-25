import { test, expect } from '../fixtures.ts';

// HTTP契約はAPIへ直接接続して検証し、ブラウザのシナリオではdev時にViteを経由する。
test.use({ serveFrontend: false });

test('ヘルスチェックはcamelCaseのJSONで稼働状態を返す', async ({ request }) => {
  // Arrange
  const path = '/health';

  // Act
  const response = await request.get(path);

  // Assert
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('同一.NETサーバーがSPAを配信し、未知APIにはHTMLを返さない', async ({ request, app }) => {
  test.skip(app.mode !== 'hosted', 'SPAの一体配信はhostedモードだけで検証します。');

  // Arrange
  const unknownPath = '/api/not-found';

  // Act
  const page = await request.get('/some/deep/link', { headers: { Accept: 'text/html' } });
  const unknown = await request.get(unknownPath, { headers: { Accept: 'text/html' } });

  // Assert
  expect(page.status()).toBe(200);
  expect(page.headers()['content-type']).toContain('text/html');
  expect(await page.text()).toContain('<div id="root">');
  expect(unknown.status()).toBe(404);
  expect(unknown.headers()['content-type'] ?? '').not.toContain('text/html');
});
