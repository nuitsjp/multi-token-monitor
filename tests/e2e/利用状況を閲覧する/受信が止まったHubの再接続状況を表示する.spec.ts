import type { Page as Page_part5 } from '@playwright/test';
import {
  expect as expect_part5,
  expectPeriod as expectPeriod_part5,
  localTime as localTime_part5,
  receivedAt as receivedAt_part5,
  test as test_part5,
  TIME_ZONE as TIME_ZONE_part5,
  waitReceived as waitReceived_part5,
} from '../overview/overview.ts';
import {
  PERIODS as PERIODS_part5,
  recalculateTotals as recalculateTotals_part5,
} from '../hub-sync/fake-hub.ts';
import type { FakeStats as FakeStats_part5 } from '../hub-sync/fake-hub.ts';
import { test as describePart5 } from '@playwright/test';

describePart5.describe('reconnect-status', () => {
  type Page = Page_part5;
  const expect = expect_part5;
  const expectPeriod = expectPeriod_part5;
  const localTime = localTime_part5;
  const receivedAt = receivedAt_part5;
  const test = test_part5;
  const TIME_ZONE = TIME_ZONE_part5;
  const waitReceived = waitReceived_part5;
  const PERIODS = PERIODS_part5;
  const recalculateTotals = recalculateTotals_part5;
  type FakeStats = FakeStats_part5;

  // 拡張シナリオ「受信が止まったHubの再接続状況を表示する」を検証する。

  test.use({ timezoneId: TIME_ZONE });

  function hubRow(page: Page, name: string) {
    return page.getByRole('region', { name: 'By hub' }).locator(`[aria-label="${name}"]`);
  }

  function indicator(page: Page, name: string) {
    return hubRow(page, name).getByRole('img', { name: /^Reconnecting\./ });
  }

  /** Alphaの利用量を進めた次の状態を作る。 */
  function advance(stats: FakeStats): FakeStats {
    const next = structuredClone(stats);
    next.updatedAt = new Date().toISOString();
    for (const name of PERIODS) next.devices[0].periods[name].clientModels.codex['gpt-5'] += 7000;
    recalculateTotals(next, Date.now());
    return next;
  }

  test('OVC-1 画面を開いた時点で再接続中のHubだけに目印を付け、説明を表示する', async ({
    page,
    app,
  }) => {
    // Arrange: Offline Hubは接続を拒否され、状態を受信しないまま再接続中になる。
    const db = app.databasePath;
    await test.step('分岐条件', async () => {
      await waitReceived(db);
    });
    await test.step('手順1', async () => {
      // Act
      await page.goto('/');
    });
    await test.step('受け入れ条件', async () => {
      // Assert: 先頭ページの受信済みHubには目印を付けない。未受信の再接続中Hubは次のページにあり、目印と未受信を併せて示す。
      await expect(indicator(page, 'Alpha Hub')).toHaveCount(0);

      await expect(indicator(page, 'Beta Hub')).toHaveCount(0);
    });
    await test.step('分岐条件', async () => {
      await page.getByLabel('Hub page').getByRole('button', { name: '2', exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(indicator(page, 'Offline Hub')).toBeVisible();

      await expect(hubRow(page, 'Offline Hub')).toContainText('Not received');

      // 全体の合計、利用枠、端末の区画には目印を付けない。
      for (const name of ['Total', 'Usage limits', 'Devices'])
        await expect(
          page.getByRole('region', { name }).getByRole('img', { name: /Reconnecting/ }),
        ).toHaveCount(0);
    });
    await test.step('手順1', async () => {
      // マウスを重ねると、未受信のHubの説明を表示する。
      await indicator(page, 'Offline Hub').hover();
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('tooltip')).toHaveText('ReconnectingNo data received yet');
    });

    // 目印はアニメーションし、動きを減らす設定では静止する。
    const arcAnimation = () =>
      indicator(page, 'Offline Hub')
        .locator('.arc')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName);
    await test.step('受け入れ条件', async () => {
      expect(await arcAnimation()).toBe('reconnecting-arc');
    });
    await test.step('分岐条件', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
    });
    await test.step('受け入れ条件', async () => {
      expect(await arcAnimation()).toBe('none');
    });
  });

  test('OVC-2 表示中に受信が止まると目印を付け、再接続後の保存で外して最新の状態を表示する', async ({
    page,
    app,
    request,
    alpha,
    beta,
  }) => {
    // Arrange
    const db = app.databasePath;
    await test.step('分岐条件', async () => {
      await waitReceived(db);
    });
    await test.step('手順1', async () => {
      await page.goto('/');
    });
    await test.step('分岐条件', async () => {
      await page.getByText('Month', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expectPeriod(page, { alpha: alpha.stats, beta: beta.stats }, 'month');

      await expect(indicator(page, 'Alpha Hub')).toHaveCount(0);
    });
    const before = receivedAt(db, 'alpha')!;
    const saved = alpha.stats;
    const next = advance(saved);
    await test.step('分岐条件', async () => {
      // Act: 利用者は操作せず、Alphaの受信が止まる。再接続は2回失敗してから、新しい状態で成功する。
      alpha.stats = next;

      alpha.fail('unauthorized', 'unauthorized');
    });
    await test.step('手順1', async () => {
      alpha.disconnect();
    });
    await test.step('受け入れ条件', async () => {
      // Assert: 目印が付き、値は最後に保存した状態のまま、期間の選択も変わらない。
      await expect(indicator(page, 'Alpha Hub')).toBeVisible();

      await expectPeriod(page, { alpha: saved, beta: beta.stats }, 'month');

      await expect(page.getByRole('radio', { name: 'Month' })).toBeChecked();
    });
    await test.step('手順1', async () => {
      await indicator(page, 'Alpha Hub').hover();
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('tooltip')).toHaveText('ReconnectingShowing last saved data');
    });
    // 受信が止まった原因は閲覧用APIに含めない。
    const overview = await (await request.get('/api/overview')).json();
    await test.step('受け入れ条件', async () => {
      expect(overview.hubs.find((hub: { hubId: string }) => hub.hubId === 'alpha')).toEqual({
        hubId: 'alpha',
        name: 'Alpha Hub',
        connected: false,
        receivedAt: before,
        updatedAt: saved.updatedAt,
      });
    });
    await test.step('手順2', async () => {
      // 再接続した接続で新しい状態を受け取り、保存する。
      await expect.poll(() => receivedAt(db, 'alpha'), { timeout: 15_000 }).not.toBe(before);
    });
    await test.step('受け入れ条件', async () => {
      // Assert: 目印が外れ、最新の保存状態を表示する。期間の選択は変わらない。
      await expect(indicator(page, 'Alpha Hub')).toHaveCount(0);

      await expectPeriod(page, { alpha: next, beta: beta.stats }, 'month');

      await expect(hubRow(page, 'Alpha Hub')).toContainText(
        `Received ${localTime(receivedAt(db, 'alpha')!)} · Updated ${localTime(next.updatedAt)}`,
      );

      await expect(page.getByRole('radio', { name: 'Month' })).toBeChecked();
    });
  });
});
