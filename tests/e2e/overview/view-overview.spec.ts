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

test('OVW-1 全Hubへ到達でき、期間の切り替えで合計・Hub別・内訳を切り替える', async ({
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

  // Assert: 初期表示は Today の先頭ページ。合計はトークン数と推定コストだけで、Hubは2件見える。
  await expectPeriod(page, stats, 'today');
  const total = page.getByRole('region', { name: 'Total' });
  await expect(total).not.toContainText('Hubs');
  await expect(total).not.toContainText('Devices');
  const byHub = page.getByRole('region', { name: 'By hub' });
  const hubPage = page.getByLabel('Hub page');
  await expect(byHub.locator('.hub-slot[aria-label]')).toHaveCount(2);
  await expect(byHub.locator('.hub-slot[aria-hidden]')).toHaveCount(0);
  await expect(byHub.locator('[aria-label="Offline Hub"]')).toHaveCount(0);

  // Act: 次のページへ送る。
  await hubPage.getByRole('button', { name: '2', exact: true }).click();

  // Assert: 未受信のHubと空の2件目だけが見え、期間は変わらない。空枠はHub行と同じ高さを保つ。
  await expect(byHub.locator('[aria-label="Offline Hub"]')).toContainText('Not received');
  await expect(byHub.locator('.hub-slot[aria-label]')).toHaveCount(1);
  await expect(byHub.locator('[aria-label="Alpha Hub"]')).toHaveCount(0);
  const slotHeight = await byHub
    .locator('.hub-slot')
    .evaluateAll((slots) => slots.map((slot) => getComputedStyle(slot).minHeight));
  expect(slotHeight).toEqual(['52px', '52px']);
  await expect(page.getByRole('radio', { name: 'Today' })).toBeChecked();

  // Act & Assert: 期間を切り替えてもHubのページは維持する。
  await page.getByText('Month', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Month' })).toBeChecked();
  await expect(byHub.locator('[aria-label="Offline Hub"]')).toBeVisible();
  await expect(byHub.locator('[aria-label="Alpha Hub"]')).toHaveCount(0);

  // Act & Assert: 再読み込みで Today の先頭ページに戻る。
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Today' })).toBeChecked();
  await expect(byHub.locator('[aria-label="Alpha Hub"]')).toBeVisible();
  await expect(byHub.locator('[aria-label="Beta Hub"]')).toBeVisible();
  await expect(byHub.locator('[aria-label="Offline Hub"]')).toHaveCount(0);
  // 時刻はブラウザーのローカル時刻で表示する。
  await expect(byHub.locator('[aria-label="Alpha Hub"]')).toContainText(
    `Received ${localTime(receivedAt(db, 'alpha')!)} · Updated ${localTime(alpha.stats.updatedAt)}`,
  );

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
  await expect(limits.getByLabel('codex · Account 1 · Pro', { exact: true })).toBeVisible();
  await expect(limits).toContainText('90% 5h');
  await expect(limits).toContainText('60% 7d');
  await expect(limits).not.toContainText('Credits');
  await expect(limits.getByLabel('codex · Account 2 · Pro', { exact: true })).toHaveCount(0);

  // Act & Assert: Hubを切り替えると、そのHubの枠に変わり、期間の選択は変えない。
  await limits.getByText('Beta Hub', { exact: true }).click();
  await expect(limits.getByLabel('codex · Account 2 · Pro', { exact: true })).toBeVisible();
  await expect(limits.getByLabel('codex · Account 1 · Pro', { exact: true })).toHaveCount(0);
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
  refusing,
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
    refusing.url,
    new URL(refusing.url).host,
    alpha.token,
    beta.token,
    'offline-token',
  ]) {
    expect(body).not.toContain(secret);
    expect(html).not.toContain(secret);
  }
  expect(dumpDatabase(db)).toBe(before);
});

test('OVW-9 推定上限額は2つの計測点から求め、条件を満たさない枠は Estimating と表示する', async ({
  page,
  app,
  alpha,
  beta,
}) => {
  // Arrange
  const db = app.databasePath;
  await waitReceived(db);
  await page.goto('/');
  const limits = page.getByRole('region', { name: 'Usage limits' });
  // 残量とコストの増加を指定して、Hubに stats を送らせる。
  const send = async (
    hub: typeof alpha,
    hubId: string,
    remaining: number,
    cost: number,
  ): Promise<void> => {
    const before = receivedAt(db, hubId);
    const next = structuredClone(hub.stats);
    const session = next.limits.providers[0].windows[0];
    session.remainingPercent = remaining;
    session.usedPercent = 100 - remaining;
    next.devices[0].periods.allTime.clientModelCosts.codex['gpt-5'] += cost;
    hub.stats = next;
    hub.send('stats', next);
    await expect.poll(() => receivedAt(db, hubId)).not.toBe(before);
  };

  // Assert: 受信が1回だけの枠は、計測点が1つなので推定しない。
  await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(2);

  // Act & Assert: 使用率の増加が1ポイント未満なら推定しない。
  await send(alpha, 'alpha', 89.4, 1.5);
  await expect(limits).toContainText('89% 5h');
  await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(2);

  // Act & Assert: 1ポイント以上増えたら、コストの増加 ÷ 使用率の増加 × 100 を表示する。
  // 残量が変わらない Weekly は推定しない。
  await send(alpha, 'alpha', 89, 0.5);
  await expect(limits.getByText('$200.00', { exact: true })).toBeVisible();
  await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(1);

  // Act & Assert: 使用率が1ポイント以上増えても、コストが増えていなければ推定しない。
  await send(beta, 'beta', 80, 0);
  await limits.getByText('Beta Hub', { exact: true }).click();
  await expect(limits).toContainText('80% 5h');
  await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(2);
});

const twoHubs = test.extend({
  hubs: async ({ alpha, beta }, use) => {
    await use([
      { id: 'alpha', name: 'Alpha Hub', url: alpha.url, token: alpha.token },
      { id: 'beta', name: 'Beta Hub', url: beta.url, token: beta.token },
    ]);
  },
});

twoHubs('OVW-10 Hubが2件のときはページを送らず、両方を表示する', async ({ page, app }) => {
  // Arrange
  const db = app.databasePath;
  await expect
    .poll(() => [receivedAt(db, 'alpha'), receivedAt(db, 'beta')].every(Boolean))
    .toBe(true);

  // Act
  await page.goto('/');

  // Assert
  const byHub = page.getByRole('region', { name: 'By hub' });
  await expect(page.getByRole('radio', { name: 'Today' })).toBeChecked();
  await expect(page.getByLabel('Hub page')).toHaveCount(0);
  await expect(byHub.locator('[aria-label="Alpha Hub"]')).toBeVisible();
  await expect(byHub.locator('[aria-label="Beta Hub"]')).toBeVisible();
  await expect(byHub.locator('.hub-slot[aria-hidden]')).toHaveCount(0);
});

const oneHub = test.extend({
  hubs: async ({ alpha }, use) => {
    await use([{ id: 'alpha', name: 'Alpha Hub', url: alpha.url, token: alpha.token }]);
  },
});

oneHub('OVW-11 Hubが1件のときはページを送らず、空の2件目で高さを保つ', async ({ page, app }) => {
  // Arrange
  const db = app.databasePath;
  await expect.poll(() => Boolean(receivedAt(db, 'alpha'))).toBe(true);

  // Act
  await page.goto('/');

  // Assert
  const byHub = page.getByRole('region', { name: 'By hub' });
  await expect(page.getByLabel('Hub page')).toHaveCount(0);
  await expect(byHub.locator('.hub-slot[aria-label]')).toHaveCount(1);
  await expect(byHub.locator('[aria-label="Alpha Hub"]')).toBeVisible();
  const slotHeight = await byHub
    .locator('.hub-slot')
    .evaluateAll((slots) => slots.map((slot) => getComputedStyle(slot).minHeight));
  expect(slotHeight).toEqual(['52px', '52px']);
});
