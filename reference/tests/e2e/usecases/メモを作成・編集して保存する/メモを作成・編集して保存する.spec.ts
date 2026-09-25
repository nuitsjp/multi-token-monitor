import { test, expect } from '../../fixtures.ts';
import { signIn, saveFromUI } from '../../helpers.ts';

test('作成・編集がUIからSQLiteへ確定し、保存結果と一覧を表示する', async ({ page, app }) => {
  // Arrange
  await signIn(page);
  await saveFromUI(page, '同じタイトル', '初期本文');
  await expect
    .poll(() => app.rows())
    .toEqual([{ owner_id: 'alice', title: '同じタイトル', body: '初期本文', version: 1 }]);

  // Act
  await page.getByLabel('本文', { exact: true }).fill('更新本文');
  await page.getByRole('button', { name: '保存する', exact: true }).click();

  // Assert
  await expect(page.getByRole('status').filter({ hasText: '保存しました' })).toBeVisible();
  await expect(page.getByText('v2 ·')).toBeVisible();
  expect(app.rows()).toEqual([
    { owner_id: 'alice', title: '同じタイトル', body: '更新本文', version: 2 },
  ]);
  await page.reload();
  await page.getByRole('button', { name: '同じタイトルを編集', exact: true }).click();
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue('更新本文');
});

test('サーバー再起動後も保存結果を読み取れる', async ({ page, app }) => {
  // Arrange
  await signIn(page);
  await saveFromUI(page, '再起動しても保持', '永続化');

  // Act
  await app.restart();
  await page.goto(app.url + '/notes');
  await page.getByRole('button', { name: 'Aliceで開始' }).click();
  await page.getByRole('button', { name: '再起動しても保持を編集' }).click();

  // Assert
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue('永続化');
  expect(app.rows()[0]?.version).toBe(1);
});

test('別タブの確定をSSEで一覧へ反映する', async ({ page, context, app }) => {
  // Arrange
  await signIn(page);
  const second = await context.newPage();
  await second.goto('/notes');
  await expect(second.getByLabel('通知接続')).toHaveText('変更通知 接続済み');

  // Act
  await saveFromUI(page, '通知を確認', 'DB確定済み');

  // Assert
  await expect(second.getByRole('button', { name: '通知を確認を編集' })).toBeVisible();
  expect(app.rows()).toHaveLength(1);
  await second.close();
});
