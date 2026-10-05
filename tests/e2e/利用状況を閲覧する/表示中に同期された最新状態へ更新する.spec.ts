import type { Page as Page_part6, Page as Page_part8 } from '@playwright/test';
import {
  expect as expect_part6,
  expectPeriod as expectPeriod_part6,
  localTime as localTime_part6,
  receivedAt as receivedAt_part6,
  test as test_part6,
  TIME_ZONE as TIME_ZONE_part6,
  waitReceived as waitReceived_part6,
  expect as expect_part8,
  receivedAt as receivedAt_part8,
  test as test_part8,
  TIME_ZONE as TIME_ZONE_part8,
  waitReceived as waitReceived_part8,
  expect as expect_part10,
  expectPeriod as expectPeriod_part10,
  receivedAt as receivedAt_part10,
  test as test_part10,
  TIME_ZONE as TIME_ZONE_part10,
  waitReceived as waitReceived_part10,
} from '../overview/overview.ts';
import {
  PERIODS as PERIODS_part6,
  recalculateTotals as recalculateTotals_part6,
  PERIODS as PERIODS_part8,
  recalculateTotals as recalculateTotals_part8,
  PERIODS as PERIODS_part10,
  recalculateTotals as recalculateTotals_part10,
} from '../hub-sync/fake-hub.ts';
import type {
  FakeStats as FakeStats_part6,
  FakeStats as FakeStats_part8,
} from '../hub-sync/fake-hub.ts';
import {
  test as describePart6,
  test as describePart8,
  test as describePart10,
} from '@playwright/test';

describePart6.describe('refresh-while-viewing', () => {
  type Page = Page_part6;
  const expect = expect_part6;
  const expectPeriod = expectPeriod_part6;
  const localTime = localTime_part6;
  const receivedAt = receivedAt_part6;
  const test = test_part6;
  const TIME_ZONE = TIME_ZONE_part6;
  const waitReceived = waitReceived_part6;
  const PERIODS = PERIODS_part6;
  const recalculateTotals = recalculateTotals_part6;
  type FakeStats = FakeStats_part6;

  // 拡張シナリオ「表示中に同期された最新状態へ更新する」を検証する。

  test.use({ timezoneId: TIME_ZONE });

  /** Alphaの利用量と Session 枠の残量を進めた次の状態を作る。 */
  function advance(stats: FakeStats): FakeStats {
    const next = structuredClone(stats);
    next.updatedAt = new Date().toISOString();
    for (const name of PERIODS) next.devices[0].periods[name].clientModels.codex['gpt-5'] += 5000;
    const session = next.limits.providers[0].windows[0];
    session.remainingPercent = 70;
    session.usedPercent = 30;
    recalculateTotals(next, Date.now());
    return next;
  }

  /** 以後、読み込み中の表示や空の表示に切り替わったかを記録する。 */
  async function watchInterruption(page: Page) {
    await page.evaluate(() => {
      const state = window as unknown as { interrupted: boolean };
      state.interrupted = false;
      new MutationObserver(() => {
        if (
          document.querySelector('[aria-label="Loading"]') ||
          !document.querySelector('section[aria-label="Total"]')
        )
          state.interrupted = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    return () => page.evaluate(() => (window as unknown as { interrupted: boolean }).interrupted);
  }

  test('OVR-1 表示中に同期が保存を確定すると、選択を保ったまま最新の保存状態に更新する', async ({
    page,
    app,
    alpha,
    beta,
  }) => {
    // Arrange
    const db = app.databasePath;
    await test.step('分岐条件', async () => {
      await waitReceived(db);

      await page.goto('/');
    });
    await test.step('手順2', async () => {
      await page.getByText('Month', { exact: true }).click();
    });
    const limits = page.getByRole('region', { name: 'Usage limits' });
    await test.step('手順2', async () => {
      await limits.getByText('Beta Hub', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expectPeriod(page, { alpha: alpha.stats, beta: beta.stats }, 'month');
    });
    const interrupted = await watchInterruption(page);
    const before = receivedAt(db, 'alpha');
    const next = advance(alpha.stats);
    await test.step('手順1', async () => {
      // Act: 利用者は操作せず、Hubが新しい状態を送って保存される。
      alpha.send('stats', next);
    });
    await test.step('受け入れ条件', async () => {
      await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);

      // Assert: 全区画が最新の保存状態になり、期間と利用枠のHubの選択は変わらない。
      await expectPeriod(page, { alpha: next, beta: beta.stats }, 'month');

      await expect(
        page.getByRole('region', { name: 'By hub' }).locator('[aria-label="Alpha Hub"]'),
      ).toContainText(
        `Received ${localTime(receivedAt(db, 'alpha')!)} · Updated ${localTime(next.updatedAt)}`,
      );

      await expect(limits.getByRole('radio', { name: 'Beta Hub' })).toBeChecked();

      expect(await interrupted()).toBe(false);
    });
    await test.step('手順2', async () => {
      // Act & Assert: 更新後に利用枠のHubを切り替えると、読み直した値を表示する。
      await limits.getByText('Alpha Hub', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(limits).toContainText('70% 5h');

      await expect(page.getByRole('radio', { name: 'Month' })).toBeChecked();
    });
  });

  test('OVR-2 通知の接続が切れて再接続すると、その時点の保存状態で表示し直す', async ({
    page,
    app,
    alpha,
    beta,
  }) => {
    // Arrange: 最初の接続は ready だけを送って切れる。再接続は保存が終わるまで待たせてから本物へ通す。
    const db = app.databasePath;
    await test.step('分岐条件', async () => {
      await waitReceived(db);
    });
    let subscriptions = 0;
    let reconnect!: () => void;
    const reconnected = new Promise<void>((resolve) => (reconnect = resolve));
    await test.step('分岐条件', async () => {
      await page.route('**/api/events', async (route) => {
        subscriptions++;
        if (subscriptions === 1) {
          await route.fulfill({
            contentType: 'text/event-stream',
            body: 'retry: 100\nevent: ready\ndata: {}\n\n',
          });
          return;
        }
        await reconnected;
        await route.continue();
      });

      await page.goto('/');
    });
    await test.step('受け入れ条件', async () => {
      await expectPeriod(page, { alpha: alpha.stats, beta: beta.stats }, 'today');

      await expect.poll(() => subscriptions).toBe(2);
    });
    const before = receivedAt(db, 'alpha');
    const next = advance(alpha.stats);
    await test.step('手順1', async () => {
      // Act: 接続が切れている間に保存され、その後に再接続する。
      alpha.send('stats', next);
    });
    await test.step('受け入れ条件', async () => {
      await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);
    });
    await test.step('分岐条件', async () => {
      reconnect();
    });
    await test.step('受け入れ条件', async () => {
      // Assert
      await expectPeriod(page, { alpha: next, beta: beta.stats }, 'today');
    });
  });
});
describePart8.describe('slot-number', () => {
  type Page = Page_part8;
  const expect = expect_part8;
  const receivedAt = receivedAt_part8;
  const test = test_part8;
  const TIME_ZONE = TIME_ZONE_part8;
  const waitReceived = waitReceived_part8;
  const PERIODS = PERIODS_part8;
  const recalculateTotals = recalculateTotals_part8;
  type FakeStats = FakeStats_part8;

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

  test('OVW-7 表示中の同期で値が変わった数値だけを回し、同じ値が届いたときは回さない', async ({
    page,
    app,
    alpha,
  }) => {
    // Arrange
    const db = app.databasePath;
    await test.step('分岐条件', async () => {
      await waitReceived(db);

      await recordSpins(page);

      await page.goto('/');
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.locator('[aria-label="Alpha Hub"] .slot')).toHaveCount(2);
    });
    const alphaBefore = (await slots(page, '[aria-label="Alpha Hub"]'))[0]!.text;
    const next = advance(alpha.stats);
    await test.step('分岐条件', async () => {
      await clearSpins(page);
    });

    // Act: Alphaの利用量が増え、新しいモデルが内訳に加わる。
    const before = receivedAt(db, 'alpha');
    await test.step('手順1', async () => {
      alpha.send('stats', next);
    });
    await test.step('受け入れ条件', async () => {
      await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);
    });
    await test.step('分岐条件', async () => {
      await expect
        .poll(async () => (await slots(page, '[aria-label="Alpha Hub"]'))[0]!.text)
        .not.toBe(alphaBefore);
    });

    // Assert: Alphaは変わった桁だけが上へ回り、値の変わらないBetaは回らない。
    const alphaAfter = (await slots(page, '[aria-label="Alpha Hub"]'))[0]!;
    await test.step('受け入れ条件', async () => {
      expect(alphaAfter.reels).toHaveLength(changedDigits(alphaBefore, alphaAfter.text));

      expect(alphaAfter.reels.every((reel) => reel.up)).toBe(true);

      expect(
        (await slots(page, '[aria-label="Beta Hub"]')).flatMap((slot) => slot.reels),
      ).toHaveLength(0);
    });
    // 同期で新たに表示されたモデルの値は、全桁が0から回る。
    const added = await slots(page, '[aria-label="By model"] tr', 'model-new');
    await test.step('受け入れ条件', async () => {
      expect(added).toHaveLength(2);

      for (const slot of added) {
        expect(slot.reels).toHaveLength(digits(slot.text));
        expect(slot.reels.every((reel) => reel.from === 0)).toBe(true);
      }
    });
    await test.step('分岐条件', async () => {
      // Act: 同じ値の状態が届く。
      await clearSpins(page);
    });
    const refetched = page.waitForResponse('**/api/overview');
    const saved = receivedAt(db, 'alpha');
    await test.step('手順1', async () => {
      alpha.send('stats', { ...structuredClone(next), updatedAt: new Date().toISOString() });
    });
    await test.step('受け入れ条件', async () => {
      await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(saved);
    });
    await test.step('分岐条件', async () => {
      await refetched;

      await painted(page);
    });
    await test.step('受け入れ条件', async () => {
      // Assert: どの数値も回らない。
      expect(await spinCount(page)).toBe(0);

      expect((await slots(page, '[aria-label="Alpha Hub"]'))[0]!.text).toBe(alphaAfter.text);
    });
  });
});
describePart10.describe('view-overview', () => {
  const expect = expect_part10;
  const expectPeriod = expectPeriod_part10;
  const receivedAt = receivedAt_part10;
  const test = test_part10;
  const TIME_ZONE = TIME_ZONE_part10;
  const waitReceived = waitReceived_part10;
  const PERIODS = PERIODS_part10;
  const recalculateTotals = recalculateTotals_part10;

  // 主成功シナリオ「保存済みの最新利用状況を1画面で見る」と、ユースケース共通の受け入れ条件を検証する。

  test.use({ timezoneId: TIME_ZONE });

  test('OVW-3 再読み込みで最新の保存状態を表示する', async ({ page, app, alpha, beta }) => {
    // Arrange
    const db = app.databasePath;
    await test.step('分岐条件', async () => {
      await waitReceived(db);

      await page.goto('/');
    });
    await test.step('手順2', async () => {
      await page.getByText('All time', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expectPeriod(page, { alpha: alpha.stats, beta: beta.stats }, 'allTime');
    });
    const before = receivedAt(db, 'alpha');
    const next = structuredClone(alpha.stats);
    await test.step('分岐条件', async () => {
      for (const name of PERIODS) next.devices[0].periods[name].clientModels.codex['gpt-5'] += 5000;

      recalculateTotals(next, Date.now());
    });
    await test.step('手順1', async () => {
      // Act: 表示中にHubが新しい状態を送り、保存される。
      alpha.send('stats', next);
    });
    await test.step('受け入れ条件', async () => {
      await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);

      // Assert: 表示中の画面は変更通知を受けて最新の保存状態になる。
      await expectPeriod(page, { alpha: next, beta: beta.stats }, 'allTime');
    });
    await test.step('分岐条件', async () => {
      // Act & Assert: 再読み込みで最新の保存状態を Today から表示する。
      await page.reload();
    });
    await test.step('受け入れ条件', async () => {
      await expectPeriod(page, { alpha: next, beta: beta.stats }, 'today');
    });
    await test.step('手順2', async () => {
      await page.getByText('All time', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expectPeriod(page, { alpha: next, beta: beta.stats }, 'allTime');
    });
  });
});
