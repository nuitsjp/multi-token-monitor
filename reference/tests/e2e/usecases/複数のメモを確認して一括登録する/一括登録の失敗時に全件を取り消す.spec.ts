import { test, expect } from '../../fixtures.ts';
import { signIn, saveFromUI } from '../../helpers.ts';

test('途中の一意制約違反は先行行もロールバックし、確認内容と下書きを維持する', async ({
  page,
  app,
}) => {
  // Arrange
  await signIn(page);
  await saveFromUI(page, '既存', '変更されない');
  await page.getByRole('link', { name: /一括登録/ }).click();
  await page.getByLabel('タイトル一覧').fill('新規の先行行\n既存');
  await page.getByLabel('共通の本文').fill('一括本文');
  await page.getByRole('button', { name: '内容を確認する' }).click();

  // Act
  await page.getByRole('button', { name: '一括登録する', exact: true }).click();

  // Assert
  await expect(page.getByRole('alert')).toContainText('同じタイトルのメモが既にあります。');
  expect(app.rows()).toEqual([
    { owner_id: 'alice', title: '既存', body: '変更されない', version: 1 },
  ]);
  await expect(page.getByRole('heading', { name: '2. 内容を確認して保存' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveText(['新規の先行行', '既存']);
  await page.getByRole('button', { name: '入力に戻る' }).click();
  await expect(page.getByLabel('タイトル一覧')).toHaveValue('新規の先行行\n既存');
  await expect(page.getByLabel('共通の本文')).toHaveValue('一括本文');
});
