import {
  addCost,
  estimateAll,
  execute,
  expect,
  insertRecords,
  localDate,
  query,
  receivedAt,
  records,
  send,
  test,
} from './limit-history.ts';

// 主成功シナリオ「設定したHubの最新状態を受信して保存する」のうち、月換算上限額の日次記録と価格表の適用を検証する。
// 偽Hubから本番の受信・保存処理でDBに状態を作り、保存処理とは別の読み取り専用接続で照合する。

const today = localDate();
const row = (db: string, provider: string, group = '', date = today) =>
  records(db).find(
    (item) => item.provider === provider && item.limit_group === group && item.date === date,
  );
const price = (db: string, provider: string, plan: string) =>
  query<{ monthly_usd: number; updated_at: string }>(
    db,
    'SELECT monthly_usd, updated_at FROM plan_prices WHERE provider = ? AND plan = ?',
    provider,
    plan,
  )[0];

test('REC-1 同じ日の受信では枠グループごとの当日の行を1つだけ持ち、最後に求まった値と、その時点の支払額を記録する', async ({
  app,
  alpha,
}) => {
  const db = app.databasePath;
  await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
  // 最初の受信は1つ目の計測点だけで、どの枠グループも月換算上限額が求まらないため、行を作らない。
  expect(records(db)).toEqual([]);

  await estimateAll(alpha, db);
  expect(
    records(db).map((item) => [
      item.provider,
      item.limit_group,
      item.date,
      item.plan,
      Math.round(item.monthly_limit_usd * 100) / 100,
      item.price_usd,
    ]),
  ).toEqual([
    ['claude', '', today, 'Max 20x', 2000, 200],
    ['codex', '', today, 'Pro 20x', 1500, 200],
    ['codex', 'GPT-5.3-Codex-Spark', today, 'Pro 20x', 500, 200],
    // 価格表にプランが無い契約の枠グループは、支払額を空にする。
    ['grok', '', today, 'SuperGrok', 400, null],
  ]);
  const firstRecordedAt = row(db, 'claude')!.recorded_at;

  // 同じ日にもう一度求まると、当日の行を上書きする。プラン名は大文字・小文字を区別せずに価格表から引く。
  await send(
    alpha,
    db,
    (next) => {
      addCost(next, 'claude', 'claude-opus', 400);
      next.limits.providers.find((item) => item.provider === 'codex')!.accountLabel = 'PRO 20X';
    },
    { 'claude-a/monthly': 75 },
  );
  expect(records(db)).toHaveLength(4);
  expect(row(db, 'claude')!.monthly_limit_usd).toBeCloseTo(4000, 6);
  expect(row(db, 'claude')!.price_usd).toBe(200);
  expect(row(db, 'claude')!.recorded_at > firstRecordedAt).toBe(true);
  expect(row(db, 'codex')).toMatchObject({ plan: 'PRO 20X', price_usd: 200 });
  expect(row(db, 'codex')!.monthly_limit_usd).toBeCloseTo(1500, 6);
});

test('REC-2 月換算上限額が求まらない受信と freshness では、当日の既存の行を消さず値も変えない', async ({
  app,
  alpha,
}) => {
  const db = app.databasePath;
  await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
  await estimateAll(alpha, db);
  const before = records(db);

  // 使用率が減ると1つ目の計測点を取り直し、claude は Estimating に戻る。
  await send(alpha, db, () => {}, { 'claude-a/monthly': 95 });
  const overview = (await (await fetch(`${app.url}/api/overview`)).json()) as {
    limitWindows: { provider: string; estimate: string }[];
  };
  expect(overview.limitWindows.find((item) => item.provider === 'claude')!.estimate).toBe(
    'estimating',
  );
  const claudeBefore = before.find((item) => item.provider === 'claude');
  expect(row(db, 'claude')).toEqual(claudeBefore);

  const statsAt = receivedAt(db, 'alpha');
  const freshAt = new Date().toISOString();
  alpha.send('freshness', {
    updatedAt: freshAt,
    staleAfterMs: 123_456,
    limits: { updatedAt: freshAt },
    devices: [],
  });
  await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(statsAt);
  const afterFreshness = records(db);
  expect(afterFreshness.find((item) => item.provider === 'claude')).toEqual(claudeBefore);
  expect(afterFreshness).toHaveLength(4);
});

test('REC-3 起動時に同梱の価格一覧を新しい方だけ適用し、記録済みの過去の行は価格表が変わっても変えない', async ({
  app,
  alpha,
}) => {
  const db = app.databasePath;
  await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
  // 同梱の価格一覧は、起動時に価格表へ入っている。
  expect(price(db, 'claude', 'Max 20x')).toEqual({
    monthly_usd: 200,
    updated_at: '2026-10-04T00:00:00Z',
  });
  expect(query<{ count: number }>(db, 'SELECT COUNT(*) AS count FROM plan_prices')[0].count).toBe(
    42,
  );
  await estimateAll(alpha, db);

  await app.stop();
  // 価格表の方が新しい行、古い行、無い行と、前日の記録を用意する。
  execute(
    db,
    "UPDATE plan_prices SET monthly_usd = 400, updated_at = '2099-01-01T00:00:00Z' WHERE provider = 'claude' AND plan = 'Max 20x'",
  );
  execute(
    db,
    "UPDATE plan_prices SET monthly_usd = 1, updated_at = '2000-01-01T00:00:00Z' WHERE provider = 'codex' AND plan = 'Pro 20x'",
  );
  execute(db, "DELETE FROM plan_prices WHERE provider = 'copilot' AND plan = 'Pro'");
  insertRecords(db, [{ key: 'claude', days: 1, plan: 'Max 20x', monthly: 1234, price: 100 }]);
  const yesterday = row(db, 'claude', '', localDate(1));
  const stoppedAt = receivedAt(db, 'alpha');

  await app.start();
  expect(price(db, 'claude', 'Max 20x')).toEqual({
    monthly_usd: 400,
    updated_at: '2099-01-01T00:00:00Z',
  });
  expect(price(db, 'codex', 'Pro 20x')).toEqual({
    monthly_usd: 200,
    updated_at: '2026-10-04T00:00:00Z',
  });
  expect(price(db, 'copilot', 'Pro')).toEqual({
    monthly_usd: 10,
    updated_at: '2026-10-04T00:00:00Z',
  });

  // 再接続後の受信では、当日の行だけをその時点の価格で書き直し、前日の行は変えない。
  await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(stoppedAt);
  await expect.poll(() => row(db, 'claude')?.price_usd).toBe(400);
  expect(row(db, 'claude')!.monthly_limit_usd).toBeCloseTo(2000, 6);
  expect(row(db, 'codex')!.price_usd).toBe(200);
  expect(row(db, 'claude', '', localDate(1))).toEqual(yesterday);
});
