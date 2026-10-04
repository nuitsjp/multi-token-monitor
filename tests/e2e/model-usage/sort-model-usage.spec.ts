import type { Page } from '@playwright/test';
import { expect, models, test as base, type HistoryStats } from '../hub-usage/hub-usage.ts';
import { startFakeHub } from '../hub-sync/fake-hub.ts';
import { query } from '../hub-sync/sync.ts';

// Keep the By hub fixture unchanged. These histories deliberately rank Cost opposite to Tokens.
const test = base.extend({
  personal: async ({ personal }, use) => {
    customize(personal.stats as HistoryStats, 'personal-only');
    await use(personal);
  },
  work: async ({ work }, use) => {
    customize(work.stats as HistoryStats, 'work-only');
    await use(work);
  },
  hubs: async ({ personal, work }, use) => {
    const stats = structuredClone(personal.stats) as HistoryStats;
    stats.deviceHistoryRevision = 'small-history';
    stats.devices.splice(1);
    for (const day of stats.devices[0].history.daily) {
      day.perModel = Object.fromEntries(Object.entries(day.perModel).slice(0, 3));
      day.tokens = Object.values(day.perModel).reduce((sum, usage) => sum + usage.tokens, 0);
    }
    setToday(stats);
    const small = await startFakeHub('small-token', stats);
    try {
      await use([
        { id: 'personal', name: 'Personal', url: personal.url, token: personal.token },
        { id: 'work', name: 'Work', url: work.url, token: work.token },
        { id: 'small', name: 'Small', url: small.url, token: small.token },
        { id: 'empty', name: 'Empty', url: 'http://127.0.0.1:9', token: 'empty-token' },
      ]);
    } finally {
      await small.close();
    }
  },
});

function customize(stats: HistoryStats, unique: string) {
  for (const device of stats.devices) {
    for (const day of device.history.daily) {
      day.perModel = Object.fromEntries(
        Object.entries(day.perModel).map(([name, usage], rank) => [
          name === 'model-g' ? unique : name,
          { ...usage, cost: rank + 1 },
        ]),
      );
    }
  }
  setToday(stats);
}

function setToday(stats: HistoryStats) {
  for (const device of stats.devices) {
    const day = device.history.daily[0];
    device.periods.today = {
      totalTokens: day.tokens,
      clientModels: {
        codex: Object.fromEntries(
          Object.entries(day.perModel).map(([name, usage]) => [name, usage.tokens]),
        ),
      },
      clientModelCosts: {
        codex: Object.fromEntries(
          Object.entries(day.perModel)
            .filter(([, usage]) => usage.cost !== null)
            .map(([name, usage]) => [name, usage.cost!]),
        ),
      },
    };
  }
}

const names = (page: Page) => page.locator('.by-model-tile .by-model-tile-name');
const selected = (page: Page) =>
  page.locator('.by-model-tile[aria-pressed="true"] .by-model-tile-name');
const scope = (page: Page, hub: string) =>
  page
    .getByRole('radiogroup', { name: 'Hub', exact: true })
    .getByText(hub, { exact: true })
    .click();
const sort = (page: Page, value: string) =>
  page.getByRole('radiogroup', { name: 'Sort models' }).getByText(value, { exact: true }).click();

test.beforeEach(async ({ app, page }) => {
  await expect
    .poll(
      () =>
        query<{ count: number }>(
          app.databasePath,
          'SELECT COUNT(*) AS count FROM device_daily_model_usages',
        )[0]?.count,
    )
    .toBe(11_470);
  await page.goto('/by-model');
  await expect(selected(page)).toHaveCount(5);
  const hubs = page.getByRole('radiogroup', { name: 'Hub', exact: true });
  await expect(hubs.getByRole('img', { name: 'Connected', exact: true })).toHaveCount(3);
  await expect(hubs.getByRole('img', { name: 'Not received', exact: true })).toHaveCount(1);
});

test('MOD-9 HubとTokens／Costの切り替えは、その範囲の降順で上位5件を再選択する', async ({
  page,
}) => {
  await expect(page.getByRole('radio', { name: 'All', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Tokens', exact: true })).toBeChecked();
  await expect(names(page)).toHaveText([...models.slice(0, 6), 'work-only', 'personal-only']);
  await scope(page, 'Personal');
  const personal = [...models.slice(0, 6), 'personal-only'];
  await expect(names(page)).toHaveText(personal);
  await expect(selected(page)).toHaveText(personal.slice(0, 5));
  await page.locator('.by-model-tile').filter({ hasText: 'shared-model' }).click();
  await expect(selected(page)).toHaveCount(4);
  await sort(page, 'Cost');
  const descendingCost = [...personal].reverse();
  await expect(names(page)).toHaveText(descendingCost);
  await expect(selected(page)).toHaveText(descendingCost.slice(0, 5));
  await scope(page, 'Work');
  await expect(names(page)).toHaveText(['work-only', ...models.slice(0, 6).reverse()]);
  await expect(selected(page)).toHaveText(['work-only', ...models.slice(2, 6).reverse()]);
  await sort(page, 'Tokens');
  await expect(selected(page)).toHaveText(models.slice(0, 5));
  await scope(page, 'Small');
  await expect(names(page)).toHaveText(models.slice(0, 3));
  await expect(selected(page)).toHaveText(models.slice(0, 3));
  await scope(page, 'Empty');
  await expect(names(page)).toHaveCount(0);
  await expect(selected(page)).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Select all' })).toBeDisabled();
  await scope(page, 'All');
  await expect(selected(page)).toHaveText(models.slice(0, 5));
});

test('MOD-10 Cost順の選択を期間・集計単位の変更で保持し、操作はAPIを再取得しない', async ({
  page,
}) => {
  let previous = -1;
  let requests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/hub-usage') requests++;
  });
  await page.reload();
  await expect(selected(page)).toHaveCount(5);
  await expect
    .poll(
      () => {
        const stable = previous === requests && requests >= 2;
        previous = requests;
        return stable;
      },
      { intervals: [500] },
    )
    .toBe(true);
  const initialRequests = requests;
  await scope(page, 'Personal');
  await sort(page, 'Cost');
  await page.locator('.by-model-tile').filter({ hasText: 'personal-only' }).click();
  const chosen = ['model-f', 'model-e', 'model-d', 'model-c'];
  await expect(selected(page)).toHaveText(chosen);
  for (const [label, amount] of [
    ['Model tokens', '600,000'],
    ['Estimated cost (USD)', '$12.00'],
  ]) {
    await page
      .getByRole('img', { name: label, exact: true })
      .locator('[role="graphics-symbol"]')
      .first()
      .focus();
    await expect(
      page.getByRole('tooltip').getByText('model-f', { exact: true }).locator('../..'),
    ).toHaveText(`model-f${amount}`);
    await page.getByRole('checkbox', { name: 'Select all' }).focus();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  }
  await page.getByRole('checkbox', { name: 'Select all' }).focus();
  await page.getByText('7D', { exact: true }).click();
  await page.getByLabel('Aggregation').selectOption('weekly');
  await expect(selected(page)).toHaveText(chosen);
  await expect(page.locator('.by-model-summary')).toHaveText('Tokens58,800,000Cost$392.00');
  await expect(page.locator('.by-model-legend p')).toHaveText([...chosen, 'Other']);
  for (const label of ['Model tokens', 'Estimated cost (USD)']) {
    const total = await page
      .getByRole('img', { name: label, exact: true })
      .locator('[role="graphics-symbol"]')
      .evaluateAll((elements) =>
        elements.reduce(
          (sum, element) =>
            sum + Number(element.getAttribute('aria-label')!.split(': ')[1].replace(/[$,]/g, '')),
          0,
        ),
      );
    expect(total).toBe(label === 'Model tokens' ? 58_800_000 : 392);
  }
  expect(requests).toBe(initialRequests);
});

test('MOD-11 Hub名のアイコンはConnected／Not received／Reconnectingを示し、時刻は表示しない', async ({
  page,
  personal,
}) => {
  const hubs = page.getByRole('radiogroup', { name: 'Hub', exact: true });
  await expect(hubs.getByRole('img', { name: 'Connected', exact: true })).toHaveCount(3);
  await expect(hubs.getByRole('img', { name: 'Connected', exact: true }).first()).toHaveCSS(
    'color',
    'rgb(12, 163, 12)',
  );
  await hubs.getByRole('img', { name: 'Connected', exact: true }).first().hover();
  await expect(page.getByRole('tooltip', { name: 'Connected', exact: true })).toBeVisible();
  await expect(hubs.getByRole('img', { name: 'Not received', exact: true })).toHaveCount(1);
  await hubs.getByRole('img', { name: 'Not received', exact: true }).hover();
  await expect(hubs.getByRole('img', { name: 'Not received', exact: true })).toHaveCSS(
    'color',
    'rgb(250, 178, 25)',
  );
  await expect(page.getByRole('tooltip', { name: 'Not received', exact: true })).toBeVisible();
  await expect(page.getByText('Last received')).toHaveCount(0);
  await page.mouse.move(0, 0);
  personal.fail('unauthorized', 'unauthorized', 'unauthorized');
  personal.disconnect();
  await expect(hubs.getByRole('img', { name: 'Reconnecting', exact: true })).toHaveCount(1);
  await hubs.getByRole('img', { name: 'Reconnecting', exact: true }).hover();
  await expect(hubs.getByRole('img', { name: 'Reconnecting', exact: true })).toHaveCSS(
    'color',
    'rgb(250, 178, 25)',
  );
  await expect(page.getByRole('tooltip', { name: 'Reconnecting', exact: true })).toBeVisible();
  await expect(selected(page)).toHaveText(models.slice(0, 5));
});

test('MOD-12 同値は名前順、Cost不明は最後に配置する', async ({ page, personal }) => {
  const stats = personal.stats as HistoryStats;
  for (const device of stats.devices) {
    for (const day of device.history.daily) {
      const leading = day.perModel['shared-model'] ?? day.perModel['archive-model'];
      day.perModel['model-b'].tokens = leading.tokens;
      day.perModel['model-e'].cost = day.perModel['model-d'].cost;
      day.perModel['model-f'].cost = null;
      day.tokens = Object.values(day.perModel).reduce((sum, usage) => sum + usage.tokens, 0);
    }
  }
  setToday(stats);
  stats.deviceHistoryRevision = 'ties-and-unknown-cost';
  personal.send('stats', stats);
  await scope(page, 'Personal');
  await expect(names(page)).toHaveText([
    'model-b',
    'shared-model',
    ...models.slice(2, 6),
    'personal-only',
  ]);
  await sort(page, 'Cost');
  await expect(names(page)).toHaveText([
    'personal-only',
    'model-d',
    'model-e',
    'model-c',
    'model-b',
    'shared-model',
    'model-f',
  ]);
  await expect(selected(page)).toHaveText([
    'personal-only',
    'model-d',
    'model-e',
    'model-c',
    'model-b',
  ]);
});
