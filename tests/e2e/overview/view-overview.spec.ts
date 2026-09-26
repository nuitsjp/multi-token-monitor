import {
  dumpDatabase,
  expect,
  expectPeriod,
  localTime,
  periodLabels,
  receivedAt,
  test,
  TIME_ZONE,
  waitReceived,
} from './overview.ts';
import { PERIODS, recalculateTotals } from '../hub-sync/fake-hub.ts';

// 主成功シナリオ「保存済みの最新利用状況を1画面で見る」と、ユースケース共通の受け入れ条件を検証する。

test.use({ timezoneId: TIME_ZONE });

test('OVW-1 全Hubを表示し、期間の切り替えで合計・Hub別・内訳を切り替える', async ({
  page,
  app,
  alpha,
  beta,
}) => {
  // Arrange
  const db = app.databasePath;
  await waitReceived(db);
  const stats = { alpha: alpha.stats, beta: beta.stats };

  // Act
  await page.goto('/');

  // Assert: 初期表示は Today。未受信のHubも含めて全Hubを表示する。
  await expectPeriod(page, stats, 'today');
  const byHub = page.getByRole('region', { name: 'By hub' });
  await expect(byHub.locator('[aria-label="Offline Hub"]')).toContainText('Not received');
  // 時刻はブラウザーのローカル時刻で表示する。
  await expect(byHub.locator('[aria-label="Alpha Hub"]')).toContainText(
    `Received ${localTime(receivedAt(db, 'alpha')!)} · Updated ${localTime(alpha.stats.updatedAt)}`,
  );
  await expect(page.getByRole('region', { name: 'Total' })).toContainText('Hubs2 / 3received');
  await expect(page.getByRole('region', { name: 'Total' })).toContainText('Devices61 stale');

  // 端末は全Hub分を表示し、鮮度切れに目印を付ける。
  const devices = page.getByRole('region', { name: 'Devices' });
  const staleDevice = alpha.stats.devices[1];
  await expect(devices.getByRole('row')).toHaveCount(7);
  await expect(devices.getByRole('row', { name: new RegExp(staleDevice.hostname) })).toContainText(
    `Alpha Hub${localTime(staleDevice.updatedAt)}Stale`,
  );

  // Act & Assert: 期間を切り替えると、合計・Hub別・内訳が選択した期間の値になる。
  for (const name of ['month', 'allTime'] as const) {
    await page.getByText(periodLabels[name], { exact: true }).click();
    await expectPeriod(page, stats, name);
  }
});

test('OVW-2 利用枠はHubを切り替えて、そのHubが報告した枠だけを表示する', async ({ page, app }) => {
  // Arrange
  await waitReceived(app.databasePath);
  await page.goto('/');
  const limits = page.getByRole('region', { name: 'Usage limits' });
  await page.getByText('Month', { exact: true }).click();

  // Assert: 初期表示は一覧の先頭のHub。メーターを表示しない枠（Credits）は出さない。
  await expect(limits.getByRole('radio', { name: 'Alpha Hub' })).toBeChecked();
  await expect(limits).toContainText('codexAccount 1 · Pro');
  await expect(limits).toContainText('90%Session');
  await expect(limits).toContainText('60%Weekly');
  await expect(limits).not.toContainText('Credits');
  await expect(limits).not.toContainText('Account 2');

  // Act & Assert: Hubを切り替えると、そのHubの枠に変わり、期間の選択は変えない。
  await limits.getByText('Beta Hub', { exact: true }).click();
  await expect(limits).toContainText('codexAccount 2 · Pro');
  await expect(limits).not.toContainText('Account 1');
  await expect(page.getByRole('radio', { name: 'Month' })).toBeChecked();

  await limits.getByText('Offline Hub', { exact: true }).click();
  await expect(limits).toContainText('No limits');
});

test('OVW-3 再読み込みで最新の保存状態を表示する', async ({ page, app, alpha, beta }) => {
  // Arrange
  const db = app.databasePath;
  await waitReceived(db);
  await page.goto('/');
  await page.getByText('All time', { exact: true }).click();
  await expectPeriod(page, { alpha: alpha.stats, beta: beta.stats }, 'allTime');
  const before = receivedAt(db, 'alpha');
  const next = structuredClone(alpha.stats);
  for (const name of PERIODS) next.devices[0].periods[name].clientModels.codex['gpt-5'] += 5000;
  recalculateTotals(next, Date.now());

  // Act: 表示中にHubが新しい状態を送り、保存される。
  alpha.send('stats', next);
  await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);

  // Assert: 表示中の画面は変更通知を受けて最新の保存状態になる。
  await expectPeriod(page, { alpha: next, beta: beta.stats }, 'allTime');

  // Act & Assert: 再読み込みで最新の保存状態を Today から表示する。
  await page.reload();
  await expectPeriod(page, { alpha: next, beta: beta.stats }, 'today');
  await page.getByText('All time', { exact: true }).click();
  await expectPeriod(page, { alpha: next, beta: beta.stats }, 'allTime');
});

test('OVW-4 閲覧はURLと認証トークンを含まず、保存済みの状態を変更しない', async ({
  page,
  app,
  alpha,
  beta,
}) => {
  // Arrange
  const db = app.databasePath;
  await waitReceived(db);
  const before = dumpDatabase(db);

  // Act
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Total' })).toBeVisible();
  const response = await page.request.get('/api/overview');

  // Assert
  expect(response.status()).toBe(200);
  const body = await response.text();
  const html = await page.content();
  for (const secret of [
    alpha.url,
    beta.url,
    new URL(alpha.url).host,
    new URL(beta.url).host,
    '127.0.0.1:9',
    alpha.token,
    beta.token,
    'offline-token',
  ]) {
    expect(body).not.toContain(secret);
    expect(html).not.toContain(secret);
  }
  expect(dumpDatabase(db)).toBe(before);
});
