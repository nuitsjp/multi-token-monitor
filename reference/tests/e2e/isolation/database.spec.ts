import { test, expect } from '../fixtures.ts';
import { signIn, saveFromUI } from '../helpers.ts';
// 意図的に同じユーザー・一意キーを使う。suffixで衝突を隠さず、DB単位の分離を確認する。
for (let i = 1; i <= 4; i++)
  test(`ISO-${i} 並列でも同一キーを独立して保存できる`, async ({ page, app }) => {
    // Arrange
    await signIn(page);
    expect(app.rows()).toEqual([]);

    // Act
    await saveFromUI(page, 'parallel-fixed-title', 'parallel-fixed-body');

    // Assert
    expect(app.rows()).toEqual([
      { owner_id: 'alice', title: 'parallel-fixed-title', body: 'parallel-fixed-body', version: 1 },
    ]);
  });
test('SEC 本番entryにDB初期化APIを公開しない', async ({ page }) => {
  // Arrange
  await signIn(page);

  // Act
  const response = await page.request.post('/api/test/reset', {
    headers: { Origin: new URL(page.url()).origin },
  });

  // Assert
  expect(response.status()).toBe(404);
});
