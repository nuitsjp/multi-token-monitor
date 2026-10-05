import type {
  Page as Page_part11,
  Locator as Locator_part13,
  Page as Page_part13,
} from '@playwright/test';
import {
  expect as expect_part11,
  test as test_part11,
  waitSaved as waitSaved_part11,
  dailyCost as dailyCost_part13,
  dailyTokens as dailyTokens_part13,
  dayBefore as dayBefore_part13,
  expect as expect_part13,
  models as models_part13,
  storedSnapshot as storedSnapshot_part13,
  test as test_part13,
  waitSaved as waitSaved_part13,
} from '../hub-usage/hub-usage.ts';
import { test as describePart11, test as describePart13 } from '@playwright/test';
import { query as query_part13 } from '../hub-sync/sync.ts';

describePart11.describe('slot-and-unknown-cost', () => {
  type Page = Page_part11;
  const expect = expect_part11;
  const test = test_part11;
  const waitSaved = waitSaved_part11;

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
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);

      await recordSpins(page);
    });
    await test.step('手順1', async () => {
      await page.goto('/by-hub');
    });
    await test.step('受け入れ条件', async () => {
      await expect(
        page.locator(
          `${SUMMARY_AND_DEVICES.split(', ')
            .map((selector) => `${selector} .slot`)
            .join(', ')}`,
        ),
      ).toHaveCount(6);
    });
    const values = await slots(page);
    await test.step('受け入れ条件', async () => {
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
  });

  test('HUB-6 期間切替では変化した桁だけを増加と減少の方向へ回転する', async ({ page, app }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);

      await recordSpins(page);
    });
    await test.step('手順1', async () => {
      await page.goto('/by-hub');
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.locator('.by-hub-summary .slot')).toHaveCount(2);
    });
    let before = await slots(page);
    await test.step('手順3', async () => {
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
    });
    await test.step('開始条件', async () => {
      await clearSpins(page);
    });
    await test.step('手順4', async () => {
      await page.getByLabel('Aggregation').selectOption('weekly');
    });
    await test.step('受け入れ条件', async () => {
      expect((await slots(page)).flatMap((slot) => slot.reels)).toHaveLength(0);
    });
  });

  test('HUB-7 reduced motionでは初回表示も期間切替も数値を回転させない', async ({ page, app }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);

      await recordSpins(page);

      await page.emulateMedia({ reducedMotion: 'reduce' });
    });
    await test.step('手順1', async () => {
      await page.goto('/by-hub');
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.locator('.by-hub-summary .slot')).toHaveCount(2);

      expect((await slots(page)).flatMap((slot) => slot.reels)).toHaveLength(0);
    });
    const before = (await slots(page))[0].text;
    await test.step('手順3', async () => {
      await page.getByText('7D', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect.poll(async () => (await slots(page))[0].text).not.toBe(before);

      expect((await slots(page)).flatMap((slot) => slot.reels)).toHaveLength(0);
    });
  });
});
describePart13.describe('view-hub-usage', () => {
  type Locator = Locator_part13;
  type Page = Page_part13;
  const dailyCost = dailyCost_part13;
  const dailyTokens = dailyTokens_part13;
  const dayBefore = dayBefore_part13;
  const expect = expect_part13;
  const models = models_part13;
  const storedSnapshot = storedSnapshot_part13;
  const test = test_part13;
  const waitSaved = waitSaved_part13;
  const query = query_part13;

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
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);

      await page.setViewportSize({ width: 1600, height: 1000 });
    });
    await test.step('手順1', async () => {
      await page.goto('/by-hub');
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('radio', { name: 'Personal', exact: true })).toBeChecked();

      await expect(page.getByRole('radio', { name: '2W', exact: true })).toBeChecked();

      await expect(page.getByLabel('Aggregation')).toHaveValue('daily');

      await expectTotals(page, 14);

      await expect(tokenChart(page).locator('[role="graphics-symbol"]')).toHaveCount(14);
    });
    const devices = page.getByRole('region', { name: 'Usage by device' });
    await test.step('受け入れ条件', async () => {
      await expect(devices.locator('.by-hub-device-name')).toHaveText([/Personal-1/, /Personal-2/]);

      await expect(devices).toContainText('Stale');

      await expect(devices).toContainText('Last seen');

      await expect(devices.locator('.by-hub-device').first()).toContainText('39,200,000');

      await expect(devices.locator('.by-hub-device').first()).toContainText('$784.00');

      await expect(devices.locator('.by-hub-device').last()).toContainText('78,400,000');
    });
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
    await test.step('受け入れ条件', async () => {
      expect(shares[0].value).toBeCloseTo(100 / 3, 1);

      expect(shares[1].value).toBeCloseTo(200 / 3, 1);

      expect(shares.map((share) => share.color)).toEqual([
        'rgb(107, 158, 172)',
        'rgb(151, 137, 199)',
      ]);
    });
    const nameOsCenters = await devices.locator('.by-hub-device-name').evaluateAll((links) =>
      links.map((link) => {
        const name = link.getBoundingClientRect();
        const os = link.nextElementSibling!.getBoundingClientRect();
        return Math.abs(name.y + name.height / 2 - os.y - os.height / 2);
      }),
    );
    await test.step('受け入れ条件', async () => {
      expect(nameOsCenters.every((difference) => difference < 1)).toBe(true);
    });
    const hostStyles = await devices.locator('.by-hub-device-name').evaluateAll((links) =>
      links.map((link) => {
        const style = getComputedStyle(link.firstElementChild!);
        return { fontSize: style.fontSize, fontWeight: style.fontWeight };
      }),
    );
    await test.step('受け入れ条件', async () => {
      expect(hostStyles).toEqual([
        { fontSize: '14px', fontWeight: '400' },
        { fontSize: '14px', fontWeight: '400' },
      ]);
    });
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
    await test.step('受け入れ条件', async () => {
      expect(costBox!.y).toBeGreaterThan(tokensBox!.y + tokensBox!.height);

      expect(devicesBox!.x).toBeGreaterThan(tokensBox!.x + tokensBox!.width);

      expect(
        Math.abs(titleBox!.y + titleBox!.height / 2 - periodBox!.y - periodBox!.height / 2),
      ).toBeLessThan(4);

      expect(
        Math.abs(unitBox!.y + unitBox!.height / 2 - periodBox!.y - periodBox!.height / 2),
      ).toBeLessThan(4);
    });
    const bars = await devices.locator('.by-hub-device-bar').evaluateAll((rows) =>
      rows.map((row) => ({
        valueX: row.children[2].getBoundingClientRect().right,
        height: row.querySelector('[role="progressbar"]')?.getBoundingClientRect().height,
      })),
    );
    await test.step('受け入れ条件', async () => {
      expect(new Set(bars.map((bar) => bar.valueX)).size).toBe(1);

      expect(bars.map((bar) => bar.height)).toEqual([8, 8, 8, 8]);
    });
    await test.step('手順2', async () => {
      await page
        .getByRole('radiogroup', { name: 'Hub', exact: true })
        .getByText('Work', { exact: true })
        .click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(devices.locator('.by-hub-device-name')).toHaveText([/Work-1/, /Work-2/]);

      await expect(page.getByRole('radio', { name: '2W', exact: true })).toBeChecked();

      await expectTotals(page, 14, 2);

      await expect(devices.getByRole('link')).toHaveCount(0);
    });
  });

  test('HUB-2 期間と集約単位を共有して両グラフを更新し、集約だけでは合計と端末を変えない', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);
    });
    await test.step('手順1', async () => {
      await page.goto('/by-hub');
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 14);
    });
    await test.step('手順3', async () => {
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
        const dates = (
          await page.getByRole('region', { name: 'Usage by model' }).innerText()
        ).match(/\d{4}-\d{2}-\d{2}/g)!;
        const days = (Date.parse(dates[1]) - Date.parse(dates[0])) / 86_400_000 + 1;
        expect(days).toBeGreaterThan(label === '3M' ? 85 : 360);
        expect(days).toBeLessThan(label === '3M' ? 94 : 367);
        await expectTotals(page, days);
      }
    });
    const response = await page.request.get('/api/hub-usage');
    const { today } = (await response.json()) as { today: string };
    await test.step('手順3', async () => {
      await page.getByRole('button', { name: 'Choose date range' }).click();
    });
    await test.step('開始条件', async () => {
      await page.getByLabel('Start date').fill(dayBefore(today, 5));

      await page.getByLabel('End date').fill(dayBefore(today, 3));
    });
    await test.step('手順3', async () => {
      await page.getByRole('button', { name: 'Apply range' }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 3);
    });
    const devicesBefore = await page.getByRole('region', { name: 'Usage by device' }).innerText();
    await test.step('手順4', async () => {
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
  });

  test('HUB-3 モデルは上位5とOtherで同色にまとめ、凡例は両グラフだけを絞り込む', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);
    });
    await test.step('手順1', async () => {
      await page.goto('/by-hub');
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 14);
    });
    const legend = page.locator('.by-hub-legend');
    await test.step('受け入れ条件', async () => {
      await expect(legend.getByRole('button')).toHaveText([...models.slice(0, 5), 'Other']);
    });
    const fills = async (chart: Locator) =>
      chart
        .locator('g')
        .filter({ has: page.locator('.hub-chart-target') })
        .first()
        .locator('rect:not(.hub-chart-target)')
        .evaluateAll((rects) => rects.map((rect) => rect.getAttribute('fill')));
    await test.step('受け入れ条件', async () => {
      expect(await fills(tokenChart(page))).toEqual([
        '#9789c7',
        '#6b9eac',
        '#bf966b',
        '#83a584',
        '#b97d94',
        '#626572',
      ]);

      expect(await fills(costChart(page))).toEqual(await fills(tokenChart(page)));
    });
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
    await test.step('受け入れ条件', async () => {
      expect(shared).toEqual([{ tokens: 700_000, cost_usd: 14 }]);
    });
    await test.step('手順5', async () => {
      await tokenChart(page).locator('[role="graphics-symbol"]').first().focus();
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('tooltip')).toContainText('8,400,000');

      await expect(page.getByRole('tooltip')).toContainText('2,100,000');

      await expect(page.getByRole('tooltip')).toContainText('Other');
    });
    const devicesBefore = await page.getByRole('region', { name: 'Usage by device' }).innerText();
    const summaryBefore = await page.locator('.by-hub-summary').innerText();
    await test.step('手順6', async () => {
      await legend.getByRole('button', { name: 'shared-model', exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(
        legend.getByRole('button', { name: 'shared-model', exact: true }),
      ).toHaveAttribute('aria-pressed', 'false');

      expect(await chartTotal(tokenChart(page))).toBe((dailyTokens - 2_100_000) * 14);

      expect(await chartTotal(costChart(page))).toBe((dailyCost - 21) * 14);

      expect(await page.locator('.by-hub-summary').innerText()).toBe(summaryBefore);

      expect(await page.getByRole('region', { name: 'Usage by device' }).innerText()).toBe(
        devicesBefore,
      );
    });
    await test.step('手順6', async () => {
      await legend.getByRole('button', { name: 'shared-model', exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 14);
    });
    await test.step('手順3', async () => {
      await page.getByText('1Y', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(legend.getByRole('button')).toHaveText([
        'archive-model',
        ...models.slice(1, 5),
        'Other',
      ]);
    });
  });

  test('HUB-4 画面とAPIは接続情報を公開せず、保存済みデータを読み取りだけで表示する', async ({
    page,
    app,
    personal,
    work,
  }) => {
    await test.step('開始条件', async () => {
      await waitSaved(app.databasePath);
    });
    const before = storedSnapshot(app.databasePath);
    await test.step('手順1', async () => {
      await page.goto('/by-hub');
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 14);
    });
    const response = await page.request.get('/api/hub-usage');
    await test.step('受け入れ条件', async () => {
      expect(response.status()).toBe(200);
    });
    const body = await response.text();
    const html = await page.content();
    await test.step('受け入れ条件', async () => {
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
    });
    await test.step('手順2', async () => {
      await page
        .getByRole('radiogroup', { name: 'Hub', exact: true })
        .getByText('Work', { exact: true })
        .click();
    });
    await test.step('手順3', async () => {
      await page.getByText('7D', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expectTotals(page, 7, 2);

      expect(storedSnapshot(app.databasePath)).toBe(before);
    });
  });
});
