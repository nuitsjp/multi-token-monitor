import type { Locator, Page } from '@playwright/test';
import {
  dailyCost,
  dailyTokens,
  dayBefore,
  expect,
  models,
  storedSnapshot,
  test,
  waitSaved,
} from './hub-usage.ts';
import { query } from '../hub-sync/sync.ts';

const tokenChart = (page: Page) => page.getByRole('img', { name: 'Model tokens', exact: true });
const costChart = (page: Page) =>
  page.getByRole('img', { name: 'Estimated cost (USD)', exact: true });
async function chartTotal(chart: Locator) {
  const summaries = await chart
    .locator('[role="graphics-symbol"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')!));
  return summaries.reduce(
    (total, summary) => total + Number(summary.split(': ')[1].replace(/[$,]/g, '')),
    0,
  );
}
async function expectTotals(page: Page, days: number, multiplier = 1) {
  await expect(page.locator('.by-hub-summary')).toHaveText(
    `Tokens${(dailyTokens * days * multiplier).toLocaleString('en-US')}Cost$${(dailyCost * days * multiplier).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
  );
  expect(await chartTotal(tokenChart(page))).toBe(dailyTokens * days * multiplier);
  expect(await chartTotal(costChart(page))).toBeCloseTo(dailyCost * days * multiplier, 2);
}

test('HUB-1 登録順で既定の2Wを表示し、Hubを切り替え、デバイス名はリンクにしない', async ({
  page,
  app,
}) => {
  await waitSaved(app.databasePath);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/by-hub');
  await expect(page.getByRole('radio', { name: 'Personal', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: '2W', exact: true })).toBeChecked();
  await expect(page.getByLabel('Aggregation')).toHaveValue('daily');
  await expectTotals(page, 14);
  await expect(tokenChart(page).locator('[role="graphics-symbol"]')).toHaveCount(14);
  const devices = page.getByRole('region', { name: 'Usage by device' });
  await expect(devices.locator('.by-hub-device-name')).toHaveText([/Personal-1/, /Personal-2/]);
  await expect(devices).toContainText('Stale');
  await expect(devices).toContainText('Last seen');
  await expect(devices.locator('.by-hub-device').first()).toContainText('39,200,000');
  await expect(devices.locator('.by-hub-device').first()).toContainText('$784.00');
  await expect(devices.locator('.by-hub-device').last()).toContainText('78,400,000');
  const shares = await devices
    .locator('.by-hub-device')
    .first()
    .getByRole('progressbar')
    .evaluateAll((bars) =>
      bars.map((bar) => ({
        value: Number(bar.getAttribute('aria-valuenow')),
        color: getComputedStyle(bar).backgroundColor,
      })),
    );
  expect(shares[0].value).toBeCloseTo(100 / 3, 1);
  expect(shares[1].value).toBeCloseTo(200 / 3, 1);
  expect(shares.map((share) => share.color)).toEqual(['rgb(107, 158, 172)', 'rgb(151, 137, 199)']);
  const nameOsCenters = await devices.locator('.by-hub-device-name').evaluateAll((links) =>
    links.map((link) => {
      const name = link.getBoundingClientRect();
      const os = link.nextElementSibling!.getBoundingClientRect();
      return Math.abs(name.y + name.height / 2 - os.y - os.height / 2);
    }),
  );
  expect(nameOsCenters.every((difference) => difference < 1)).toBe(true);
  const hostStyles = await devices.locator('.by-hub-device-name').evaluateAll((links) =>
    links.map((link) => {
      const style = getComputedStyle(link.firstElementChild!);
      return { fontSize: style.fontSize, fontWeight: style.fontWeight };
    }),
  );
  expect(hostStyles).toEqual([
    { fontSize: '14px', fontWeight: '400' },
    { fontSize: '14px', fontWeight: '400' },
  ]);
  const [tokensBox, costBox, devicesBox, titleBox, periodBox, unitBox] = await Promise.all([
    tokenChart(page).boundingBox(),
    costChart(page).boundingBox(),
    devices.boundingBox(),
    page.getByRole('heading', { name: 'By model' }).boundingBox(),
    page
      .getByRole('radiogroup', { name: 'Date range' })
      .getByText('2W', { exact: true })
      .boundingBox(),
    page.getByLabel('Aggregation').boundingBox(),
  ]);
  expect(costBox!.y).toBeGreaterThan(tokensBox!.y + tokensBox!.height);
  expect(devicesBox!.x).toBeGreaterThan(tokensBox!.x + tokensBox!.width);
  expect(
    Math.abs(titleBox!.y + titleBox!.height / 2 - periodBox!.y - periodBox!.height / 2),
  ).toBeLessThan(4);
  expect(
    Math.abs(unitBox!.y + unitBox!.height / 2 - periodBox!.y - periodBox!.height / 2),
  ).toBeLessThan(4);
  const bars = await devices.locator('.by-hub-device-bar').evaluateAll((rows) =>
    rows.map((row) => ({
      valueX: row.children[2].getBoundingClientRect().right,
      height: row.querySelector('[role="progressbar"]')?.getBoundingClientRect().height,
    })),
  );
  expect(new Set(bars.map((bar) => bar.valueX)).size).toBe(1);
  expect(bars.map((bar) => bar.height)).toEqual([8, 8, 8, 8]);
  await page
    .getByRole('radiogroup', { name: 'Hub', exact: true })
    .getByText('Work', { exact: true })
    .click();
  await expect(devices.locator('.by-hub-device-name')).toHaveText([/Work-1/, /Work-2/]);
  await expect(page.getByRole('radio', { name: '2W', exact: true })).toBeChecked();
  await expectTotals(page, 14, 2);
  await expect(devices.getByRole('link')).toHaveCount(0);
});

test('HUB-2 期間と集約単位を共有して両グラフを更新し、集約だけでは合計と端末を変えない', async ({
  page,
  app,
}) => {
  await waitSaved(app.databasePath);
  await page.goto('/by-hub');
  await expectTotals(page, 14);
  for (const [label, days] of [
    ['7D', 7],
    ['2W', 14],
    ['4W', 28],
  ] as const) {
    await page.getByText(label, { exact: true }).click();
    await expectTotals(page, days);
    await expect(tokenChart(page).locator('[role="graphics-symbol"]')).toHaveCount(days);
  }
  for (const label of ['3M', '1Y']) {
    await page.getByText(label, { exact: true }).click();
    const dates = (await page.getByRole('region', { name: 'Usage by model' }).innerText()).match(
      /\d{4}-\d{2}-\d{2}/g,
    )!;
    const days = (Date.parse(dates[1]) - Date.parse(dates[0])) / 86_400_000 + 1;
    expect(days).toBeGreaterThan(label === '3M' ? 85 : 360);
    expect(days).toBeLessThan(label === '3M' ? 94 : 367);
    await expectTotals(page, days);
  }
  const response = await page.request.get('/api/hub-usage');
  const { today } = (await response.json()) as { today: string };
  await page.getByRole('button', { name: 'Choose date range' }).click();
  await page.getByLabel('Start date').fill(dayBefore(today, 5));
  await page.getByLabel('End date').fill(dayBefore(today, 3));
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expectTotals(page, 3);
  const devicesBefore = await page.getByRole('region', { name: 'Usage by device' }).innerText();
  for (const unit of ['weekly', 'monthly', 'daily']) {
    await page.getByLabel('Aggregation').selectOption(unit);
    await expectTotals(page, 3);
    expect(await page.getByRole('region', { name: 'Usage by device' }).innerText()).toBe(
      devicesBefore,
    );
    const tokenCount = await tokenChart(page).locator('[role="graphics-symbol"]').count();
    await expect(costChart(page).locator('[role="graphics-symbol"]')).toHaveCount(tokenCount);
    const expectedKeys = new Set(
      [5, 4, 3].map((offset) => {
        const day = dayBefore(today, offset);
        if (unit === 'daily') return day;
        if (unit === 'monthly') return day.slice(0, 7);
        const date = new Date(`${day}T12:00:00Z`);
        return dayBefore(day, date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1);
      }),
    );
    expect(tokenCount).toBe(expectedKeys.size);
  }
});

test('HUB-3 モデルは上位5とOtherで同色にまとめ、凡例は両グラフだけを絞り込む', async ({
  page,
  app,
}) => {
  await waitSaved(app.databasePath);
  await page.goto('/by-hub');
  await expectTotals(page, 14);
  const legend = page.locator('.by-hub-legend');
  await expect(legend.getByRole('button')).toHaveText([...models.slice(0, 5), 'Other']);
  const fills = async (chart: Locator) =>
    chart
      .locator('g')
      .filter({ has: page.locator('.hub-chart-target') })
      .first()
      .locator('rect:not(.hub-chart-target)')
      .evaluateAll((rects) => rects.map((rect) => rect.getAttribute('fill')));
  expect(await fills(tokenChart(page))).toEqual([
    '#9789c7',
    '#6b9eac',
    '#bf966b',
    '#83a584',
    '#b97d94',
    '#626572',
  ]);
  expect(await fills(costChart(page))).toEqual(await fills(tokenChart(page)));
  const today = ((await (await page.request.get('/api/hub-usage')).json()) as { today: string })
    .today;
  // Same model reported by two tools is one normalized day/model row, not two legend entries.
  const shared = query<{ tokens: number; cost_usd: number }>(
    app.databasePath,
    'SELECT tokens, cost_usd FROM device_daily_model_usages WHERE hub_id = ? AND device_id = ? AND date = ? AND model = ?',
    'z-personal',
    'device-11-1',
    today,
    'shared-model',
  );
  expect(shared).toEqual([{ tokens: 700_000, cost_usd: 14 }]);
  await tokenChart(page).locator('[role="graphics-symbol"]').first().focus();
  await expect(page.getByRole('tooltip')).toContainText('8,400,000');
  await expect(page.getByRole('tooltip')).toContainText('2,100,000');
  await expect(page.getByRole('tooltip')).toContainText('Other');
  const devicesBefore = await page.getByRole('region', { name: 'Usage by device' }).innerText();
  const summaryBefore = await page.locator('.by-hub-summary').innerText();
  await legend.getByRole('button', { name: 'shared-model', exact: true }).click();
  await expect(legend.getByRole('button', { name: 'shared-model', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(await chartTotal(tokenChart(page))).toBe((dailyTokens - 2_100_000) * 14);
  expect(await chartTotal(costChart(page))).toBe((dailyCost - 21) * 14);
  expect(await page.locator('.by-hub-summary').innerText()).toBe(summaryBefore);
  expect(await page.getByRole('region', { name: 'Usage by device' }).innerText()).toBe(
    devicesBefore,
  );
  await legend.getByRole('button', { name: 'shared-model', exact: true }).click();
  await expectTotals(page, 14);
  await page.getByText('1Y', { exact: true }).click();
  await expect(legend.getByRole('button')).toHaveText([
    'archive-model',
    ...models.slice(1, 5),
    'Other',
  ]);
});

test('HUB-4 画面とAPIは接続情報を公開せず、保存済みデータを読み取りだけで表示する', async ({
  page,
  app,
  personal,
  work,
}) => {
  await waitSaved(app.databasePath);
  const before = storedSnapshot(app.databasePath);
  await page.goto('/by-hub');
  await expectTotals(page, 14);
  const response = await page.request.get('/api/hub-usage');
  expect(response.status()).toBe(200);
  const body = await response.text();
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
  await page
    .getByRole('radiogroup', { name: 'Hub', exact: true })
    .getByText('Work', { exact: true })
    .click();
  await page.getByText('7D', { exact: true }).click();
  await expectTotals(page, 7, 2);
  expect(storedSnapshot(app.databasePath)).toBe(before);
});
