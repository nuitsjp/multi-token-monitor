import type { Page } from '@playwright/test';
import {
  expect,
  expectPeriod,
  localTime,
  receivedAt,
  test,
  TIME_ZONE,
  waitReceived,
} from './overview.ts';
import { PERIODS, recalculateTotals, type FakeStats } from '../hub-sync/fake-hub.ts';

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
  // Arrange: Offline Hubは接続できず、状態を受信しないまま再接続中になる。
  const db = app.databasePath;
  await waitReceived(db);

  // Act
  await page.goto('/');

  // Assert: 再接続中のHubだけに目印が付き、未受信の表示と併せて示す。
  await expect(indicator(page, 'Offline Hub')).toBeVisible();
  await expect(hubRow(page, 'Offline Hub')).toContainText('Not received');
  await expect(indicator(page, 'Alpha Hub')).toHaveCount(0);
  await expect(indicator(page, 'Beta Hub')).toHaveCount(0);
  // 全体の合計、利用枠、端末の区画には目印を付けない。
  for (const name of ['Total', 'Usage limits', 'Devices'])
    await expect(
      page.getByRole('region', { name }).getByRole('img', { name: /Reconnecting/ }),
    ).toHaveCount(0);

  // マウスを重ねると、未受信のHubの説明を表示する。
  await indicator(page, 'Offline Hub').hover();
  await expect(page.getByRole('tooltip')).toHaveText('ReconnectingNo data received yet');

  // 目印はアニメーションし、動きを減らす設定では静止する。
  const arcAnimation = () =>
    indicator(page, 'Offline Hub')
      .locator('.arc')
      .first()
      .evaluate((element) => getComputedStyle(element).animationName);
  expect(await arcAnimation()).toBe('reconnecting-arc');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await arcAnimation()).toBe('none');
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
  await waitReceived(db);
  await page.goto('/');
  await page.getByText('Month', { exact: true }).click();
  await expectPeriod(page, { alpha: alpha.stats, beta: beta.stats }, 'month');
  await expect(indicator(page, 'Alpha Hub')).toHaveCount(0);
  const before = receivedAt(db, 'alpha')!;
  const saved = alpha.stats;
  const next = advance(saved);

  // Act: 利用者は操作せず、Alphaの受信が止まる。再接続は2回失敗してから、新しい状態で成功する。
  alpha.stats = next;
  alpha.fail('unauthorized', 'unauthorized');
  alpha.disconnect();

  // Assert: 目印が付き、値は最後に保存した状態のまま、期間の選択も変わらない。
  await expect(indicator(page, 'Alpha Hub')).toBeVisible();
  await expectPeriod(page, { alpha: saved, beta: beta.stats }, 'month');
  await expect(page.getByRole('radio', { name: 'Month' })).toBeChecked();
  await indicator(page, 'Alpha Hub').hover();
  await expect(page.getByRole('tooltip')).toHaveText('ReconnectingShowing last saved data');
  // 受信が止まった原因は閲覧用APIに含めない。
  const overview = await (await request.get('/api/overview')).json();
  expect(overview.hubs.find((hub: { hubId: string }) => hub.hubId === 'alpha')).toEqual({
    hubId: 'alpha',
    name: 'Alpha Hub',
    connected: false,
    receivedAt: before,
    updatedAt: saved.updatedAt,
  });

  // 再接続した接続で新しい状態を受け取り、保存する。
  await expect.poll(() => receivedAt(db, 'alpha'), { timeout: 15_000 }).not.toBe(before);

  // Assert: 目印が外れ、最新の保存状態を表示する。期間の選択は変わらない。
  await expect(indicator(page, 'Alpha Hub')).toHaveCount(0);
  await expectPeriod(page, { alpha: next, beta: beta.stats }, 'month');
  await expect(hubRow(page, 'Alpha Hub')).toContainText(
    `Received ${localTime(receivedAt(db, 'alpha')!)} · Updated ${localTime(next.updatedAt)}`,
  );
  await expect(page.getByRole('radio', { name: 'Month' })).toBeChecked();
});
