import { test, expect } from '../../fixtures.ts';
import { signIn, saveFromUI } from '../../helpers.ts';

test('同じDBの二つの対話では古い版の上書きを拒否し、下書きを維持する', async ({
  page,
  context,
  app,
}) => {
  // Arrange
  await signIn(page);
  await saveFromUI(page, '競合対象', '初期');
  const second = await context.newPage();
  await second.goto('/notes');
  await second.getByRole('button', { name: '競合対象を編集' }).click();
  await second.getByLabel('本文', { exact: true }).fill('残す競合下書き');
  await page.getByLabel('本文', { exact: true }).fill('先に確定');
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect.poll(() => app.rows()[0]?.version).toBe(2);

  // Act
  await second.getByRole('button', { name: '保存する', exact: true }).click();

  // Assert
  await expect(second.getByRole('alert')).toContainText('別の操作で更新されています。');
  await expect(second.getByLabel('本文', { exact: true })).toHaveValue('残す競合下書き');
  expect(app.rows()).toEqual([
    { owner_id: 'alice', title: '競合対象', body: '先に確定', version: 2 },
  ]);
  await second.close();
});
