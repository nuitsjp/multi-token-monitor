import { DatabaseSync } from 'node:sqlite';
import type { Page } from '@playwright/test';
import { test as base, expect } from '../fixtures.ts';
import {
  createStats,
  isExpired,
  PERIODS,
  recalculateTotals,
  startFakeHub,
  type FakeHub,
  type FakeStats,
  type PeriodName,
} from '../hub-sync/fake-hub.ts';

// 閲覧のE2Eで共有する偽Hub・DB読み取り・画面の期待値。
// 偽Hubから本番の受信・保存処理でDBに状態を作り、閲覧用APIと画面から読む。

export const TIME_ZONE = 'Asia/Tokyo';
const SCALES: Record<PeriodName, number> = { today: 10, month: 100, allTime: 1000 };

/** Other への合算を確かめるため、Alphaの有効な端末にモデルを足して7モデルにする。 */
function alphaStats(): FakeStats {
  const stats = createStats(1);
  const active = stats.devices[0];
  for (const name of PERIODS) {
    const scale = SCALES[name];
    active.periods[name].clientModels.extra = {
      'model-x1': 40 * scale,
      'model-x2': 30 * scale,
      'model-x3': 24 * scale,
      'model-x4': 1 * scale,
    };
    active.periods[name].clientModelCosts.extra = { 'model-x1': 4 };
  }
  // 端末の区画で鮮度切れの目印を確かめる。
  stats.devices[1].stale = true;
  recalculateTotals(stats, Date.now());
  return stats;
}

export const test = base.extend<{ alpha: FakeHub; beta: FakeHub }>({
  // eslint-disable-next-line no-empty-pattern -- Playwrightは依存のないfixtureにも分割代入を要求する
  alpha: async ({}, use) => {
    const hub = await startFakeHub('alpha-secret-token', alphaStats());
    await use(hub);
    await hub.close();
  },
  // eslint-disable-next-line no-empty-pattern
  beta: async ({}, use) => {
    const hub = await startFakeHub('beta-secret-token', createStats(2));
    await use(hub);
    await hub.close();
  },
  hubs: async ({ alpha, beta }, use) => {
    await use([
      { id: 'alpha', name: 'Alpha Hub', url: alpha.url, token: alpha.token },
      { id: 'beta', name: 'Beta Hub', url: beta.url, token: beta.token },
      // 接続できないHub。状態を受信しないまま表示される。
      { id: 'offline', name: 'Offline Hub', url: 'http://127.0.0.1:9', token: 'offline-token' },
    ]);
  },
});

export function query<T>(databasePath: string, sql: string, ...params: string[]): T[] {
  const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

export function receivedAt(databasePath: string, hubId: string): string | undefined {
  return query<{ received_at: string }>(
    databasePath,
    'SELECT received_at FROM hub_states WHERE hub_id = ?',
    hubId,
  )[0]?.received_at;
}

export async function waitReceived(databasePath: string) {
  await expect
    .poll(() =>
      [receivedAt(databasePath, 'alpha'), receivedAt(databasePath, 'beta')].every(Boolean),
    )
    .toBe(true);
}

export function dumpDatabase(databasePath: string): string {
  const tables = query<{ name: string }>(
    databasePath,
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  );
  return JSON.stringify(
    tables.map(({ name }) => [name, query(databasePath, `SELECT * FROM "${name}" ORDER BY 1, 2`)]),
  );
}

// 画面と同じ書式。トークン数は略さず桁区切り、コストが無い値は「—」。
const tokens = (value: number) => value.toLocaleString('en-US');
const usd = (value: number | null) =>
  value === null
    ? '—'
    : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const localTime = (value: string) =>
  new Date(value).toLocaleString('ja-JP', {
    timeZone: TIME_ZONE,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

interface Usage {
  tokens: number;
  cost: number | null;
}
const addCost = (a: number | null, b: number | undefined) => (b === undefined ? a : (a ?? 0) + b);

/** 保存規則（期限切れの端末分を除く）に沿って、偽Hubの送った値から期待値を作る。 */
function expected(stats: Record<string, FakeStats>, name: PeriodName) {
  const now = Date.now();
  const hubs = new Map<string, Usage>();
  const models = new Map<string, Usage & { model: string }>();
  const total: Usage = { tokens: 0, cost: null };
  for (const [hubId, hub] of Object.entries(stats)) {
    const hubUsage: Usage = { tokens: 0, cost: null };
    for (const device of hub.devices.filter((device) => !isExpired(device, name, now))) {
      const period = device.periods[name];
      for (const [tool, values] of Object.entries(period.clientModels))
        for (const [model, count] of Object.entries(values)) {
          const cost = period.clientModelCosts[tool]?.[model];
          const row = models.get(`${tool}/${model}`) ?? { model, tokens: 0, cost: null };
          row.tokens += count;
          row.cost = addCost(row.cost, cost);
          models.set(`${tool}/${model}`, row);
          hubUsage.tokens += count;
          hubUsage.cost = addCost(hubUsage.cost, cost);
        }
    }
    hubs.set(hubId, hubUsage);
    total.tokens += hubUsage.tokens;
    total.cost = hubUsage.cost === null ? total.cost : (total.cost ?? 0) + hubUsage.cost;
  }
  const sorted = [...models.values()].sort((a, b) => b.tokens - a.tokens);
  const rest = sorted.slice(5);
  const other = rest.reduce<Usage>(
    (sum, row) => ({
      tokens: sum.tokens + row.tokens,
      cost: row.cost === null ? sum.cost : (sum.cost ?? 0) + row.cost,
    }),
    { tokens: 0, cost: null },
  );
  return { total, hubs, top: sorted.slice(0, 5), rest: rest.length, other };
}

export const periodLabels: Record<PeriodName, string> = {
  today: 'Today',
  month: 'Month',
  allTime: 'All time',
};

export async function expectPeriod(page: Page, stats: Record<string, FakeStats>, name: PeriodName) {
  const want = expected(stats, name);
  await expect(page.getByRole('radio', { name: periodLabels[name] })).toBeChecked();

  const total = page.getByRole('region', { name: 'Total' });
  await expect(total).toContainText(`Tokens${tokens(want.total.tokens)}`);
  await expect(total).toContainText(`Est. cost${usd(want.total.cost)}`);

  const byHub = page.getByRole('region', { name: 'By hub' });
  for (const [hubId, name] of [
    ['alpha', 'Alpha Hub'],
    ['beta', 'Beta Hub'],
  ] as const) {
    const usage = want.hubs.get(hubId)!;
    await expect(byHub.locator(`[aria-label="${name}"]`)).toContainText(
      `${tokens(usage.tokens)}${usd(usage.cost)}`,
    );
  }

  // 上位5件を個別に、6位以降を Other に合算する。
  const rows = page.getByRole('region', { name: 'By model' }).getByRole('row');
  await expect(rows).toHaveCount(6);
  for (const [index, row] of want.top.entries())
    await expect(rows.nth(index)).toContainText(
      new RegExp(`^${row.model}.*${tokens(row.tokens)}${usd(row.cost).replace('$', '\\$')}$`),
    );
  await expect(rows.nth(5)).toContainText(
    `Other${want.rest === 1 ? '1 model' : `${want.rest} models`}${tokens(want.other.tokens)}${usd(want.other.cost)}`,
  );
}

export { expect };
