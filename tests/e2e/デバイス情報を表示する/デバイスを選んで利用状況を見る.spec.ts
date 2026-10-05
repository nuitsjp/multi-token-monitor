import type { Locator as Locator_part16, Page as Page_part16 } from '@playwright/test';
import {
  dayBefore as dayBefore_part16,
  expect as expect_part16,
  storedSnapshot as storedSnapshot_part16,
  test as test_part16,
  waitSaved as waitSaved_part16,
} from '../hub-usage/hub-usage.ts';
import type { HistoryStats as HistoryStats_part16 } from '../hub-usage/hub-usage.ts';
import { test as describePart16 } from '@playwright/test';

describePart16.describe('view-device-usage', () => {
  type Locator = Locator_part16;
  type Page = Page_part16;
  const dayBefore = dayBefore_part16;
  const expect = expect_part16;
  const storedSnapshot = storedSnapshot_part16;
  const test = test_part16;
  const waitSaved = waitSaved_part16;
  type HistoryStats = HistoryStats_part16;

  // 1日あたりのデバイス別の値。Personal-1・Personal-2・Work-1・Work-2 の順に、トークンは 1:2:2:4、コストは 2:1:4:2。
  const daily = {
    'Personal-1': { tokens: 2_800_000, cost: 56 },
    'Personal-2': { tokens: 5_600_000, cost: 28 },
    'Work-1': { tokens: 5_600_000, cost: 112 },
    'Work-2': { tokens: 11_200_000, cost: 56 },
  };
  type Device = keyof typeof daily;
  const byTokens: Device[] = ['Work-2', 'Personal-2', 'Work-1', 'Personal-1'];
  const byCost: Device[] = ['Work-1', 'Personal-1', 'Work-2', 'Personal-2'];
  const palette = ['#9789c7', '#6b9eac', '#bf966b', '#83a584'];
  const other = '#626572';

  const names = (page: Page) => page.locator('.by-model-tile .by-model-tile-name');
  const selected = (page: Page) =>
    page.locator('.by-model-tile[aria-pressed="true"] .by-model-tile-name');
  const tile = (page: Page, name: string) =>
    page.locator('.by-model-tile').filter({ has: page.getByText(name, { exact: true }) });
  const selectAll = (page: Page) => page.getByRole('checkbox', { name: 'Select all' });
  const legend = (page: Page) => page.locator('.by-model-legend p');
  const plot = (page: Page, kind: 'Tokens' | 'Est. cost · USD') =>
    page.locator('.by-model-plot').filter({ hasText: kind }).getByRole('img');
  const scope = (page: Page, hub: string) =>
    page
      .getByRole('radiogroup', { name: 'Hub', exact: true })
      .getByText(hub, { exact: true })
      .click();
  const sort = (page: Page, value: string) =>
    page
      .getByRole('radiogroup', { name: 'Sort devices' })
      .getByText(value, { exact: true })
      .click();
  const money = (value: number) =>
    value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  async function expectTotals(page: Page, devices: Device[], days: number) {
    const tokens = devices.reduce((sum, name) => sum + daily[name].tokens, 0) * days;
    const cost = devices.reduce((sum, name) => sum + daily[name].cost, 0) * days;
    await expect(page.locator('.by-model-summary')).toHaveText(
      `Tokens${tokens.toLocaleString('en-US')}Cost$${money(cost)}`,
    );
    expect(await chartTotal(plot(page, 'Tokens'))).toBe(tokens);
    expect(await chartTotal(plot(page, 'Est. cost · USD'))).toBeCloseTo(cost, 2);
  }
  const verticalOverflow = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollHeight - innerHeight);

  test('DEV-1 メニューのBy deviceから開き、全Hubのデバイスを Tokens 順に並べて2W・Dailyで表示する', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);

      await page.setViewportSize({ width: 1440, height: 800 });
    });
    await test.step('手順1', async () => {
      await page.goto('/');
    });
    const menu = page.getByRole('navigation', { name: 'Menu' });
    await test.step('受け入れ条件', async () => {
      await expect(menu.locator(':scope > a, :scope > button')).toHaveText([
        'Home',
        'By hub',
        'By model',
        'By device',
        'Usage limits',
      ]);

      await expect(menu.getByText('Devices', { exact: true })).toHaveCount(0);
    });
    await test.step('手順6', async () => {
      await menu.getByRole('link', { name: 'By device' }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(page).toHaveURL(/\/by-device$/);

      await expect(page.getByRole('heading', { level: 1 })).toHaveText('By device');

      await expect(menu.getByRole('link', { name: 'By device' })).toHaveAttribute(
        'data-active',
        'true',
      );

      await expect(page.getByRole('radio', { name: 'All', exact: true })).toBeChecked();

      await expect(page.getByRole('radio', { name: '2W', exact: true })).toBeChecked();

      await expect(page.getByLabel('Aggregation')).toHaveValue('daily');

      await expect(page.getByRole('radio', { name: 'Tokens', exact: true })).toBeChecked();

      await expect(page.getByRole('region', { name: 'Devices' })).toBeVisible();

      await expect(names(page)).toHaveText(byTokens);

      await expect(selected(page)).toHaveText(byTokens);

      await expect(page.locator('.by-model-select-all')).toContainText('4 / 4');

      await expectTotals(page, byTokens, 14);

      await expect(legend(page)).toHaveText(byTokens);

      expect(await fills(page, plot(page, 'Tokens'))).toEqual(palette);

      expect(await fills(page, plot(page, 'Est. cost · USD'))).toEqual(palette);
    });

    const top = tile(page, 'Work-2');
    await test.step('受け入れ条件', async () => {
      await expect(top).toContainText('44.4%');

      await expect(top.locator('.by-model-tile-detail')).toHaveText('Windows');

      await expect(top).toContainText('$784.00');

      await expect(top).toContainText('156,800,000 tokens');

      await expect(tile(page, 'Personal-1')).toContainText('11.1%');

      for (const hidden of ['Stale', 'Live', 'Last seen', 'Last received'])
        await expect(page.getByText(hidden)).toHaveCount(0);
    });
    const hubs = page.getByRole('radiogroup', { name: 'Hub', exact: true });
    await test.step('受け入れ条件', async () => {
      await expect(hubs.getByRole('img', { name: 'Connected', exact: true })).toHaveCount(2);
    });
    await test.step('手順9', async () => {
      await hubs.getByRole('img', { name: 'Connected', exact: true }).first().hover();
      await expect(page.getByRole('tooltip', { name: 'Connected', exact: true })).toBeVisible();
    });
    await test.step('受け入れ条件', async () => {
      expect(await verticalOverflow(page)).toBe(0);
    });
  });

  test('DEV-2 Hubの絞り込みとTokens／Costのソートは、その範囲の降順と同順位のホスト名順で上位5件を選び直す', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);
    });
    await test.step('手順1', async () => {
      await page.goto('/by-device');
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, byTokens, 14);
    });
    await test.step('手順4', async () => {
      await tile(page, 'Work-2').click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(selected(page)).toHaveCount(3);
    });
    await test.step('手順2', async () => {
      await scope(page, 'Work');
    });
    await test.step('受け入れ条件', async () => {
      await expect(names(page)).toHaveText(['Work-2', 'Work-1']);

      await expect(selected(page)).toHaveText(['Work-2', 'Work-1']);

      await expectTotals(page, ['Work-1', 'Work-2'], 14);

      await expect(tile(page, 'Work-2')).toContainText('66.7%');
    });
    await test.step('手順3', async () => {
      await sort(page, 'Cost');
    });
    await test.step('受け入れ条件', async () => {
      await expect(names(page)).toHaveText(['Work-1', 'Work-2']);
    });
    await test.step('手順4', async () => {
      await tile(page, 'Work-1').click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(selected(page)).toHaveText(['Work-2']);
    });
    await test.step('手順6', async () => {
      // Costの同額（Personal-1とWork-2）はホスト名順。ソートとHubの変更でも期間・集約単位は保つ。
      await page.getByText('4W', { exact: true }).click();
    });
    await test.step('手順2', async () => {
      await scope(page, 'All');
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('radio', { name: '4W', exact: true })).toBeChecked();

      await expect(page.getByRole('radio', { name: 'Cost', exact: true })).toBeChecked();

      await expect(names(page)).toHaveText(byCost);

      await expect(selected(page)).toHaveText(byCost);

      await expectTotals(page, byCost, 28);
    });
    await test.step('手順3', async () => {
      // Tokensの同数（Personal-2とWork-1）もホスト名順。
      await sort(page, 'Tokens');
    });
    await test.step('受け入れ条件', async () => {
      await expect(names(page)).toHaveText(byTokens);
    });
    await test.step('手順2', async () => {
      await scope(page, 'Personal');
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('radio', { name: 'Tokens', exact: true })).toBeChecked();

      await expect(names(page)).toHaveText(['Personal-2', 'Personal-1']);
    });
  });

  test('DEV-3 選択しないデバイスはOtherに合算し、選択はデバイスで保ち、操作ではAPIを取得し直さない', async ({
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
      await page.goto('/by-device');
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, byTokens, 14);
    });
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
      await tile(page, 'Work-2').click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(tile(page, 'Work-2')).toHaveAttribute('aria-pressed', 'false');

      await expect(page.locator('.by-model-select-all')).toContainText('3 / 4');

      await expect(legend(page)).toHaveText([...byTokens.slice(1), 'Other']);

      expect(await fills(page, plot(page, 'Tokens'))).toEqual([...palette.slice(1), other]);

      await expectTotals(page, byTokens, 14);
    });
    await test.step('手順8', async () => {
      await plot(page, 'Tokens').locator('[role="graphics-symbol"]').first().focus();
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('tooltip')).toContainText('Other');

      await expect(page.getByRole('tooltip')).toContainText('11,200,000');
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

      await expect(selected(page)).toHaveText(byTokens);
    });
    await test.step('手順5', async () => {
      await selectAll(page).click();
    });
    await test.step('受け入れ条件', async () => {
      expect(await state()).toEqual({ checked: false, indeterminate: false });

      await expect(legend(page)).toHaveText(['Other']);

      await expectTotals(page, byTokens, 14);
    });
    await test.step('開始条件', async () => {
      await tile(page, 'Work-1').focus();

      await page.keyboard.press('Enter');

      await tile(page, 'Personal-1').focus();

      await page.keyboard.press('Space');
    });
    await test.step('受け入れ条件', async () => {
      await expect(selected(page)).toHaveText(['Work-1', 'Personal-1']);
    });
    await test.step('手順6', async () => {
      await page.getByText('7D', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, byTokens, 7);

      await expect(selected(page)).toHaveText(['Work-1', 'Personal-1']);
    });
    await test.step('手順7', async () => {
      for (const unit of ['weekly', 'monthly', 'daily']) {
        await page.getByLabel('Aggregation').selectOption(unit);
        await expectTotals(page, byTokens, 7);
        await expect(names(page)).toHaveText(byTokens);
      }
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

      await expect(page.locator('.by-model-select-all')).toContainText('0 / 0');
    });
    await test.step('手順6', async () => {
      await page.getByText('2W', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(selected(page)).toHaveText(['Work-1', 'Personal-1']);

      expect(requests).toHaveLength(opened);
    });

    const html = await page.content();
    await test.step('受け入れ条件', async () => {
      for (const secret of [personal.url, work.url, personal.token, work.token])
        expect(html).not.toContain(secret);

      expect(storedSnapshot(app.databasePath)).toBe(before);
    });
  });

  // Work-1 を Personal-1 と同じデバイスIDで報告させる。
  const sharedDeviceTest = test.extend({
    work: async ({ work, personal }, use) => {
      const shared = (personal.stats as HistoryStats).devices[0].deviceId;
      (work.stats as HistoryStats).devices[0].deviceId = shared;
      await use(work);
    },
  });

  test.describe('同じデバイスIDが複数のHubにある', () => {
    sharedDeviceTest(
      'DEV-4 1つのデバイスに合算し、登録順で最初のHubのホスト名で示す',
      async ({ page, app }) => {
        await test.step('開始条件', async () => {
          await waitSaved(app.databasePath);
        });
        await test.step('手順1', async () => {
          await page.goto('/by-device');
        });
        await test.step('受け入れ条件', async () => {
          await expect(names(page)).toHaveText(['Work-2', 'Personal-1', 'Personal-2']);
        });
        const merged = tile(page, 'Personal-1');
        await test.step('受け入れ条件', async () => {
          await expect(merged).toContainText('117,600,000 tokens');

          await expect(merged).toContainText('$2,352.00');

          await expect(page.getByText('Work-1', { exact: true })).toHaveCount(0);

          await expectTotals(page, byTokens, 14);
        });
        await test.step('手順2', async () => {
          await scope(page, 'Work');
        });
        await test.step('受け入れ条件', async () => {
          await expect(names(page)).toHaveText(['Work-2', 'Work-1']);

          await expect(tile(page, 'Work-1')).toContainText('78,400,000 tokens');
        });
      },
    );
  });
});
