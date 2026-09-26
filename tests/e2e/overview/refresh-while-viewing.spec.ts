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
  await waitReceived(db);
  await page.goto('/');
  await page.getByText('Month', { exact: true }).click();
  const limits = page.getByRole('region', { name: 'Usage limits' });
  await limits.getByText('Beta Hub', { exact: true }).click();
  await expectPeriod(page, { alpha: alpha.stats, beta: beta.stats }, 'month');
  const interrupted = await watchInterruption(page);
  const before = receivedAt(db, 'alpha');
  const next = advance(alpha.stats);

  // Act: 利用者は操作せず、Hubが新しい状態を送って保存される。
  alpha.send('stats', next);
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

  // Act & Assert: 更新後に利用枠のHubを切り替えると、読み直した値を表示する。
  await limits.getByText('Alpha Hub', { exact: true }).click();
  await expect(limits).toContainText('70%Session');
  await expect(page.getByRole('radio', { name: 'Month' })).toBeChecked();
});

test('OVR-2 通知の接続が切れて再接続すると、その時点の保存状態で表示し直す', async ({
  page,
  app,
  alpha,
  beta,
}) => {
  // Arrange: 最初の接続は ready だけを送って切れる。再接続は保存が終わるまで待たせてから本物へ通す。
  const db = app.databasePath;
  await waitReceived(db);
  let subscriptions = 0;
  let reconnect!: () => void;
  const reconnected = new Promise<void>((resolve) => (reconnect = resolve));
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
  await expectPeriod(page, { alpha: alpha.stats, beta: beta.stats }, 'today');
  await expect.poll(() => subscriptions).toBe(2);
  const before = receivedAt(db, 'alpha');
  const next = advance(alpha.stats);

  // Act: 接続が切れている間に保存され、その後に再接続する。
  alpha.send('stats', next);
  await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);
  reconnect();

  // Assert
  await expectPeriod(page, { alpha: next, beta: beta.stats }, 'today');
});
