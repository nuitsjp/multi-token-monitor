import type { Locator, Page } from '@playwright/test';
import {
  dayBefore,
  expect,
  models,
  storedSnapshot,
  test,
  waitSaved,
} from '../hub-usage/hub-usage.ts';

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

test('MOD-1 全Hubを合算し、コスト順の上位5モデルを選択して2W・Dailyで表示する', async ({
  page,
  app,
}) => {
  await waitSaved(app.databasePath);
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/by-model');
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

  const first = tile(page, 'shared-model');
  await expect(first).toContainText('25.0%');
  await expect(first).toContainText('$882.00');
  await expect(first).toContainText('88,200,000 tokens');
  await expect(tile(page, 'model-g')).toContainText('3.6%');
  await expect(page.getByText('Last received')).toHaveCount(0);
  await expect(page.getByText('Connected')).toHaveCount(0);
  expect(await verticalOverflow(page)).toBe(0);
});

test('MOD-2 タイルの選択は両グラフとタイルの色を保ち、未選択を合算し、合計は変えない', async ({
  page,
  app,
}) => {
  await waitSaved(app.databasePath);
  await page.goto('/by-model');
  await expectTotals(page, 14);
  await tile(page, 'shared-model').click();
  await expect(tile(page, 'shared-model')).toHaveAttribute('aria-pressed', 'false');
  await expect(selectedNames(page)).toHaveText(models.slice(1, 5));
  await expect(page.locator('.by-model-select-all')).toContainText('4 / 7');
  await expectTotals(page, 14);
  expect(await fills(page, tokenChart(page))).toEqual([...palette.slice(1, 5), other]);
  expect(await fills(page, costChart(page))).toEqual([...palette.slice(1, 5), other]);
  await expect(legend(page).locator('p')).toHaveText([...models.slice(1, 5), 'Other']);
  await tokenChart(page).locator('[role="graphics-symbol"]').first().focus();
  await expect(page.getByRole('tooltip')).toContainText('Other');
  await expect(page.getByRole('tooltip')).toContainText('9,000,000');

  // キーボードでも切り替えられる。
  await tile(page, 'shared-model').focus();
  await page.keyboard.press('Space');
  await expect(tile(page, 'shared-model')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(tile(page, 'shared-model')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Enter');
  await expect(selectedNames(page)).toHaveText(models.slice(0, 5));
  await expectTotals(page, 14);
});

test('MOD-3 Select allは三状態で、全選択・全解除してもグラフと上部の合計は変えない', async ({
  page,
  app,
}) => {
  await waitSaved(app.databasePath);
  await page.goto('/by-model');
  await expectTotals(page, 14);
  const state = () =>
    selectAll(page).evaluate((box: HTMLInputElement) => ({
      checked: box.checked,
      indeterminate: box.indeterminate,
    }));
  expect(await state()).toEqual({ checked: false, indeterminate: true });

  await selectAll(page).click();
  expect(await state()).toEqual({ checked: true, indeterminate: false });
  await expect(selectedNames(page)).toHaveText(models);
  await expect(page.locator('.by-model-select-all')).toContainText('7 / 7');
  await expect(legend(page).locator('p')).toHaveText(models);
  expect(await fills(page, tokenChart(page))).toEqual(palette);
  await expectTotals(page, 14);

  await selectAll(page).click();
  expect(await state()).toEqual({ checked: false, indeterminate: false });
  await expect(selectedNames(page)).toHaveCount(0);
  await expect(page.locator('.by-model-select-all')).toContainText('0 / 7');
  await expect(legend(page).locator('p')).toHaveText(['Other']);
  expect(await fills(page, tokenChart(page))).toEqual([other]);
  await expect(page.getByText('Select a model to show the chart.')).toHaveCount(0);
  await expectTotals(page, 14);

  await tile(page, 'model-g').click();
  expect(await state()).toEqual({ checked: false, indeterminate: true });
  await selectAll(page).click();
  await expect(selectedNames(page)).toHaveText(models);
  await tile(page, 'model-g').click();
  expect(await state()).toEqual({ checked: false, indeterminate: true });
});

test('MOD-4 期間と集約単位を切り替えても選択を名前で保ち、合計は集約単位で変えない', async ({
  page,
  app,
}) => {
  await waitSaved(app.databasePath);
  await page.goto('/by-model');
  await expectTotals(page, 14);
  await tile(page, 'model-b').click();
  // 選択はモデル名で保つ。表示の並びはその期間のコスト順で、4Wは同コストのarchive-modelとshared-modelを名前順に並べる。
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
  const { today } = (await (await page.request.get('/api/hub-usage')).json()) as {
    today: string;
  };
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

  // 1Yでは過去のモデルが加わる。選択はモデル名で保ち、新しく現れたモデルは選択しない。
  await page.getByText('1Y', { exact: true }).click();
  await expect(page.locator('.by-model-tile .by-model-tile-name')).toHaveText([
    'archive-model',
    ...models.slice(1),
    'shared-model',
  ]);
  await expect(selectedNames(page)).toHaveText(['model-c', 'model-d', 'model-e', 'shared-model']);
  await expect(page.locator('.by-model-select-all')).toContainText('4 / 8');
  await page.getByText('2W', { exact: true }).click();
  await expect(selectedNames(page)).toHaveText(['shared-model', ...models.slice(2, 5)]);
  await expectTotals(page, 14);
});

test('MOD-5 選択期間に明細が無いときは数値を「—」にし、期間を戻すと選択も戻る', async ({
  page,
  app,
}) => {
  await waitSaved(app.databasePath);
  await page.goto('/by-model');
  await expectTotals(page, 14);
  await tile(page, 'model-b').click();
  const { today } = (await (await page.request.get('/api/hub-usage')).json()) as {
    today: string;
  };
  await page.getByRole('button', { name: 'Choose date range' }).click();
  await page.getByLabel('Start date').fill(dayBefore(today, 420));
  await page.getByLabel('End date').fill(dayBefore(today, 400));
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expect(page.locator('.by-model-summary')).toHaveText('Tokens—Cost—');
  await expect(page.getByText('No history for selected range.')).toHaveCount(2);
  await expect(page.locator('.by-model-tile')).toHaveCount(0);
  await expect(selectAll(page)).toBeDisabled();
  await expect(page.locator('.by-model-select-all')).toContainText('0 / 0');

  await page.getByText('2W', { exact: true }).click();
  await expectTotals(page, 14);
  await expect(selectedNames(page)).toHaveText(['shared-model', ...models.slice(2, 5)]);
});

test('MOD-6 閲覧は保存済みデータだけを読み、選択・期間・集約単位の操作では取得し直さず、接続情報を公開しない', async ({
  page,
  app,
  personal,
  work,
}) => {
  await waitSaved(app.databasePath);
  const before = storedSnapshot(app.databasePath);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/hub-usage') requests.push(request.url());
  });
  await page.goto('/by-model');
  await expectTotals(page, 14);
  // 開いたときの取得と、変更通知の接続（ready）での取得し直しが落ち着くまで待つ（回数は構成で変わる）。
  let previous = -1;
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
  const opened = requests.length;
  await tile(page, 'model-b').click();
  await selectAll(page).click();
  await page.getByText('7D', { exact: true }).click();
  await page.getByLabel('Aggregation').selectOption('weekly');
  await expectTotals(page, 7);
  expect(requests).toHaveLength(opened);

  const body = await (await page.request.get('/api/hub-usage')).text();
  const html = await page.content();
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

test('MOD-7 高さ640pxでも縦にスクロールせず、一覧の見出しは固定してタイルだけをスクロールする', async ({
  page,
  app,
}) => {
  await waitSaved(app.databasePath);
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto('/by-model');
  await expectTotals(page, 14);
  expect(await verticalOverflow(page)).toBe(0);
  const tiles = page.locator('.by-model-tiles');
  const scrollable = await tiles.evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(scrollable).toBe(true);
  for (const kind of ['Tokens', 'Est. cost · USD']) {
    const plot = page.locator('.by-model-plot').filter({ hasText: kind });
    expect((await plot.locator('.by-model-plot-body').boundingBox())!.height).toBeGreaterThan(100);
  }
  const header = page.locator('.by-model-select-all');
  const headerBefore = (await header.boundingBox())!.y;
  await tiles.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const area = (await tiles.boundingBox())!;
  const last = (await tile(page, 'model-g').boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(area.y + area.height + 1);
  expect(last.y).toBeGreaterThanOrEqual(area.y);
  expect((await header.boundingBox())!.y).toBe(headerBefore);
  expect(await verticalOverflow(page)).toBe(0);
});

test('MOD-8 幅が足りないときは操作欄を折り返して枠に収め、最小幅を下回ると横にスクロールする', async ({
  page,
  app,
}) => {
  await waitSaved(app.databasePath);
  await page.setViewportSize({ width: 975, height: 800 });
  await page.goto('/by-model');
  await expectTotals(page, 14);
  const card = (await page.locator('.by-model-card').first().boundingBox())!;
  for (const control of [
    page.getByRole('button', { name: 'Choose date range' }),
    page.getByRole('radiogroup', { name: 'Date range' }),
    page.getByLabel('Aggregation'),
  ]) {
    const box = (await control.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
  }
  expect(await verticalOverflow(page)).toBe(0);
  const horizontalOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(await horizontalOverflow()).toBe(0);
  await page.setViewportSize({ width: 600, height: 800 });
  await expect.poll(horizontalOverflow).toBeGreaterThan(0);
});
