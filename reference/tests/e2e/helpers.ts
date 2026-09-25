import { expect, type Page } from '@playwright/test';
export async function signIn(page: Page, user: 'Alice' | 'Bob' = 'Alice') {
  await page.goto('/notes');
  await page.getByRole('button', { name: `${user}で開始` }).click();
  await expect(page.getByRole('heading', { name: 'メモを作成・編集する' })).toBeVisible();
}
export async function saveFromUI(page: Page, title: string, body = '本文') {
  await page.getByLabel('タイトル', { exact: true }).fill(title);
  await page.getByLabel('本文', { exact: true }).fill(body);
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '保存しました' })).toBeVisible();
}
