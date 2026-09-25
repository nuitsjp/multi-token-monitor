import { test, expect } from '../../fixtures.ts';
import { signIn, saveFromUI } from '../../helpers.ts';

test('確認後に削除をSQLiteへ確定し、別タブの一覧へ反映する', async ({ page, context, app }) => {
  // Arrange
  await signIn(page);
  await saveFromUI(page, '削除対象');
  const second = await context.newPage();
  await second.goto('/notes');
  await expect(second.getByRole('button', { name: '削除対象を編集' })).toBeVisible();

  // Act
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '削除する', exact: true }).click();

  // Assert
  await expect(page.getByRole('status').filter({ hasText: '削除しました' })).toBeVisible();
  expect(app.rows()).toEqual([]);
  await expect(second.getByRole('button', { name: '削除対象を編集' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '削除対象を編集' })).toHaveCount(0);
  await second.close();
});

test('削除の確認を取り消した場合は削除しない', async ({ page, app }) => {
  // Arrange
  await signIn(page);
  await saveFromUI(page, '残す対象');

  // Act
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '削除する', exact: true }).click();

  // Assert
  await expect(page.getByRole('button', { name: '残す対象を編集' })).toBeVisible();
  expect(app.rows()).toEqual([{ owner_id: 'alice', title: '残す対象', body: '本文', version: 1 }]);
});

test('保存エラーの後に削除できたら古いエラーを消す', async ({ page, app }) => {
  // Arrange
  await signIn(page);
  await saveFromUI(page, '削除対象');
  await page.getByLabel('タイトル', { exact: true }).fill('   ');
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveAccessibleDescription(
    'タイトルは1〜100文字で入力してください。',
  );

  // Act
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '削除する', exact: true }).click();

  // Assert
  await expect(page.getByRole('status').filter({ hasText: '削除しました' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveAccessibleDescription('');
  expect(app.rows()).toEqual([]);
});
