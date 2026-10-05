import { expect, test, waitSaved } from '../hub-usage/hub-usage.ts';

test('メニューから各閲覧ページへ移動する', async ({ page, app }) => {
  await test.step('分岐条件', async () => {
    await waitSaved(app.databasePath);
  });
  const menu = page.getByRole('navigation', { name: 'Menu' });
  await test.step('手順1', async () => {
    await page.goto('/');
    await expect(menu.locator(':scope > a, :scope > button')).toHaveText([
      'Home',
      'By hub',
      'By model',
      'By device',
      'Usage limits',
    ]);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Home');
  });
  await test.step('手順2', async () => {
    for (const [name, url] of [
      ['By hub', '/by-hub'],
      ['By model', '/by-model'],
      ['By device', '/by-device'],
    ]) {
      await menu.getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${url}$`));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
      await expect(menu.getByRole('link', { name, exact: true })).toHaveAttribute(
        'data-active',
        'true',
      );
    }
  });
  await test.step('手順3', async () => {
    await menu.getByRole('link', { name: 'Usage limits' }).click();
    await expect(page).toHaveURL(/\/limits$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Usage limits');
  });
  await test.step('受け入れ条件', async () => {
    await expect(menu.getByRole('link', { name: 'Usage limits' })).toHaveAttribute(
      'data-active',
      'true',
    );
    await menu.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Home');
  });
});
