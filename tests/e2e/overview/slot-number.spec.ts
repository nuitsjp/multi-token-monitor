import type { Page } from '@playwright/test';
import { expect, periodLabels, receivedAt, test, TIME_ZONE, waitReceived } from './overview.ts';
import { PERIODS, recalculateTotals, type FakeStats } from '../hub-sync/fake-hub.ts';

// 主成功シナリオ「保存済みの最新利用状況を1画面で見る」のうち、トークン数と推定コストのスロット表示を検証する。

test.use({ timezoneId: TIME_ZONE });

interface Slot {
  text: string;
  /** 回っているリールを左から順に並べる。from は回り始めの数字、up は上へ回るか、duration は止まるまでの時間。 */
  reels: { from: number; up: boolean; duration: number }[];
}

/** 指定した区画の数値ごとに、表示中の値と回っているリールを返す。 */
function slots(page: Page, label: string): Promise<Slot[]> {
  return page.evaluate((label) => {
    const y = (keyframe: Keyframe) => Number(/-?[\d.]+/.exec(String(keyframe.transform))![0]);
    return [...document.querySelectorAll(`[aria-label="${label}"] .slot`)].map((slot) => ({
      text: slot.querySelector('.slot-text')!.textContent!,
      reels: [...slot.querySelectorAll('.slot-strip')].flatMap((strip) =>
        strip
          .getAnimations()
          .filter((animation) => animation.playState === 'running')
          .flatMap((animation) => {
            const effect = animation.effect as KeyframeEffect;
            const frames = effect.getKeyframes();
            if (!('transform' in frames[0]!)) return [];
            return [
              {
                from: -y(frames[0]!) % 10,
                up: y(frames.at(-1)!) < y(frames[0]!),
                duration: Number(effect.getTiming().duration),
              },
            ];
          }),
      ),
    }));
  }, label);
}

const digits = (text: string) => [...text].filter((char) => /\d/.test(char)).length;

/** 右端から桁を対応づけ、値が変わった数字の桁を数える。 */
function changedDigits(before: string, after: string) {
  const old = [...before].reverse();
  return [...after].reverse().filter((char, index) => /\d/.test(char) && char !== old[index])
    .length;
}

const spinningCount = (page: Page) =>
  page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            (animation.effect as KeyframeEffect).target?.classList.contains('slot-strip'),
        ).length,
  );

/** Alphaの利用量を増やし、上位5件に入る新しいモデルを加えた次の状態を作る。 */
function advance(stats: FakeStats): FakeStats {
  const next = structuredClone(stats);
  next.updatedAt = new Date().toISOString();
  for (const name of PERIODS) {
    const models = next.devices[0].periods[name].clientModels;
    models.codex['gpt-5'] += 5000;
    models.codex['model-new'] = 900_000;
  }
  recalculateTotals(next, Date.now());
  return next;
}

test('OVW-5 画面を開くと、トークン数と推定コストの全桁が0から回って左の桁から順に止まる', async ({
  page,
  app,
}) => {
  // Arrange
  await waitReceived(app.databasePath);

  // Act
  await page.goto('/');
  const total = page.getByRole('region', { name: 'Total' });
  await expect(total.locator('.slot')).toHaveCount(2);

  // Assert: 数字の全桁が上へ回り、記号は回らない。左の桁ほど早く止まる。
  for (const slot of await slots(page, 'Total')) {
    expect(slot.reels).toHaveLength(digits(slot.text));
    expect(slot.reels.every((reel) => reel.up && reel.from === 0)).toBe(true);
    const durations = slot.reels.map((reel) => reel.duration);
    expect(durations).toEqual([...durations].sort((a, b) => a - b));
    expect(new Set(durations).size).toBe(durations.length);
  }
  // 表示中の値は textContent に1回だけ現れる。
  const [tokens, cost] = (await slots(page, 'Total')).map((slot) => slot.text);
  await expect(total).toContainText(`Tokens${tokens}Est. cost${cost}USD`);
});

test('OVW-6 期間を切り替えると、変わった桁だけが増えたら上へ、減ったら下へ回る', async ({
  page,
  app,
}) => {
  // Arrange
  await waitReceived(app.databasePath);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Total' }).locator('.slot')).toHaveCount(2);
  await expect.poll(() => spinningCount(page)).toBe(0);
  const today = (await slots(page, 'Total'))[0]!.text;

  // Act: Today から Month へ切り替えると、トークン数が増える。
  await page.getByText(periodLabels.month, { exact: true }).click();
  await expect.poll(async () => (await slots(page, 'Total'))[0]!.text).not.toBe(today);

  // Assert
  const month = (await slots(page, 'Total'))[0]!;
  expect(month.reels).toHaveLength(changedDigits(today, month.text));
  expect(month.reels.every((reel) => reel.up)).toBe(true);

  // Act & Assert: Month から Today へ戻すと、トークン数が減って下へ回る。
  await expect.poll(() => spinningCount(page)).toBe(0);
  await page.getByText(periodLabels.today, { exact: true }).click();
  await expect.poll(async () => (await slots(page, 'Total'))[0]!.text).toBe(today);
  const back = (await slots(page, 'Total'))[0]!;
  expect(back.reels).toHaveLength(changedDigits(month.text, today));
  expect(back.reels.every((reel) => !reel.up)).toBe(true);
});

test('OVW-7 表示中の同期で値が変わった数値だけを回し、同じ値が届いたときは回さない', async ({
  page,
  app,
  alpha,
}) => {
  // Arrange
  const db = app.databasePath;
  await waitReceived(db);
  await page.goto('/');
  await expect(page.locator('[aria-label="Alpha Hub"] .slot')).toHaveCount(2);
  await expect.poll(() => spinningCount(page)).toBe(0);
  const alphaBefore = (await slots(page, 'Alpha Hub'))[0]!.text;
  const next = advance(alpha.stats);

  // Act: Alphaの利用量が増え、新しいモデルが内訳に加わる。
  const before = receivedAt(db, 'alpha');
  alpha.send('stats', next);
  await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);
  await expect.poll(async () => (await slots(page, 'Alpha Hub'))[0]!.text).not.toBe(alphaBefore);

  // Assert: Alphaは変わった桁だけが上へ回り、値の変わらないBetaは回らない。
  const alphaAfter = (await slots(page, 'Alpha Hub'))[0]!;
  expect(alphaAfter.reels).toHaveLength(changedDigits(alphaBefore, alphaAfter.text));
  expect(alphaAfter.reels.every((reel) => reel.up)).toBe(true);
  expect((await slots(page, 'Beta Hub')).flatMap((slot) => slot.reels)).toHaveLength(0);
  // 同期で新たに表示されたモデルの値は、全桁が0から回る。
  const addedRow = await page.evaluate(() => {
    const row = [...document.querySelectorAll('[aria-label="By model"] tr')].find((row) =>
      row.textContent!.startsWith('model-new'),
    );
    return [...(row?.querySelectorAll('.slot') ?? [])].map((slot) => ({
      text: slot.querySelector('.slot-text')!.textContent!,
      spinning: [...slot.querySelectorAll('.slot-strip')].filter((strip) =>
        strip.getAnimations().some((animation) => animation.playState === 'running'),
      ).length,
    }));
  });
  expect(addedRow).toHaveLength(2);
  for (const slot of addedRow) expect(slot.spinning).toBe(digits(slot.text));

  // Act: 回転が止まった後、同じ値の状態が届く。
  await expect.poll(() => spinningCount(page)).toBe(0);
  const refetched = page.waitForResponse('**/api/overview');
  const saved = receivedAt(db, 'alpha');
  alpha.send('stats', { ...structuredClone(next), updatedAt: new Date().toISOString() });
  await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(saved);
  await refetched;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

  // Assert: どの数値も回らない。
  expect(await spinningCount(page)).toBe(0);
  expect((await slots(page, 'Alpha Hub'))[0]!.text).toBe(alphaAfter.text);
});

test('OVW-8 アニメーションを減らす設定では、開いたときも期間の切り替えや同期でも回さない', async ({
  page,
  app,
  alpha,
}) => {
  // Arrange
  const db = app.databasePath;
  await waitReceived(db);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // Act & Assert: 開いたとき
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Total' }).locator('.slot')).toHaveCount(2);
  expect(await spinningCount(page)).toBe(0);

  // Act & Assert: 期間の切り替え
  const today = (await slots(page, 'Total'))[0]!.text;
  await page.getByText(periodLabels.month, { exact: true }).click();
  await expect.poll(async () => (await slots(page, 'Total'))[0]!.text).not.toBe(today);
  expect(await spinningCount(page)).toBe(0);

  // Act & Assert: 同期
  const month = (await slots(page, 'Total'))[0]!.text;
  const before = receivedAt(db, 'alpha');
  alpha.send('stats', advance(alpha.stats));
  await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);
  await expect.poll(async () => (await slots(page, 'Total'))[0]!.text).not.toBe(month);
  expect(await spinningCount(page)).toBe(0);
});
