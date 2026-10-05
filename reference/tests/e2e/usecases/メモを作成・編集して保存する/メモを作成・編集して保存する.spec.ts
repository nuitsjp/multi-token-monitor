import { test, expect } from '../../fixtures.ts';
import { signIn, saveFromUI } from '../../helpers.ts';

test('作成・編集がUIからSQLiteへ確定し、保存結果と一覧を表示する', async ({ page, app }) => {
  await test.step('開始条件', async () => {
    await signIn(page);
  });
  await test.step('手順1: メモ一覧を開く', async () => {
    await expect(page.getByLabel('タイトル', { exact: true })).toBeVisible();
  });
  await test.step('手順2: メモを入力する', async () => {
    await saveFromUI(page, '同じタイトル', '初期本文');
    await expect
      .poll(() => app.rows())
      .toEqual([{ owner_id: 'alice', title: '同じタイトル', body: '初期本文', version: 1 }]);
  });
  await test.step('手順2: 既存メモを編集する', async () => {
    await page.getByLabel('本文', { exact: true }).fill('更新本文');
  });
  await test.step('手順3: 保存する', async () => {
    await page.getByRole('button', { name: '保存する', exact: true }).click();
  });
  await test.step('受け入れ条件', async () => {
    await expect(page.getByRole('status').filter({ hasText: '保存しました' })).toBeVisible();
    await expect(page.getByText('v2 ·')).toBeVisible();
    expect(app.rows()).toEqual([
      { owner_id: 'alice', title: '同じタイトル', body: '更新本文', version: 2 },
    ]);
    await page.reload();
    await page.getByRole('button', { name: '同じタイトルを編集', exact: true }).click();
    await expect(page.getByLabel('本文', { exact: true })).toHaveValue('更新本文');
  });
});

test('サーバー再起動後も保存結果を読み取れる', async ({ page, app }) => {
  await test.step('開始条件', async () => {
    await signIn(page);
  });
  await test.step('手順1: メモ一覧を開く', async () => {
    await expect(page.getByLabel('タイトル', { exact: true })).toBeVisible();
  });
  await test.step('手順2: 入力する', async () => {
    await page.getByLabel('タイトル', { exact: true }).fill('再起動しても保持');
    await page.getByLabel('本文', { exact: true }).fill('永続化');
  });
  await test.step('手順3: 保存する', async () => {
    await page.getByRole('button', { name: '保存する', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '保存しました' })).toBeVisible();
  });
  await test.step('手順1: 再起動後にメモ一覧を開く', async () => {
    await app.restart();
    await page.goto(app.url + '/notes');
    await page.getByRole('button', { name: 'Aliceで開始' }).click();
  });
  await test.step('手順2: 保存済みメモを選ぶ', async () => {
    await page.getByRole('button', { name: '再起動しても保持を編集' }).click();
  });
  await test.step('受け入れ条件', async () => {
    await expect(page.getByLabel('本文', { exact: true })).toHaveValue('永続化');
    expect(app.rows()[0]?.version).toBe(1);
  });
});

test('別タブの確定をSSEで一覧へ反映する', async ({ page, context, app }) => {
  const second = await test.step('開始条件', async () => {
    await signIn(page);
    const second = await context.newPage();
    await second.goto('/notes');
    await test.step('手順1: 別タブでメモ一覧を開く', async () => {
      await expect(second.getByLabel('タイトル', { exact: true })).toBeVisible();
    });
    await expect(second.getByLabel('通知接続')).toHaveText('変更通知 接続済み');

    return second;
  });
  await test.step('手順2: 入力する', async () => {
    await page.getByLabel('タイトル', { exact: true }).fill('通知を確認');
    await page.getByLabel('本文', { exact: true }).fill('DB確定済み');
  });
  await test.step('手順3: 保存する', async () => {
    await page.getByRole('button', { name: '保存する', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '保存しました' })).toBeVisible();
  });
  await test.step('受け入れ条件', async () => {
    await expect(second.getByRole('button', { name: '通知を確認を編集' })).toBeVisible();
    expect(app.rows()).toHaveLength(1);
    await second.close();
  });
});
