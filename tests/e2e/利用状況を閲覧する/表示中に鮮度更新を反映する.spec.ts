import type { Page as Page_part3, Route as Route_part3 } from '@playwright/test';
import {
  expect as expect_part3,
  expectPeriod as expectPeriod_part3,
  localTime as localTime_part3,
  receivedAt as receivedAt_part3,
  test as test_part3,
  TIME_ZONE as TIME_ZONE_part3,
  waitReceived as waitReceived_part3,
} from '../overview/overview.ts';
import type { FakeHub as FakeHub_part3 } from '../hub-sync/fake-hub.ts';
import { test as describePart3 } from '@playwright/test';

describePart3.describe('freshness-while-viewing', () => {
  type Page = Page_part3;
  type Route = Route_part3;
  const expect = expect_part3;
  const expectPeriod = expectPeriod_part3;
  const localTime = localTime_part3;
  const receivedAt = receivedAt_part3;
  const test = test_part3;
  const TIME_ZONE = TIME_ZONE_part3;
  const waitReceived = waitReceived_part3;
  type FakeHub = FakeHub_part3;

  // 拡張シナリオ「表示中に鮮度更新を反映する」を検証する。

  test.use({ timezoneId: TIME_ZONE });

  /**
   * Alphaの時刻の更新を送る。1台目の送信時刻を進め、鮮度切れだった2台目を鮮度切れでなくし、
   * 画面に表示していない端末を含める。画面で時刻の変化を見分けられるよう、Hubの更新時刻は5分先にする。
   */
  function sendFreshness(alpha: FakeHub) {
    const updatedAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const [first, second] = alpha.stats.devices;
    alpha.send('freshness', {
      updatedAt,
      staleAfterMs: 600_000,
      limits: { updatedAt },
      devices: [
        { deviceId: first.deviceId, updatedAt, receivedAt: updatedAt, ageMs: 0, stale: false },
        { deviceId: second.deviceId, updatedAt, receivedAt: updatedAt, ageMs: 0, stale: false },
        { deviceId: 'unknown-device', updatedAt, receivedAt: updatedAt, ageMs: 0, stale: true },
      ],
    });
    return updatedAt;
  }

  function deviceRow(page: Page, hostname: string) {
    return page
      .getByRole('region', { name: 'Devices' })
      .getByRole('row')
      .filter({ hasText: hostname });
  }

  test('OVF-1 表示中に時刻の更新を受けると、閲覧用APIを呼ばずに時刻と鮮度切れだけを書き換える', async ({
    page,
    app,
    alpha,
    beta,
  }) => {
    // Arrange: 期間と利用枠のHubを選び、以後の閲覧用APIの呼び出しを数える。
    const db = app.databasePath;
    await test.step('分岐条件', async () => {
      await waitReceived(db);

      await page.goto('/');

      await page.getByText('Month', { exact: true }).click();
    });
    const limits = page.getByRole('region', { name: 'Usage limits' });
    await test.step('分岐条件', async () => {
      await limits.getByText('Beta Hub', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expectPeriod(page, { alpha: alpha.stats, beta: beta.stats }, 'month');
    });
    const limitsBefore = await limits.innerText();
    const deviceRows = page.getByRole('region', { name: 'Devices' }).getByRole('row');
    const rowCount = await deviceRows.count();
    const [first, second] = alpha.stats.devices;
    await test.step('受け入れ条件', async () => {
      await expect(deviceRow(page, second.hostname)).toContainText('Stale');
    });
    let overviewCalls = 0;
    await test.step('分岐条件', async () => {
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/overview') overviewCalls++;
      });
    });
    const before = receivedAt(db, 'alpha');

    // Act: 利用者は操作せず、Hubが時刻の更新を送って保存される。
    const updatedAt = sendFreshness(alpha);
    await test.step('受け入れ条件', async () => {
      await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);

      // Assert: 当該Hubの時刻と、端末の時刻と鮮度切れが保存済みの値になる。
      await expect(
        page.getByRole('region', { name: 'By hub' }).locator('[aria-label="Alpha Hub"]'),
      ).toContainText(
        `Received ${localTime(receivedAt(db, 'alpha')!)} · Updated ${localTime(updatedAt)}`,
      );

      for (const device of [first, second]) {
        await expect(deviceRow(page, device.hostname)).toContainText(localTime(updatedAt));
        await expect(deviceRow(page, device.hostname)).toContainText('Live');
      }

      // 閲覧用APIは呼ばず、利用量・利用枠・選択と、表示していない端末の扱いは変わらない。
      expect(overviewCalls).toBe(0);

      await expectPeriod(page, { alpha: alpha.stats, beta: beta.stats }, 'month');

      await expect(limits.getByRole('radio', { name: 'Beta Hub' })).toBeChecked();

      expect(await limits.innerText()).toBe(limitsBefore);

      await expect(deviceRows).toHaveCount(rowCount);
    });
  });

  test('OVF-2 読み直しの途中で時刻の更新を受けても、読み直しの完了後に古い時刻へ戻らない', async ({
    page,
    app,
    alpha,
    beta,
  }) => {
    // Arrange: 画面を開いた後の閲覧用APIは、本物の応答を先に受け取ってから、合図するまで画面へ返さない。
    const db = app.databasePath;
    await test.step('分岐条件', async () => {
      await waitReceived(db);

      await page.goto('/');
    });
    await test.step('受け入れ条件', async () => {
      await expectPeriod(page, { alpha: alpha.stats, beta: beta.stats }, 'today');
    });
    let fetched!: () => void;
    const responseFetched = new Promise<void>((resolve) => (fetched = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await test.step('分岐条件', async () => {
      await page.route('**/api/overview', async (route: Route) => {
        const response = await route.fetch();
        fetched();
        await released;
        await route.fulfill({ response });
      });
    });
    const next = structuredClone(alpha.stats);
    await test.step('分岐条件', async () => {
      next.updatedAt = new Date().toISOString();
    });
    const beforeStats = receivedAt(db, 'alpha');
    await test.step('手順1', async () => {
      // Act: statsの保存で読み直しが始まり、その応答が届く前に時刻の更新が保存される。
      alpha.send('stats', next);
    });
    await test.step('受け入れ条件', async () => {
      await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(beforeStats);
    });
    await test.step('分岐条件', async () => {
      await responseFetched;
    });
    const beforeFreshness = receivedAt(db, 'alpha');
    const updatedAt = sendFreshness(alpha);
    await test.step('受け入れ条件', async () => {
      await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(beforeFreshness);
    });
    const byHub = page.getByRole('region', { name: 'By hub' }).locator('[aria-label="Alpha Hub"]');
    const fresh = `Received ${localTime(receivedAt(db, 'alpha')!)} · Updated ${localTime(updatedAt)}`;
    await test.step('受け入れ条件', async () => {
      await expect(byHub).toContainText(fresh);
    });
    const reloaded = page.waitForResponse('**/api/overview');
    await test.step('分岐条件', async () => {
      release();

      // Assert: 時刻の更新より前の保存状態を返した読み直しの後も、時刻と鮮度切れは時刻の更新の値のまま。
      await reloaded;
    });
    await test.step('受け入れ条件', async () => {
      await expect(byHub).toContainText(fresh);

      await expect(deviceRow(page, alpha.stats.devices[1].hostname)).toContainText('Live');
    });
  });
});
