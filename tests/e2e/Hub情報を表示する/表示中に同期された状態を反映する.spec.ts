import { expect, test, waitSaved, type HistoryStats } from '../hub-usage/hub-usage.ts';
import { receivedAt } from '../hub-sync/sync.ts';

test('同期・鮮度更新・再接続中の表示で選択と保存済み利用量を保つ', async ({
  page,
  app,
  personal,
}) => {
  await test.step('分岐条件', async () => {
    await waitSaved(app.databasePath);
    await page.goto('/by-hub');
    await page.getByText('4W', { exact: true }).click();
    await page.getByLabel('Aggregation').selectOption('weekly');
  });
  const summary = page.locator('.by-hub-summary');
  const next = structuredClone(personal.stats) as HistoryStats;
  next.devices[0].history.daily[0].tokens += 1000;
  next.devices[0].history.daily[0].perModel['shared-model'].tokens += 1000;
  next.deviceHistoryRevision = 'updated-while-viewing';
  const devices: HistoryStats['devices'][number][] = next.devices;
  const usage = devices
    .flatMap((device) => device.history.daily.slice(0, 28))
    .flatMap((day) => Object.values(day.perModel));
  const tokens = usage.reduce((total, model) => total + model.tokens, 0);
  const cost = usage.reduce((total, model) => total + (model.cost ?? 0), 0);
  const expected = [
    tokens.toLocaleString('en-US'),
    `$${cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  ];
  const values = summary.locator('.slot-text');
  await test.step('手順1', async () => {
    personal.stats = next;
    personal.send('stats', next);
    await expect(values).toHaveText(expected);
    await expect(page.getByRole('radio', { name: 'Personal', exact: true })).toBeChecked();
    await expect(page.getByRole('radio', { name: '4W', exact: true })).toBeChecked();
    await expect(page.getByLabel('Aggregation')).toHaveValue('weekly');
  });
  const before = receivedAt(app.databasePath, 'z-personal');
  await test.step('手順2', async () => {
    const updatedAt = new Date(Date.now() + 60000).toISOString();
    personal.send('freshness', {
      updatedAt,
      staleAfterMs: 600000,
      limits: { updatedAt },
      devices: next.devices.map((device) => ({
        deviceId: device.deviceId,
        updatedAt,
        receivedAt: updatedAt,
        ageMs: 0,
        stale: false,
      })),
    });
    await expect.poll(() => receivedAt(app.databasePath, 'z-personal')).not.toBe(before);
    await expect(
      page.getByRole('region', { name: 'Usage by device' }).getByText('Stale', { exact: true }),
    ).toHaveCount(0);
    await expect(values).toHaveText(expected);
  });
  await test.step('手順3', async () => {
    personal.fail('unauthorized', 'unauthorized');
    personal.disconnect();
    await expect(
      page.locator('.by-hub-status').getByText('Reconnecting', { exact: false }),
    ).toBeVisible();
    await expect(page.getByText(/Last received/)).toBeVisible();
    await expect(values).toHaveText(expected);
  });
  await test.step('受け入れ条件', async () => {
    await expect(page.getByRole('radio', { name: 'Personal', exact: true })).toBeChecked();
    await expect(page.getByRole('radio', { name: '4W', exact: true })).toBeChecked();
    await expect(page.getByLabel('Aggregation')).toHaveValue('weekly');
  });
});
