import { createStats, startFakeHub, withDaily, type FakeDay } from '../hub-sync/fake-hub.ts';
import { expect, test as base, TIME_ZONE, waitReceived } from './overview.ts';

// 主成功シナリオ「保存済みの最新利用状況を1画面で見る」のうち、Activityと区画の配置を検証する。
// 日付はブラウザーの時刻帯（TIME_ZONE）での今日から遡って作る。
const pad = (value: number) => String(value).padStart(2, '0');
function daysAgo(count: number): string {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE })
    .format(new Date())
    .split('-')
    .map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - count));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

const histories: Record<'alpha' | 'beta', FakeDay[]> = {
  alpha: [
    { date: daysAgo(1), tokens: 1000, cost: 1.5 },
    { date: daysAgo(2), tokens: 500 },
    { date: daysAgo(400), tokens: 9 },
  ],
  beta: [
    { date: daysAgo(1), tokens: 3000, cost: 0.5 },
    { date: daysAgo(3), tokens: 250 },
  ],
};

const test = base.extend({
  // eslint-disable-next-line no-empty-pattern -- Playwrightは依存のないfixtureにも分割代入を要求する
  alpha: async ({}, use) => {
    const hub = await startFakeHub(
      'alpha-secret-token',
      withDaily(createStats(1), histories.alpha),
    );
    await use(hub);
    await hub.close();
  },
  // eslint-disable-next-line no-empty-pattern
  beta: async ({}, use) => {
    const hub = await startFakeHub('beta-secret-token', withDaily(createStats(2), histories.beta));
    await use(hub);
    await hub.close();
  },
});

// 全体の合計とBy modelが横に並ぶ幅で確かめる。
test.use({ timezoneId: TIME_ZONE, viewport: { width: 1600, height: 1000 } });

test('OVW-12 Activityは全Hubの日別を日付ごとに合算し、期間を切り替えても変えない', async ({
  page,
  app,
}) => {
  // Arrange
  await waitReceived(app.databasePath);

  // Act
  await page.goto('/');

  // Assert: 直近52週を、今日より後の日を除いて描く。右上の凡例は文字情報を含まない。
  const activity = page.getByRole('region', { name: 'Activity' });
  const cells = activity.locator('.activity-cell[title]');
  const weekday = new Date(`${daysAgo(0)}T00:00:00Z`).getUTCDay();
  await expect(cells).toHaveCount(51 * 7 + weekday + 1);
  await expect(activity.getByText('No history')).toHaveCount(0);
  await expect(activity.locator('.activity-legend')).toHaveText('LessMore');

  // 同じ日の値はHub間で合算し、コストは値のあるHubだけを合計する。
  const cell = (count: number) => activity.locator(`[title^="${daysAgo(count)} "]`);
  await expect(cell(1)).toHaveAttribute('title', `${daysAgo(1)} · 4,000 tokens · $2.00`);
  await expect(cell(2)).toHaveAttribute('title', `${daysAgo(2)} · 500 tokens`);
  await expect(cell(3)).toHaveAttribute('title', `${daysAgo(3)} · 250 tokens`);
  // 蓄積のない日は0のマス、52週より前の日は描かない。
  await expect(cell(4)).toHaveAttribute('title', `${daysAgo(4)} · 0 tokens`);
  await expect(cell(400)).toHaveCount(0);
  // 最大の日が最も濃く、0の日が最も薄い。
  await expect(cell(1)).toHaveClass(/level-4/);
  await expect(cell(4)).toHaveClass(/level-0/);

  // Act: 期間を切り替える。
  const before = await cells.evaluateAll((items) => items.map((item) => item.className));
  for (const name of ['Month', 'All time', 'Today']) {
    await page.getByText(name, { exact: true }).click();
    await expect(page.getByRole('radio', { name })).toBeChecked();
  }

  // Assert: Activityは変わらない。
  expect(await cells.evaluateAll((items) => items.map((item) => item.className))).toEqual(before);
});

test('OVW-13 Hub別はDevicesの上に同じ幅で置き、Activityは左列、By modelは右に置く', async ({
  page,
  app,
}) => {
  // Arrange
  await waitReceived(app.databasePath);

  // Act
  await page.goto('/');

  // Assert
  await expect(page.getByRole('region', { name: 'Activity' })).toBeVisible();
  const box = async (name: string) => (await page.getByRole('region', { name }).boundingBox())!;
  const [hub, devices, activity, model, total] = await Promise.all(
    ['By hub', 'Devices', 'Activity', 'By model', 'Total'].map(box),
  );
  expect(hub.width).toBeCloseTo(devices.width, 0);
  expect(hub.x).toBeCloseTo(devices.x, 0);
  expect(hub.y + hub.height).toBeLessThan(devices.y);
  expect(activity.y).toBeGreaterThan(total.y + total.height - 1);
  expect(activity.x).toBeLessThan(model.x);
  expect(activity.y + activity.height).toBeCloseTo(model.y + model.height, -1);
});
