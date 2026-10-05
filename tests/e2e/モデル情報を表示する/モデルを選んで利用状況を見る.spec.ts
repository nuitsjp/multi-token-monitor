import type {
  Page as Page_part14,
  Locator as Locator_part15,
  Page as Page_part15,
} from '@playwright/test';
import {
  expect as expect_part14,
  models as models_part14,
  test as base_part14,
  dayBefore as dayBefore_part15,
  expect as expect_part15,
  models as models_part15,
  storedSnapshot as storedSnapshot_part15,
  test as test_part15,
  waitSaved as waitSaved_part15,
} from '../hub-usage/hub-usage.ts';
import type { HistoryStats as HistoryStats_part14 } from '../hub-usage/hub-usage.ts';
import { startFakeHub as startFakeHub_part14 } from '../hub-sync/fake-hub.ts';
import { query as query_part14 } from '../hub-sync/sync.ts';
import { test as describePart14, test as describePart15 } from '@playwright/test';

describePart14.describe('sort-model-usage', () => {
  type Page = Page_part14;
  const expect = expect_part14;
  const models = models_part14;
  const base = base_part14;
  type HistoryStats = HistoryStats_part14;
  const startFakeHub = startFakeHub_part14;
  const query = query_part14;

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
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('radio', { name: 'All', exact: true })).toBeChecked();

      await expect(page.getByRole('radio', { name: 'Tokens', exact: true })).toBeChecked();

      await expect(names(page)).toHaveText([...models.slice(0, 6), 'work-only', 'personal-only']);
    });
    await test.step('手順2', async () => {
      await scope(page, 'Personal');
    });
    const personal = [...models.slice(0, 6), 'personal-only'];
    await test.step('受け入れ条件', async () => {
      await expect(names(page)).toHaveText(personal);

      await expect(selected(page)).toHaveText(personal.slice(0, 5));
    });
    await test.step('手順4', async () => {
      await page.locator('.by-model-tile').filter({ hasText: 'shared-model' }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(selected(page)).toHaveCount(4);
    });
    await test.step('手順3', async () => {
      await sort(page, 'Cost');
    });
    const descendingCost = [...personal].reverse();
    await test.step('受け入れ条件', async () => {
      await expect(names(page)).toHaveText(descendingCost);

      await expect(selected(page)).toHaveText(descendingCost.slice(0, 5));
    });
    await test.step('手順2', async () => {
      await scope(page, 'Work');
    });
    await test.step('受け入れ条件', async () => {
      await expect(names(page)).toHaveText(['work-only', ...models.slice(0, 6).reverse()]);

      await expect(selected(page)).toHaveText(['work-only', ...models.slice(2, 6).reverse()]);
    });
    await test.step('手順3', async () => {
      await sort(page, 'Tokens');
    });
    await test.step('受け入れ条件', async () => {
      await expect(selected(page)).toHaveText(models.slice(0, 5));
    });
    await test.step('手順2', async () => {
      await scope(page, 'Small');
    });
    await test.step('受け入れ条件', async () => {
      await expect(names(page)).toHaveText(models.slice(0, 3));

      await expect(selected(page)).toHaveText(models.slice(0, 3));
    });
    await test.step('手順2', async () => {
      await scope(page, 'Empty');
    });
    await test.step('受け入れ条件', async () => {
      await expect(names(page)).toHaveCount(0);

      await expect(selected(page)).toHaveCount(0);

      await expect(page.getByRole('checkbox', { name: 'Select all' })).toBeDisabled();
    });
    await test.step('手順2', async () => {
      await scope(page, 'All');
    });
    await test.step('受け入れ条件', async () => {
      await expect(selected(page)).toHaveText(models.slice(0, 5));
    });
  });

  test('MOD-10 Cost順の選択を期間・集計単位の変更で保持し、操作はAPIを再取得しない', async ({
    page,
  }) => {
    let previous = -1;
    let requests = 0;
    await test.step('開始条件', async () => {
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/hub-usage') requests++;
      });

      await page.reload();
    });
    await test.step('受け入れ条件', async () => {
      await expect(selected(page)).toHaveCount(5);
    });
    await test.step('開始条件', async () => {
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
    });
    const initialRequests = requests;
    await test.step('手順2', async () => {
      await scope(page, 'Personal');
    });
    await test.step('手順3', async () => {
      await sort(page, 'Cost');
    });
    await test.step('手順4', async () => {
      await page.locator('.by-model-tile').filter({ hasText: 'personal-only' }).click();
    });
    const chosen = ['model-f', 'model-e', 'model-d', 'model-c'];
    await test.step('受け入れ条件', async () => {
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
    });
    await test.step('開始条件', async () => {
      await page.getByRole('checkbox', { name: 'Select all' }).focus();
    });
    await test.step('手順6', async () => {
      await page.getByText('7D', { exact: true }).click();
    });
    await test.step('手順7', async () => {
      await page.getByLabel('Aggregation').selectOption('weekly');
    });
    await test.step('受け入れ条件', async () => {
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
                sum +
                Number(element.getAttribute('aria-label')!.split(': ')[1].replace(/[$,]/g, '')),
              0,
            ),
          );
        expect(total).toBe(label === 'Model tokens' ? 58_800_000 : 392);
      }

      expect(requests).toBe(initialRequests);
    });
  });

  test('MOD-11 Hub名のアイコンはConnected／Not received／Reconnectingを示し、時刻は表示しない', async ({
    page,
    personal,
  }) => {
    const hubs = page.getByRole('radiogroup', { name: 'Hub', exact: true });
    await test.step('受け入れ条件', async () => {
      await expect(hubs.getByRole('img', { name: 'Connected', exact: true })).toHaveCount(3);

      await expect(hubs.getByRole('img', { name: 'Connected', exact: true }).first()).toHaveCSS(
        'color',
        'rgb(12, 163, 12)',
      );
    });
    await test.step('手順9', async () => {
      await hubs.getByRole('img', { name: 'Connected', exact: true }).first().hover();
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('tooltip', { name: 'Connected', exact: true })).toBeVisible();

      await expect(hubs.getByRole('img', { name: 'Not received', exact: true })).toHaveCount(1);
    });
    await test.step('手順9', async () => {
      await hubs.getByRole('img', { name: 'Not received', exact: true }).hover();
    });
    await test.step('受け入れ条件', async () => {
      await expect(hubs.getByRole('img', { name: 'Not received', exact: true })).toHaveCSS(
        'color',
        'rgb(250, 178, 25)',
      );

      await expect(page.getByRole('tooltip', { name: 'Not received', exact: true })).toBeVisible();

      await expect(page.getByText('Last received')).toHaveCount(0);
    });
    await test.step('開始条件', async () => {
      await page.mouse.move(0, 0);

      personal.fail('unauthorized', 'unauthorized', 'unauthorized');

      personal.disconnect();
    });
    await test.step('受け入れ条件', async () => {
      await expect(hubs.getByRole('img', { name: 'Reconnecting', exact: true })).toHaveCount(1);
    });
    await test.step('手順9', async () => {
      await hubs.getByRole('img', { name: 'Reconnecting', exact: true }).hover();
    });
    await test.step('受け入れ条件', async () => {
      await expect(hubs.getByRole('img', { name: 'Reconnecting', exact: true })).toHaveCSS(
        'color',
        'rgb(250, 178, 25)',
      );

      await expect(page.getByRole('tooltip', { name: 'Reconnecting', exact: true })).toBeVisible();

      await expect(selected(page)).toHaveText(models.slice(0, 5));
    });
  });

  test('MOD-12 同値は名前順、Cost不明は最後に配置する', async ({ page, personal }) => {
    const stats = personal.stats as HistoryStats;
    await test.step('開始条件', async () => {
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
    });
    await test.step('手順2', async () => {
      await scope(page, 'Personal');
    });
    await test.step('受け入れ条件', async () => {
      await expect(names(page)).toHaveText([
        'model-b',
        'shared-model',
        ...models.slice(2, 6),
        'personal-only',
      ]);
    });
    await test.step('手順3', async () => {
      await sort(page, 'Cost');
    });
    await test.step('受け入れ条件', async () => {
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
  });
});
describePart15.describe('view-model-usage', () => {
  type Locator = Locator_part15;
  type Page = Page_part15;
  const dayBefore = dayBefore_part15;
  const expect = expect_part15;
  const models = models_part15;
  const storedSnapshot = storedSnapshot_part15;
  const test = test_part15;
  const waitSaved = waitSaved_part15;

  // 2つのHub（各2端末）を合わせた1日の合計。モデルごとは (7 - 順位) × 900,000 トークン、(7 - 順位) × 9 USD。
  const dailyTokens = 25_200_000;
  const dailyCost = 252;
  const palette = ['#9789c7', '#6b9eac', '#bf966b', '#83a584', '#b97d94', '#c7b26b', '#6bbfa7'];
  const other = '#626572';

  const tokenChart = (page: Page) => page.getByRole('img', { name: 'Model tokens', exact: true });
  const costChart = (page: Page) =>
    page.getByRole('img', { name: 'Estimated cost (USD)', exact: true });
  const tile = (page: Page, name: string) =>
    page.locator('.by-model-tile').filter({ has: page.getByText(name, { exact: true }) });
  const selectAll = (page: Page) => page.getByRole('checkbox', { name: 'Select all' });
  const selectedNames = (page: Page) =>
    page.locator('.by-model-tile[aria-pressed="true"] .by-model-tile-name');
  const legend = (page: Page) => page.locator('.by-model-legend');

  async function chartTotal(chart: Locator) {
    const summaries = await chart
      .locator('[role="graphics-symbol"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')!));
    return summaries.reduce(
      (total, summary) => total + Number(summary.split(': ')[1].replace(/[$,]/g, '')),
      0,
    );
  }
  const fills = (page: Page, chart: Locator) =>
    chart
      .locator('g')
      .filter({ has: page.locator('.hub-chart-target') })
      .first()
      .locator('rect:not(.hub-chart-target)')
      .evaluateAll((rects) => rects.map((rect) => rect.getAttribute('fill')));
  const money = (value: number) =>
    value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  async function expectTotals(page: Page, days: number) {
    await expect(page.locator('.by-model-summary')).toHaveText(
      `Tokens${(dailyTokens * days).toLocaleString('en-US')}Cost$${money(dailyCost * days)}`,
    );
    expect(await chartTotal(tokenChart(page))).toBe(dailyTokens * days);
    expect(await chartTotal(costChart(page))).toBeCloseTo(dailyCost * days, 2);
  }
  const verticalOverflow = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollHeight - innerHeight);

  test('MOD-1 全Hubを合算し、Tokens順の上位5モデルを選択して2W・Dailyで表示する', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);

      await page.setViewportSize({ width: 1440, height: 800 });
    });
    await test.step('手順1', async () => {
      await page.goto('/by-model');
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('radio', { name: '2W', exact: true })).toBeChecked();

      await expect(page.getByLabel('Aggregation')).toHaveValue('daily');

      await expect(page.locator('.by-model-tile .by-model-tile-name')).toHaveText(models);

      await expect(selectedNames(page)).toHaveText(models.slice(0, 5));

      await expect(page.locator('.by-model-select-all')).toContainText('5 / 7');

      await expectTotals(page, 14);

      await expect(tokenChart(page).locator('[role="graphics-symbol"]')).toHaveCount(14);

      await expect(legend(page).locator('p')).toHaveText([...models.slice(0, 5), 'Other']);

      expect(await fills(page, tokenChart(page))).toEqual([...palette.slice(0, 5), other]);

      expect(await fills(page, costChart(page))).toEqual([...palette.slice(0, 5), other]);
    });

    const first = tile(page, 'shared-model');
    await test.step('受け入れ条件', async () => {
      await expect(first).toContainText('25.0%');

      await expect(first).toContainText('$882.00');

      await expect(first).toContainText('88,200,000 tokens');

      await expect(tile(page, 'model-g')).toContainText('3.6%');

      await expect(page.getByText('Last received')).toHaveCount(0);

      await expect(page.getByText('Connected')).toHaveCount(0);

      expect(await verticalOverflow(page)).toBe(0);
    });
  });

  test('MOD-2 タイルの選択は両グラフとタイルの色を保ち、未選択を合算し、合計は変えない', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);
    });
    await test.step('手順1', async () => {
      await page.goto('/by-model');
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 14);
    });
    await test.step('手順4', async () => {
      await tile(page, 'shared-model').click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(tile(page, 'shared-model')).toHaveAttribute('aria-pressed', 'false');

      await expect(selectedNames(page)).toHaveText(models.slice(1, 5));

      await expect(page.locator('.by-model-select-all')).toContainText('4 / 7');

      await expectTotals(page, 14);

      expect(await fills(page, tokenChart(page))).toEqual([...palette.slice(1, 5), other]);

      expect(await fills(page, costChart(page))).toEqual([...palette.slice(1, 5), other]);

      await expect(legend(page).locator('p')).toHaveText([...models.slice(1, 5), 'Other']);
    });
    await test.step('手順8', async () => {
      await tokenChart(page).locator('[role="graphics-symbol"]').first().focus();
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('tooltip')).toContainText('Other');

      await expect(page.getByRole('tooltip')).toContainText('9,000,000');
    });
    await test.step('開始条件', async () => {
      // キーボードでも切り替えられる。
      await tile(page, 'shared-model').focus();

      await page.keyboard.press('Space');
    });
    await test.step('受け入れ条件', async () => {
      await expect(tile(page, 'shared-model')).toHaveAttribute('aria-pressed', 'true');
    });
    await test.step('開始条件', async () => {
      await page.keyboard.press('Enter');
    });
    await test.step('受け入れ条件', async () => {
      await expect(tile(page, 'shared-model')).toHaveAttribute('aria-pressed', 'false');
    });
    await test.step('開始条件', async () => {
      await page.keyboard.press('Enter');
    });
    await test.step('受け入れ条件', async () => {
      await expect(selectedNames(page)).toHaveText(models.slice(0, 5));

      await expectTotals(page, 14);
    });
  });

  test('MOD-3 Select allは三状態で、全選択・全解除してもグラフと上部の合計は変えない', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);
    });
    await test.step('手順1', async () => {
      await page.goto('/by-model');
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 14);
    });
    const state = () =>
      selectAll(page).evaluate((box: HTMLInputElement) => ({
        checked: box.checked,
        indeterminate: box.indeterminate,
      }));
    await test.step('受け入れ条件', async () => {
      expect(await state()).toEqual({ checked: false, indeterminate: true });
    });
    await test.step('手順5', async () => {
      await selectAll(page).click();
    });
    await test.step('受け入れ条件', async () => {
      expect(await state()).toEqual({ checked: true, indeterminate: false });

      await expect(selectedNames(page)).toHaveText(models);

      await expect(page.locator('.by-model-select-all')).toContainText('7 / 7');

      await expect(legend(page).locator('p')).toHaveText(models);

      expect(await fills(page, tokenChart(page))).toEqual(palette);

      await expectTotals(page, 14);
    });
    await test.step('手順5', async () => {
      await selectAll(page).click();
    });
    await test.step('受け入れ条件', async () => {
      expect(await state()).toEqual({ checked: false, indeterminate: false });

      await expect(selectedNames(page)).toHaveCount(0);

      await expect(page.locator('.by-model-select-all')).toContainText('0 / 7');

      await expect(legend(page).locator('p')).toHaveText(['Other']);

      expect(await fills(page, tokenChart(page))).toEqual([other]);

      await expect(page.getByText('Select a model to show the chart.')).toHaveCount(0);

      await expectTotals(page, 14);
    });
    await test.step('手順4', async () => {
      await tile(page, 'model-g').click();
    });
    await test.step('受け入れ条件', async () => {
      expect(await state()).toEqual({ checked: false, indeterminate: true });
    });
    await test.step('手順5', async () => {
      await selectAll(page).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(selectedNames(page)).toHaveText(models);
    });
    await test.step('手順4', async () => {
      await tile(page, 'model-g').click();
    });
    await test.step('受け入れ条件', async () => {
      expect(await state()).toEqual({ checked: false, indeterminate: true });
    });
  });

  test('MOD-4 期間と集約単位を切り替えても選択を名前で保ち、合計は集約単位で変えない', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);
    });
    await test.step('手順1', async () => {
      await page.goto('/by-model');
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 14);
    });
    await test.step('手順4', async () => {
      await tile(page, 'model-b').click();
    });
    await test.step('手順6', async () => {
      // 選択はモデル名で保つ。表示の並びはその期間のTokens順で、4Wは同トークン数のarchive-modelとshared-modelを名前順に並べる。
      for (const [label, days, selected] of [
        ['7D', 7, ['shared-model', 'model-c', 'model-d', 'model-e']],
        ['4W', 28, ['model-c', 'model-d', 'shared-model', 'model-e']],
      ] as const) {
        await page.getByText(label, { exact: true }).click();
        await expectTotals(page, days);
        await expect(tokenChart(page).locator('[role="graphics-symbol"]')).toHaveCount(days);
        await expect(selectedNames(page)).toHaveText(selected);
      }

      await page.getByText('2W', { exact: true }).click();
    });
    const { today } = (await (await page.request.get('/api/hub-usage')).json()) as {
      today: string;
    };
    await test.step('手順7', async () => {
      for (const unit of ['weekly', 'monthly', 'daily']) {
        await page.getByLabel('Aggregation').selectOption(unit);
        await expectTotals(page, 14);
        const keys = new Set(
          Array.from({ length: 14 }, (_, offset) => {
            const day = dayBefore(today, offset);
            if (unit === 'daily') return day;
            if (unit === 'monthly') return day.slice(0, 7);
            const date = new Date(`${day}T12:00:00Z`);
            return dayBefore(day, date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1);
          }),
        );
        await expect(tokenChart(page).locator('[role="graphics-symbol"]')).toHaveCount(keys.size);
        await expect(costChart(page).locator('[role="graphics-symbol"]')).toHaveCount(keys.size);
      }
    });
    await test.step('手順6', async () => {
      // 1Yでは過去のモデルが加わる。選択はモデル名で保ち、新しく現れたモデルは選択しない。
      await page.getByText('1Y', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.locator('.by-model-tile .by-model-tile-name')).toHaveText([
        'archive-model',
        ...models.slice(1),
        'shared-model',
      ]);

      await expect(selectedNames(page)).toHaveText([
        'model-c',
        'model-d',
        'model-e',
        'shared-model',
      ]);

      await expect(page.locator('.by-model-select-all')).toContainText('4 / 8');
    });
    await test.step('手順6', async () => {
      await page.getByText('2W', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(selectedNames(page)).toHaveText(['shared-model', ...models.slice(2, 5)]);

      await expectTotals(page, 14);
    });
  });

  test('MOD-5 選択期間に明細が無いときは数値を「—」にし、期間を戻すと選択も戻る', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);
    });
    await test.step('手順1', async () => {
      await page.goto('/by-model');
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 14);
    });
    await test.step('手順4', async () => {
      await tile(page, 'model-b').click();
    });
    const { today } = (await (await page.request.get('/api/hub-usage')).json()) as {
      today: string;
    };
    await test.step('手順6', async () => {
      await page.getByRole('button', { name: 'Choose date range' }).click();
    });
    await test.step('開始条件', async () => {
      await page.getByLabel('Start date').fill(dayBefore(today, 420));

      await page.getByLabel('End date').fill(dayBefore(today, 400));
    });
    await test.step('手順6', async () => {
      await page.getByRole('button', { name: 'Apply range' }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.locator('.by-model-summary')).toHaveText('Tokens—Cost—');

      await expect(page.getByText('No history for selected range.')).toHaveCount(2);

      await expect(page.locator('.by-model-tile')).toHaveCount(0);

      await expect(selectAll(page)).toBeDisabled();

      await expect(page.locator('.by-model-select-all')).toContainText('0 / 0');
    });
    await test.step('手順6', async () => {
      await page.getByText('2W', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 14);

      await expect(selectedNames(page)).toHaveText(['shared-model', ...models.slice(2, 5)]);
    });
  });

  test('MOD-6 閲覧は保存済みデータだけを読み、選択・期間・集約単位の操作では取得し直さず、接続情報を公開しない', async ({
    page,
    app,
    personal,
    work,
  }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);
    });
    const before = storedSnapshot(app.databasePath);
    const requests: string[] = [];
    await test.step('開始条件', async () => {
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/hub-usage') requests.push(request.url());
      });
    });
    await test.step('手順1', async () => {
      await page.goto('/by-model');
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 14);
    });
    // 開いたときの取得と、変更通知の接続（ready）での取得し直しが落ち着くまで待つ（回数は構成で変わる）。
    let previous = -1;
    await test.step('開始条件', async () => {
      await expect
        .poll(
          () => {
            const same = requests.length === previous && requests.length >= 2;
            previous = requests.length;
            return same;
          },
          { intervals: [500] },
        )
        .toBe(true);
    });
    const opened = requests.length;
    await test.step('手順4', async () => {
      await tile(page, 'model-b').click();
    });
    await test.step('手順5', async () => {
      await selectAll(page).click();
    });
    await test.step('手順6', async () => {
      await page.getByText('7D', { exact: true }).click();
    });
    await test.step('手順7', async () => {
      await page.getByLabel('Aggregation').selectOption('weekly');
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 7);

      expect(requests).toHaveLength(opened);
    });

    const body = await (await page.request.get('/api/hub-usage')).text();
    const html = await page.content();
    await test.step('受け入れ条件', async () => {
      for (const secret of [
        personal.url,
        work.url,
        new URL(personal.url).host,
        new URL(work.url).host,
        personal.token,
        work.token,
      ]) {
        expect(body).not.toContain(secret);
        expect(html).not.toContain(secret);
      }

      expect(storedSnapshot(app.databasePath)).toBe(before);
    });
  });

  test('MOD-7 高さ640pxでも縦にスクロールせず、一覧の見出しは固定してタイルだけをスクロールする', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);

      await page.setViewportSize({ width: 1280, height: 640 });
    });
    await test.step('手順1', async () => {
      await page.goto('/by-model');
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 14);

      expect(await verticalOverflow(page)).toBe(0);
    });
    const tiles = page.locator('.by-model-tiles');
    const scrollable = await tiles.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    );
    await test.step('受け入れ条件', async () => {
      expect(scrollable).toBe(true);

      for (const kind of ['Tokens', 'Est. cost · USD']) {
        const plot = page.locator('.by-model-plot').filter({ hasText: kind });
        expect((await plot.locator('.by-model-plot-body').boundingBox())!.height).toBeGreaterThan(
          100,
        );
      }
    });
    const header = page.locator('.by-model-select-all');
    const headerBefore = (await header.boundingBox())!.y;
    await test.step('開始条件', async () => {
      await tiles.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    });
    const area = (await tiles.boundingBox())!;
    const last = (await tile(page, 'model-g').boundingBox())!;
    await test.step('受け入れ条件', async () => {
      expect(last.y + last.height).toBeLessThanOrEqual(area.y + area.height + 1);

      expect(last.y).toBeGreaterThanOrEqual(area.y);

      expect((await header.boundingBox())!.y).toBe(headerBefore);

      expect(await verticalOverflow(page)).toBe(0);
    });
  });

  test('MOD-8 幅が足りないときは操作欄を折り返して枠に収め、最小幅を下回ると横にスクロールする', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);

      await page.setViewportSize({ width: 975, height: 800 });
    });
    await test.step('手順1', async () => {
      await page.goto('/by-model');
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 14);
    });
    const card = (await page.locator('.by-model-card').first().boundingBox())!;
    await test.step('受け入れ条件', async () => {
      for (const control of [
        page.getByRole('button', { name: 'Choose date range' }),
        page.getByRole('radiogroup', { name: 'Date range' }),
        page.getByLabel('Aggregation'),
      ]) {
        const box = (await control.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
      }

      expect(await verticalOverflow(page)).toBe(0);
    });
    const horizontalOverflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await test.step('受け入れ条件', async () => {
      expect(await horizontalOverflow()).toBe(0);
    });
    await test.step('開始条件', async () => {
      await page.setViewportSize({ width: 600, height: 800 });
    });
    await test.step('受け入れ条件', async () => {
      await expect.poll(horizontalOverflow).toBeGreaterThan(0);
    });
  });
});
