import { test, expect } from '../../fixtures.ts';
import { signIn, saveFromUI } from '../../helpers.ts';

test('不正入力ではDBを更新せず、失敗理由と下書きを表示する', async ({ page, app }) => {
  // Arrange
  await signIn(page);
  await page.getByLabel('タイトル', { exact: true }).fill('   ');
  await page.getByLabel('本文', { exact: true }).fill('残す下書き');

  // Act
  await page.getByRole('button', { name: '保存する', exact: true }).click();

  // Assert
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveAccessibleDescription(
    'タイトルは1〜100文字で入力してください。',
  );
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('   ');
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue('残す下書き');
  expect(app.rows()).toEqual([]);
});

test('タイトル重複ではDBを更新せず、失敗理由と下書きを表示する', async ({ page, app }) => {
  // Arrange
  await signIn(page);
  await saveFromUI(page, '重複タイトル', '既存の本文');
  await page.getByRole('button', { name: '新しいメモ' }).click();
  await page.getByLabel('タイトル', { exact: true }).fill('重複タイトル');
  await page.getByLabel('本文', { exact: true }).fill('残す下書き');

  // Act
  await page.getByRole('button', { name: '保存する', exact: true }).click();

  // Assert
  await expect(page.getByRole('alert')).toContainText('同じタイトルのメモが既にあります。');
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('重複タイトル');
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue('残す下書き');
  expect(app.rows()).toEqual([
    { owner_id: 'alice', title: '重複タイトル', body: '既存の本文', version: 1 },
  ]);
});
