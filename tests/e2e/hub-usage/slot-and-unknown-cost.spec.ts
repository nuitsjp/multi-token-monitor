import type { Page } from '@playwright/test';
import { dayBefore, expect, test, waitSaved, type HistoryStats } from './hub-usage.ts';
import { query } from '../hub-sync/sync.ts';

interface Spin {
  strip: Element;
  from: number;
  up: boolean;
  duration: number;
}
interface Slot {
  text: string;
  reels: Omit<Spin, 'strip'>[];
}
const SUMMARY_AND_DEVICES = '.by-hub-summary, .by-hub-device';

async function recordSpins(page: Page) {
  await page.addInitScript(() => {
    const spins: Spin[] = [];
    (window as unknown as { hubSpins: Spin[] }).hubSpins = spins;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const frames = keyframes as Keyframe[];
      if (this.classList.contains('slot-strip') && 'transform' in frames[0]!) {
        const y = (frame: Keyframe) =>
          (Number(/-?[\d.]+/.exec(String(frame.transform))![0]) * 30) / 100;
        spins.push({
          strip: this,
          from: Math.round(-y(frames[0]!)) % 10,
          up: y(frames.at(-1)!) < y(frames[0]!),
          duration: Number((options as KeyframeAnimationOptions).duration),
        });
      }
      return animate.call(this, keyframes, options);
    };
  });
}
async function slots(page: Page): Promise<Slot[]> {
  return page.evaluate((selector) => {
    const spins = (window as unknown as { hubSpins: Spin[] }).hubSpins;
    return [...document.querySelectorAll(selector)]
      .flatMap((element) => [...element.querySelectorAll('.slot')])
      .map((slot) => ({
        text: slot.querySelector('.slot-text')!.textContent!,
        reels: [...slot.querySelectorAll('.slot-strip')].flatMap((strip) =>
          spins
            .filter((spin) => spin.strip === strip)
            .map(({ from, up, duration }) => ({ from, up, duration })),
        ),
      }));
  }, SUMMARY_AND_DEVICES);
}
const clearSpins = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { hubSpins: Spin[] }).hubSpins.length = 0;
  });
const digits = (text: string) => [...text].filter((char) => /\d/.test(char)).length;
const changedDigits = (before: string, after: string) => {
  const old = [...before].reverse();
  return [...after].reverse().filter((char, index) => /\d/.test(char) && char !== old[index])
    .length;
};

test('HUB-5 初回表示は上部と全端末のTokensとCostの全桁を0から回転する', async ({ page, app }) => {
  await waitSaved(app.databasePath);
  await recordSpins(page);
  await page.goto('/by-hub');
  await expect(
    page.locator(
      `${SUMMARY_AND_DEVICES.split(', ')
        .map((selector) => `${selector} .slot`)
        .join(', ')}`,
    ),
  ).toHaveCount(6);
  const values = await slots(page);
  expect(values.map((slot) => slot.text)).toEqual([
    '117,600,000',
    '$1,176.00',
    '39,200,000',
    '$784.00',
    '78,400,000',
    '$392.00',
  ]);
  for (const slot of values) {
    expect(slot.reels).toHaveLength(digits(slot.text));
    expect(slot.reels.every((reel) => reel.from === 0 && reel.up)).toBe(true);
    expect(slot.reels.map((reel) => reel.duration)).toEqual(
      slot.reels.map((reel) => reel.duration).sort((a, b) => a - b),
    );
    expect(new Set(slot.reels.map((reel) => reel.duration)).size).toBe(slot.reels.length);
  }
  await expect(page.locator('.by-hub-summary')).toHaveText('Tokens117,600,000Cost$1,176.00');
  await expect(page.locator('.hub-usage-chart .slot')).toHaveCount(0);
});

test('HUB-6 期間切替では変化した桁だけを増加と減少の方向へ回転する', async ({ page, app }) => {
  await waitSaved(app.databasePath);
  await recordSpins(page);
  await page.goto('/by-hub');
  await expect(page.locator('.by-hub-summary .slot')).toHaveCount(2);
  let before = await slots(page);
  for (const [period, up] of [
    ['4W', true],
    ['7D', false],
  ] as const) {
    await clearSpins(page);
    await page.getByText(period, { exact: true }).click();
    await expect.poll(async () => (await slots(page))[0].text).not.toBe(before[0].text);
    const after = await slots(page);
    after.forEach((slot, index) => {
      expect(slot.reels).toHaveLength(changedDigits(before[index].text, slot.text));
      expect(slot.reels.every((reel) => reel.up === up)).toBe(true);
    });
    before = after;
  }
  await clearSpins(page);
  await page.getByLabel('Aggregation').selectOption('weekly');
  expect((await slots(page)).flatMap((slot) => slot.reels)).toHaveLength(0);
});

test('HUB-7 reduced motionでは初回表示も期間切替も数値を回転させない', async ({ page, app }) => {
  await waitSaved(app.databasePath);
  await recordSpins(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/by-hub');
  await expect(page.locator('.by-hub-summary .slot')).toHaveCount(2);
  expect((await slots(page)).flatMap((slot) => slot.reels)).toHaveLength(0);
  const before = (await slots(page))[0].text;
  await page.getByText('7D', { exact: true }).click();
  await expect.poll(async () => (await slots(page))[0].text).not.toBe(before);
  expect((await slots(page)).flatMap((slot) => slot.reels)).toHaveLength(0);
});

test('HUB-8 モデルが日ごとに入れ替わる全コスト不明の期間を0にせず、報告された0は維持する', async ({
  page,
  app,
  personal,
}) => {
  await waitSaved(app.databasePath);
  await page.goto('/by-hub');
  await expect(page.locator('.by-hub-summary')).toContainText('117,600,000');
  const { today } = (await (await page.request.get('/api/hub-usage')).json()) as { today: string };
  const targetDates = [5, 4, 3].map((offset) => dayBefore(today, offset));
  const next = structuredClone(personal.stats) as HistoryStats;
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
  await page.getByRole('button', { name: 'Choose date range' }).click();
  await page.getByLabel('Start date').fill(targetDates[0]);
  await page.getByLabel('End date').fill(targetDates[2]);
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expect(page.getByText('Estimated cost unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('.by-hub-summary')).toHaveText('Tokens60,000Cost—');
  await expect(page.locator('.by-hub-device .slot-text')).toHaveText([
    '30,000',
    '—',
    '30,000',
    '—',
  ]);
  const api = (await (await page.request.get('/api/hub-usage')).json()) as {
    hubs: { hubId: string; days: { date: string; costUsd: number | null }[] }[];
  };
  expect(
    api.hubs
      .find((hub) => hub.hubId === 'z-personal')!
      .days.filter((day) => targetDates.includes(day.date))
      .map((day) => day.costUsd),
  ).toEqual(Array(6).fill(null));
  const zero = structuredClone(next);
  for (const device of zero.devices)
    for (const day of device.history.daily)
      if (targetDates.includes(day.date))
        for (const model of Object.values(day.perModel)) model.cost = 0;
  zero.deviceHistoryRevision = 'reported-zero-cost';
  personal.send('stats', zero);
  await expect(page.locator('.by-hub-summary')).toHaveText('Tokens60,000Cost$0.00');
  await expect(page.getByRole('img', { name: 'Estimated cost (USD)', exact: true })).toBeVisible();
  await expect(page.locator('.by-hub-device .slot-text')).toHaveText([
    '30,000',
    '$0.00',
    '30,000',
    '$0.00',
  ]);
});
