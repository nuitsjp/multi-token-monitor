import type { Page } from '@playwright/test';
import { expect, periodLabels, receivedAt, test, TIME_ZONE, waitReceived } from './overview.ts';
import { PERIODS, recalculateTotals, type FakeStats } from '../hub-sync/fake-hub.ts';

// 主成功シナリオ「保存済みの最新利用状況を1画面で見る」のうち、トークン数と推定コストのスロット表示を検証する。

test.use({ timezoneId: TIME_ZONE });

interface Spin {
  /** 回り始めの数字、上へ回るか、止まるまでの時間。 */
  from: number;
  up: boolean;
  duration: number;
}

interface Slot {
  text: string;
  /** 記録を消してから回したリールを、左から順に並べる。 */
  reels: Spin[];
}

type Recorded = Spin & { strip: Element };

/**
 * 画面がリールを回し始めるたびに、その要素と回り方を記録する。
 * 回転は左の桁から順に止まるため、確かめる時点で回っているかを見ると遅い環境で先に止まった桁を数え損なう。
 */
async function recordSpins(page: Page) {
  await page.addInitScript(() => {
    const spins: Recorded[] = [];
    (window as unknown as { spins: Recorded[] }).spins = spins;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const frames = keyframes as Keyframe[];
      if (this.classList.contains('slot-strip') && 'transform' in frames[0]!) {
        const y = (frame: Keyframe) => Number(/-?[\d.]+/.exec(String(frame.transform))![0]);
        spins.push({
          strip: this,
          from: -y(frames[0]!) % 10,
          up: y(frames.at(-1)!) < y(frames[0]!),
          duration: Number((options as KeyframeAnimationOptions).duration),
        });
      }
      return animate.call(this, keyframes, options);
    };
  });
}

const clearSpins = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { spins: Recorded[] }).spins.length = 0;
  });

const spinCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { spins: Recorded[] }).spins.length);

/** 指定した要素（text を含むものだけ）の中の数値ごとに、表示中の値と、記録を消してから回したリールを返す。 */
function slots(page: Page, selector: string, text = ''): Promise<Slot[]> {
  return page.evaluate(
    ({ selector, text }) => {
      const spins = (window as unknown as { spins: Recorded[] }).spins;
      return [...document.querySelectorAll(selector)]
        .filter((element) => element.textContent!.includes(text))
        .flatMap((element) => [...element.querySelectorAll('.slot')])
        .map((slot) => ({
          text: slot.querySelector('.slot-text')!.textContent!,
          reels: [...slot.querySelectorAll('.slot-strip')].flatMap((strip) =>
            spins
              .filter((spin) => spin.strip === strip)
              .map(({ from, up, duration }) => ({ from, up, duration })),
          ),
        }));
    },
    { selector, text },
  );
}

const digits = (text: string) => [...text].filter((char) => /\d/.test(char)).length;

/** 右端から桁を対応づけ、値が変わった数字の桁を数える。 */
function changedDigits(before: string, after: string) {
  const old = [...before].reverse();
  return [...after].reverse().filter((char, index) => /\d/.test(char) && char !== old[index])
    .length;
}

/** 画面が状態を描き終えるまで待つ。 */
const painted = (page: Page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
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

const TOTAL = '[aria-label="Total"]';

test('OVW-5 画面を開くと、トークン数と推定コストの全桁が0から回って左の桁から順に止まる', async ({
  page,
  app,
}) => {
  // Arrange
  await waitReceived(app.databasePath);
  await recordSpins(page);

  // Act
  await page.goto('/');
  const total = page.getByRole('region', { name: 'Total' });
  await expect(total.locator('.slot')).toHaveCount(2);

  // Assert: 数字の全桁が上へ回り、記号は回らない。左の桁ほど早く止まる（左から順に止まる）。
  for (const slot of await slots(page, TOTAL)) {
    expect(slot.reels).toHaveLength(digits(slot.text));
    expect(slot.reels.every((reel) => reel.up && reel.from === 0)).toBe(true);
    const durations = slot.reels.map((reel) => reel.duration);
    expect(durations).toEqual([...durations].sort((a, b) => a - b));
    expect(new Set(durations).size).toBe(durations.length);
  }
  // 表示中の値は textContent に1回だけ現れる。
  const [tokens, cost] = (await slots(page, TOTAL)).map((slot) => slot.text);
  await expect(total).toContainText(`Tokens${tokens}Est. cost${cost}USD`);
});

test('OVW-6 期間を切り替えると、変わった桁だけが増えたら上へ、減ったら下へ回る', async ({
  page,
  app,
}) => {
  // Arrange
  await waitReceived(app.databasePath);
  await recordSpins(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Total' }).locator('.slot')).toHaveCount(2);
  const today = (await slots(page, TOTAL))[0]!.text;
  await clearSpins(page);

  // Act: Today から Month へ切り替えると、トークン数が増える。
  await page.getByText(periodLabels.month, { exact: true }).click();
  await expect.poll(async () => (await slots(page, TOTAL))[0]!.text).not.toBe(today);

  // Assert
  const month = (await slots(page, TOTAL))[0]!;
  expect(month.reels).toHaveLength(changedDigits(today, month.text));
  expect(month.reels.every((reel) => reel.up)).toBe(true);

  // Act & Assert: Month から Today へ戻すと、トークン数が減って下へ回る。
  await clearSpins(page);
  await page.getByText(periodLabels.today, { exact: true }).click();
  await expect.poll(async () => (await slots(page, TOTAL))[0]!.text).toBe(today);
  const back = (await slots(page, TOTAL))[0]!;
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
  await recordSpins(page);
  await page.goto('/');
  await expect(page.locator('[aria-label="Alpha Hub"] .slot')).toHaveCount(2);
  const alphaBefore = (await slots(page, '[aria-label="Alpha Hub"]'))[0]!.text;
  const next = advance(alpha.stats);
  await clearSpins(page);

  // Act: Alphaの利用量が増え、新しいモデルが内訳に加わる。
  const before = receivedAt(db, 'alpha');
  alpha.send('stats', next);
  await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);
  await expect
    .poll(async () => (await slots(page, '[aria-label="Alpha Hub"]'))[0]!.text)
    .not.toBe(alphaBefore);

  // Assert: Alphaは変わった桁だけが上へ回り、値の変わらないBetaは回らない。
  const alphaAfter = (await slots(page, '[aria-label="Alpha Hub"]'))[0]!;
  expect(alphaAfter.reels).toHaveLength(changedDigits(alphaBefore, alphaAfter.text));
  expect(alphaAfter.reels.every((reel) => reel.up)).toBe(true);
  expect((await slots(page, '[aria-label="Beta Hub"]')).flatMap((slot) => slot.reels)).toHaveLength(
    0,
  );
  // 同期で新たに表示されたモデルの値は、全桁が0から回る。
  const added = await slots(page, '[aria-label="By model"] tr', 'model-new');
  expect(added).toHaveLength(2);
  for (const slot of added) {
    expect(slot.reels).toHaveLength(digits(slot.text));
    expect(slot.reels.every((reel) => reel.from === 0)).toBe(true);
  }

  // Act: 同じ値の状態が届く。
  await clearSpins(page);
  const refetched = page.waitForResponse('**/api/overview');
  const saved = receivedAt(db, 'alpha');
  alpha.send('stats', { ...structuredClone(next), updatedAt: new Date().toISOString() });
  await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(saved);
  await refetched;
  await painted(page);

  // Assert: どの数値も回らない。
  expect(await spinCount(page)).toBe(0);
  expect((await slots(page, '[aria-label="Alpha Hub"]'))[0]!.text).toBe(alphaAfter.text);
});

test('OVW-8 アニメーションを減らす設定では、開いたときも期間の切り替えや同期でも回さない', async ({
  page,
  app,
  alpha,
}) => {
  // Arrange
  const db = app.databasePath;
  await waitReceived(db);
  await recordSpins(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // Act & Assert: 開いたとき
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Total' }).locator('.slot')).toHaveCount(2);
  await painted(page);
  expect(await spinCount(page)).toBe(0);

  // Act & Assert: 期間の切り替え
  const today = (await slots(page, TOTAL))[0]!.text;
  await page.getByText(periodLabels.month, { exact: true }).click();
  await expect.poll(async () => (await slots(page, TOTAL))[0]!.text).not.toBe(today);
  await painted(page);
  expect(await spinCount(page)).toBe(0);

  // Act & Assert: 同期
  const month = (await slots(page, TOTAL))[0]!.text;
  const before = receivedAt(db, 'alpha');
  alpha.send('stats', advance(alpha.stats));
  await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);
  await expect.poll(async () => (await slots(page, TOTAL))[0]!.text).not.toBe(month);
  await painted(page);
  expect(await spinCount(page)).toBe(0);
});
