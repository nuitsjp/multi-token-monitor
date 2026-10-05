import {
  dayBefore as dayBefore_part12,
  expect as expect_part12,
  test as test_part12,
  waitSaved as waitSaved_part12,
} from '../hub-usage/hub-usage.ts';
import type { HistoryStats as HistoryStats_part12 } from '../hub-usage/hub-usage.ts';
import { query as query_part12 } from '../hub-sync/sync.ts';
import { test as describePart12 } from '@playwright/test';

describePart12.describe('slot-and-unknown-cost', () => {
  const dayBefore = dayBefore_part12;
  const expect = expect_part12;
  const test = test_part12;
  const waitSaved = waitSaved_part12;
  type HistoryStats = HistoryStats_part12;
  const query = query_part12;

  test('HUB-8 モデルが日ごとに入れ替わる全コスト不明の期間を0にせず、報告された0は維持する', async ({
    page,
    app,
    personal,
  }) => {
    await test.step('分岐条件', async () => {
      await waitSaved(app.databasePath);
    });
    await test.step('手順1', async () => {
      await page.goto('/by-hub');
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.locator('.by-hub-summary')).toContainText('117,600,000');
    });
    const { today } = (await (await page.request.get('/api/hub-usage')).json()) as {
      today: string;
    };
    const targetDates = [5, 4, 3].map((offset) => dayBefore(today, offset));
    const next = structuredClone(personal.stats) as HistoryStats;
    await test.step('分岐条件', async () => {
      for (const device of next.devices)
        for (const day of device.history.daily) {
          if (!targetDates.includes(day.date)) continue;
          day.tokens = 10_000;
          day.perModel = {
            [day.date === targetDates[1] ? 'Cost-B' : 'Cost-A']: { tokens: 10_000, cost: null },
          };
        }

      next.deviceHistoryRevision = 'all-costs-unknown';

      personal.send('stats', next);

      await expect
        .poll(
          () =>
            query<{ count: number }>(
              app.databasePath,
              'SELECT COUNT(*) AS count FROM device_daily_model_usages WHERE hub_id = ? AND date >= ? AND date <= ? AND cost_usd IS NULL',
              'z-personal',
              targetDates[0],
              targetDates[2],
            )[0].count,
        )
        .toBe(6);
    });
    await test.step('手順1', async () => {
      await page.getByRole('button', { name: 'Choose date range' }).click();

      await page.getByLabel('Start date').fill(targetDates[0]);

      await page.getByLabel('End date').fill(targetDates[2]);

      await page.getByRole('button', { name: 'Apply range' }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByText('Estimated cost unavailable', { exact: true })).toBeVisible();

      await expect(page.locator('.by-hub-summary')).toHaveText('Tokens60,000Cost—');

      await expect(page.locator('.by-hub-device .slot-text')).toHaveText([
        '30,000',
        '—',
        '30,000',
        '—',
      ]);
    });
    const api = (await (await page.request.get('/api/hub-usage')).json()) as {
      hubs: { hubId: string; days: { date: string; costUsd: number | null }[] }[];
    };
    await test.step('受け入れ条件', async () => {
      expect(
        api.hubs
          .find((hub) => hub.hubId === 'z-personal')!
          .days.filter((day) => targetDates.includes(day.date))
          .map((day) => day.costUsd),
      ).toEqual(Array(6).fill(null));
    });
    const zero = structuredClone(next);
    await test.step('分岐条件', async () => {
      for (const device of zero.devices)
        for (const day of device.history.daily)
          if (targetDates.includes(day.date))
            for (const model of Object.values(day.perModel)) model.cost = 0;

      zero.deviceHistoryRevision = 'reported-zero-cost';

      personal.send('stats', zero);
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.locator('.by-hub-summary')).toHaveText('Tokens60,000Cost$0.00');

      await expect(
        page.getByRole('img', { name: 'Estimated cost (USD)', exact: true }),
      ).toBeVisible();

      await expect(page.locator('.by-hub-device .slot-text')).toHaveText([
        '30,000',
        '$0.00',
        '30,000',
        '$0.00',
      ]);
    });
  });
});
