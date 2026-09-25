import { DatabaseSync } from 'node:sqlite';
import { test, expect } from '../fixtures.ts';
// 並列実行でも各テストが専用のサーバーとDBファイルを所有することを確認する。
for (let i = 1; i <= 4; i++)
  test(`ISO-${i} 並列でもトップページを表示し、専用DBを初期化する`, async ({ page, app }) => {
    // Arrange
    const path = '/';

    // Act
    await page.goto(path);

    // Assert
    await expect(page.getByRole('heading', { name: 'Token Monitor Analytics' })).toBeVisible();
    // 検証は別の読取専用接続。
    const db = new DatabaseSync(app.databasePath, { readOnly: true });
    try {
      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    } finally {
      db.close();
    }
  });
test('SEC 本番entryにDB初期化APIを公開しない', async ({ page }) => {
  // Arrange
  await page.goto('/');

  // Act
  const response = await page.request.post('/api/test/reset', {
    headers: { Origin: new URL(page.url()).origin },
  });

  // Assert
  expect(response.status()).toBe(404);
});
