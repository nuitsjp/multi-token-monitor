import type { Locator, Page } from '@playwright/test';
import type { FakeHub } from '../hub-sync/fake-hub.ts';
import {
  addCost,
  estimateAll,
  expect,
  insertRecords,
  localDate,
  receivedAt,
  send,
  test,
} from './limit-history.ts';

// 主成功シナリオ「契約を選んで月換算上限額の推移を見る」を検証する。
// 当日の記録は偽Hubから本番の受信・保存処理で作り、過去の日の記録はDBへ直接書き込む（1日1行のため同期では作れない）。

const palette = ['#9789c7', '#6b9eac', '#bf966b', '#83a584', '#b97d94'];
const GAP = 3;
/** claude の過去の記録。3日前だけ記録が無い。 */
const claudeValue = (days: number) => 2000 - days * 5;

const tiles = (page: Page) => page.locator('.by-model-tile');
const tile = (page: Page, index: number) => tiles(page).nth(index);
const names = (page: Page) => page.locator('.by-model-tile .by-model-tile-name span:last-child');
const legend = (page: Page) => page.locator('.by-model-legend p');
const count = (page: Page) => page.locator('.by-model-select-all');
const selectAll = (page: Page) => page.getByRole('checkbox', { name: 'Select all' });
const limitChart = (page: Page) => page.getByRole('img', { name: 'Monthly limit', exact: true });
const multiplierChart = (page: Page) => page.getByRole('img', { name: 'Multiplier', exact: true });
const buckets = (chart: Locator) => chart.locator('[role="graphics-symbol"]');
const money = (value: number) => `$${Math.round(value).toLocaleString('en-US')}/mo`;

async function prepare(app: { databasePath: string }, alpha: FakeHub) {
  const db = app.databasePath;
  await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
  await estimateAll(alpha, db);
  insertRecords(db, [
    ...Array.from({ length: 100 }, (_, index) => index + 1)
      .filter((days) => days !== GAP)
      .map((days) => ({
        key: 'claude' as const,
        days,
        plan: 'Max 20x',
        monthly: claudeValue(days),
        price: 200,
      })),
    ...Array.from({ length: 20 }, (_, index) => ({
      key: 'codex' as const,
      days: index + 1,
      plan: 'Pro 20x',
      monthly: 1500,
      price: 200,
    })),
    ...Array.from({ length: 11 }, (_, index) => ({
      key: 'retired' as const,
      days: index + 40,
      plan: 'Plus',
      monthly: 300,
      price: 20,
    })),
  ]);
}

async function tooltipOf(page: Page, chart: Locator, index: number) {
  await buckets(chart).nth(index).hover();
  const tooltip = page.locator('.mantine-Tooltip-tooltip').last();
  await expect(tooltip).toBeVisible();
  return tooltip;
}

test('LMH-1 メニューのUsage limitsから1ページへ移り、3M・Weeklyで記録のある製品をすべて選んで表示する', async ({
  page,
  app,
  alpha,
}) => {
  await prepare(app, alpha);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const menu = page.getByRole('navigation', { name: 'Menu' });
  await menu.getByRole('link', { name: 'Usage limits' }).click();
  await expect(page).toHaveURL(/\/limits$/);
  await expect(menu.getByRole('link', { name: 'Usage limits' })).toHaveAttribute(
    'data-active',
    'true',
  );
  // サブメニュー（Hub・契約）は持たない。
  await expect(menu.getByText('Alpha Hub')).toHaveCount(0);
  await expect(menu.getByText(/Max 20x/)).toHaveCount(0);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Usage limits');
  await expect(page.getByRole('radio', { name: '3M', exact: true })).toBeChecked();
  await expect(page.getByLabel('Aggregation')).toHaveValue('weekly');

  // Hubの登録順、Homeと同じ契約の順（最小残量の昇順。報告されなくなった契約は最後）、枠グループの順。
  await expect(names(page)).toHaveText([
    'codex · Pro 20x',
    'codex · Pro 20x',
    'claude · Max 20x',
    'grok · SuperGrok',
    'codex · Plus',
  ]);
  await expect(count(page)).toContainText('5 / 5');
  await expect(selectAll(page)).toBeChecked();
  await expect(tile(page, 0)).toHaveAttribute('aria-pressed', 'true');
  await expect(legend(page)).toHaveText([
    'codex · Pro 20x · GPT-5.3-Codex-Spark',
    'codex · Pro 20x',
    'claude · Max 20x',
    'grok · SuperGrok',
    'codex · Plus',
  ]);
  const swatches = await tiles(page)
    .locator('.hub-chart-swatch')
    .evaluateAll((items) => items.map((item) => (item as HTMLElement).style.background));
  expect(swatches.map((color) => color.replace(/\s/g, ''))).toEqual(
    palette.map((hex) => {
      const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
      return `rgb(${r},${g},${b})`;
    }),
  );

  // 枠グループ名は、グループが複数の契約だけ示し、Hub名を添える。
  await expect(tile(page, 0)).toContainText('GPT-5.3-Codex-Spark · Alpha Hub');
  await expect(tile(page, 1).locator('.limits-tile-scope')).toHaveText('Alpha Hub');
  await expect(tile(page, 0)).toContainText('$500/mo');
  await expect(tile(page, 0)).toContainText('$200/mo · ×2.5');
  await expect(tile(page, 1)).toContainText('$1,500/mo');
  await expect(tile(page, 1)).toContainText('$200/mo · ×7.5');
  await expect(tile(page, 2)).toContainText('$2,000/mo');
  await expect(tile(page, 2)).toContainText('$200/mo · ×10.0');
  await expect(tile(page, 4)).toContainText('$300/mo');
  await expect(tile(page, 4)).toContainText('$20/mo · ×15.0');

  // 価格表にプランが無い製品は、支払額と倍率を N/A とし、理由を示す。
  await expect(tile(page, 3)).toContainText('$400/mo');
  await tile(page, 3).getByText('N/A · N/A').hover();
  await expect(page.getByText('No price for this plan.')).toBeVisible();

  // 両グラフの縦軸は0から始める。
  await expect(limitChart(page).locator('text', { hasText: /^\$0$/ })).toHaveCount(1);
  await expect(multiplierChart(page).locator('text', { hasText: /^×0\.0$/ })).toHaveCount(1);
});

test('LMH-2 タイルとSelect allで選択を切り替え、両グラフと凡例を更新する', async ({
  page,
  app,
  alpha,
}) => {
  await prepare(app, alpha);
  await page.goto('/limits');
  await expect(count(page)).toContainText('5 / 5');

  await tile(page, 2).click();
  await expect(tile(page, 2)).toHaveAttribute('aria-pressed', 'false');
  await expect(count(page)).toContainText('4 / 5');
  await expect(legend(page).filter({ hasText: 'claude · Max 20x' })).toHaveCount(0);
  await expect(limitChart(page).locator('polyline[stroke="#bf966b"]')).toHaveCount(0);
  await expect(multiplierChart(page).locator('polyline[stroke="#bf966b"]')).toHaveCount(0);

  await tile(page, 2).focus();
  await page.keyboard.press('Enter');
  await expect(tile(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await expect(limitChart(page).locator('polyline[stroke="#bf966b"]')).not.toHaveCount(0);

  await selectAll(page).click();
  await expect(count(page)).toContainText('0 / 5');
  await expect(legend(page)).toHaveCount(0);
  await expect(limitChart(page).locator('polyline')).toHaveCount(0);
  await selectAll(page).click();
  await expect(count(page)).toContainText('5 / 5');

  await tile(page, 0).click();
  await expect(selectAll(page)).toHaveJSProperty('indeterminate', true);
});

test('LMH-3 期間と集約単位で点を作り直し、各点はその単位の最後の記録で、記録の無い日は線を途切れさせる', async ({
  page,
  app,
  alpha,
}) => {
  await prepare(app, alpha);
  await page.goto('/limits');

  // 週次の各点は、その週の最後の記録の値。今週の点は当日の値になる。
  const weekly = await buckets(limitChart(page)).count();
  const thisWeek = await tooltipOf(page, limitChart(page), weekly - 1);
  await expect(thisWeek).toContainText('claude · Max 20x');
  await expect(thisWeek).toContainText('$2,000/mo · $200/mo · ×10.0');
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  let lastOfPreviousWeek = Math.round((Date.now() - monday.getTime()) / 86_400_000) + 1;
  if (lastOfPreviousWeek === GAP) lastOfPreviousWeek++;
  const previousWeek = await tooltipOf(page, limitChart(page), weekly - 2);
  await expect(previousWeek).toContainText(`${money(claudeValue(lastOfPreviousWeek))} · $200/mo`);

  // 4W・Dailyでは28点になり、報告されなくなった契約は記録が無いため出さない。変化率は期間の最初の記録から求める。
  await page.getByText('4W', { exact: true }).click();
  await page.getByLabel('Aggregation').selectOption('daily');
  await expect(buckets(limitChart(page))).toHaveCount(28);
  await expect(buckets(multiplierChart(page))).toHaveCount(28);
  await expect(count(page)).toContainText('4 / 4');
  await expect(names(page).filter({ hasText: 'codex · Plus' })).toHaveCount(0);
  const change = Math.round((2000 / claudeValue(27) - 1) * 100);
  await expect(tile(page, 2)).toContainText(`+${change}%`);

  // 3日前は記録が無く、その点は「—」で、claude の線はそこで途切れる。
  const gap = await tooltipOf(page, limitChart(page), 27 - GAP);
  const gapDate = localDate(GAP);
  await expect(gap).toContainText(`${Number(gapDate.slice(5, 7))}/${Number(gapDate.slice(8, 10))}`);
  await expect(gap).toContainText('claude · Max 20x—');
  await expect(limitChart(page).locator('polyline[stroke="#bf966b"]')).toHaveCount(2);

  // 期間を戻すと、選択していた製品は選択されたまま戻る。
  await page.getByText('3M', { exact: true }).click();
  await expect(count(page)).toContainText('5 / 5');
  await expect(names(page).last()).toHaveText('codex · Plus');
});

test('LMH-4 閲覧は保存済みの記録だけを読み、操作では取得し直さず、保存の合図で取得し直す', async ({
  page,
  app,
  alpha,
}) => {
  await prepare(app, alpha);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/limit-history') requests.push(request.url());
  });
  const response = page.waitForResponse(
    (item) => new URL(item.url()).pathname === '/api/limit-history',
  );
  await page.goto('/limits');
  const body = await (await response).text();
  expect(body).not.toContain(alpha.url);
  expect(body).not.toContain(alpha.token);
  await expect(tile(page, 2)).toContainText('$2,000/mo');
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  const loaded = requests.length;

  await page.getByText('4W', { exact: true }).click();
  await page.getByLabel('Aggregation').selectOption('monthly');
  await tile(page, 0).click();
  await selectAll(page).click();
  await expect(count(page)).toContainText('4 / 4');
  expect(requests).toHaveLength(loaded);

  // 表示中に同期が当日の行を上書きすると、取得し直して新しい値を表示する。
  await send(alpha, app.databasePath, (next) => addCost(next, 'claude', 'claude-opus', 400), {
    'claude-a/monthly': 75,
  });
  await expect(tile(page, 2)).toContainText('$4,000/mo');
  expect(requests.length).toBeGreaterThan(loaded);
});

test('LMH-5 記録が無いときは No history を示し、高さ640pxでは画面を縦にスクロールせずタイルだけをスクロールする', async ({
  page,
  app,
  alpha,
}) => {
  await expect.poll(() => receivedAt(app.databasePath, 'alpha')).toBeTruthy();
  await page.goto('/limits');
  await expect(page.getByText('No history for selected range.')).toHaveCount(2);
  await expect(count(page)).toContainText('0 / 0');

  await prepare(app, alpha);
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.reload();
  await expect(tiles(page)).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBe(0);
  const list = page.locator('.by-model-tiles');
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
});
