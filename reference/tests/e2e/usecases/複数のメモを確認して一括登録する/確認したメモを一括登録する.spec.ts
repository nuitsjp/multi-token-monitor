import { test, expect } from '../../fixtures.ts';
import { signIn } from '../../helpers.ts';

test('確認前は未保存、確認後に全件をSQLiteへ登録する', async ({ page, app }) => {
  await test.step('開始条件', async () => {
    await signIn(page);
    await page.getByRole('link', { name: /一括登録/ }).click();
  });
  await test.step('手順1: 入力内容を確認する', async () => {
    await page.getByLabel('タイトル一覧').fill('一件目\n二件目');
    await page.getByLabel('共通の本文').fill('一括本文');
    await page.getByRole('button', { name: '内容を確認する' }).click();
    await expect(page.getByRole('heading', { name: '2. 内容を確認して保存' })).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveText(['一件目', '二件目']);
    expect(app.rows()).toEqual([]);
  });
  await test.step('手順2: 一括登録する', async () => {
    await page.getByRole('button', { name: '一括登録する', exact: true }).click();
  });
  await test.step('受け入れ条件', async () => {
    await expect(page.getByRole('status').filter({ hasText: '2件を登録しました' })).toBeVisible();
    expect(app.rows()).toEqual([
      { owner_id: 'alice', title: '一件目', body: '一括本文', version: 1 },
      { owner_id: 'alice', title: '二件目', body: '一括本文', version: 1 },
    ]);
    await page.getByRole('button', { name: 'メモ一覧へ' }).click();
    await expect(page.getByRole('button', { name: '一件目を編集' })).toBeVisible();
    await expect(page.getByRole('button', { name: '二件目を編集' })).toBeVisible();
  });
});

test('確認後に入力を変更した場合は古い確認内容で登録できない', async ({ page, app }) => {
  await test.step('開始条件', async () => {
    await signIn(page);
    await page.getByRole('link', { name: /一括登録/ }).click();
  });
  await test.step('手順1: 入力内容を確認する', async () => {
    await page.getByLabel('タイトル一覧').fill('変更前');
    await page.getByRole('button', { name: '内容を確認する' }).click();
    await expect(page.getByRole('heading', { name: '2. 内容を確認して保存' })).toBeVisible();
  });
  await test.step('手順1', async () => {
    await page.goBack();
    await page.getByLabel('タイトル一覧').fill('変更後');
    await page.goForward();
  });
  await test.step('受け入れ条件', async () => {
    await expect(page.getByLabel('タイトル一覧')).toHaveValue('変更後');
    await expect(page.getByRole('button', { name: '一括登録する', exact: true })).toHaveCount(0);
    expect(app.rows()).toEqual([]);
  });
});
