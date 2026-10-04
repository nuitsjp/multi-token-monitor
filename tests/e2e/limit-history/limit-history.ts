import { DatabaseSync } from 'node:sqlite';
import { test as base, expect } from '../fixtures.ts';
import { createStats, startFakeHub, type FakeHub, type FakeStats } from '../hub-sync/fake-hub.ts';
import { query, receivedAt } from '../hub-sync/sync.ts';

// 月換算上限額の日次記録のE2Eで共有する偽Hubと、DBの読み書き。
// 枠は約1か月（43,200分）の長さにし、月換算上限額が推定上限額と同じ値になるようにする。
// 推定上限額は「コストの増加 ÷ 使用率の増加 × 100」。最初の受信を1つ目の計測点にし、send で2つ目を送る。

const MINUTE = 60_000;

export interface Contract {
  provider: string;
  accountKey: string;
  accountLabel: string;
  /** 枠のラベル。末尾の枠名を除いた部分が枠グループになる。 */
  windows: string[];
}

/** 偽Hubが報告する契約。初期の残量はすべて90%。 */
export const contracts: Contract[] = [
  { provider: 'claude', accountKey: 'claude-a', accountLabel: 'Max 20x', windows: ['monthly'] },
  {
    provider: 'codex',
    accountKey: 'codex-b',
    accountLabel: 'Pro 20x',
    windows: ['monthly', 'GPT-5.3-Codex-Spark monthly'],
  },
  { provider: 'grok', accountKey: 'grok-c', accountLabel: 'SuperGrok', windows: ['monthly'] },
];

export const PRODUCT = {
  claude: 'alpha/claude/claude-a/',
  codex: 'alpha/codex/codex-b/',
  spark: 'alpha/codex/codex-b/GPT-5.3-Codex-Spark',
  grok: 'alpha/grok/grok-c/',
  // 報告されなくなった契約。過去の記録だけが残る。
  retired: 'alpha/codex/codex-old/',
} as const;

function limitWindow(label: string, remaining: number) {
  return {
    kind: 'billing',
    label,
    usedPercent: 100 - remaining,
    remainingPercent: remaining,
    resetsAt: new Date(Date.now() + 120 * MINUTE).toISOString(),
    showMeter: true,
    windowMinutes: 43_200,
  };
}

/** 端末の allTime に、ツール・モデルごとの累計の推定コストを足す。 */
export function addCost(stats: FakeStats, tool: string, model: string, add: number) {
  const allTime = stats.devices[0].periods.allTime;
  allTime.clientModels[tool] = { ...allTime.clientModels[tool], [model]: 1 };
  const current = allTime.clientModelCosts[tool]?.[model] ?? 0;
  allTime.clientModelCosts[tool] = { ...allTime.clientModelCosts[tool], [model]: current + add };
}

function initialStats(): FakeStats {
  const stats = createStats(1);
  stats.limits.providers = contracts.map((contract) => ({
    provider: contract.provider,
    accountKey: contract.accountKey,
    accountLabel: contract.accountLabel,
    planLabel: '',
    windows: contract.windows.map((label) => limitWindow(label, 90)),
  }));
  addCost(stats, 'claude', 'claude-opus', 100);
  addCost(stats, 'codex', 'gpt-5.5', 100);
  addCost(stats, 'codex', 'gpt-5.3-codex-spark', 100);
  addCost(stats, 'grok', 'grok-4', 100);
  return stats;
}

/** 残量を指定した値に変え、コストを足した stats を送って、保存を待つ。 */
export async function send(
  hub: FakeHub,
  db: string,
  change: (next: FakeStats) => void,
  remaining: Record<string, number> = {},
) {
  const before = receivedAt(db, 'alpha');
  const next = structuredClone(hub.stats);
  for (const provider of next.limits.providers)
    for (const target of provider.windows) {
      const value = remaining[`${provider.accountKey}/${target.label}`];
      if (value === undefined) continue;
      target.remainingPercent = value;
      target.usedPercent = 100 - value;
    }
  change(next);
  hub.stats = next;
  hub.send('stats', next);
  await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);
}

/**
 * 全製品の推定上限額を金額にする。月換算上限額は claude $2,000、codex $1,500、Spark $500、grok $400。
 * 価格表の月額は claude・codex が200、grok は収録なし。
 */
export async function estimateAll(hub: FakeHub, db: string) {
  await send(
    hub,
    db,
    (next) => {
      addCost(next, 'claude', 'claude-opus', 200);
      addCost(next, 'codex', 'gpt-5.5', 150);
      addCost(next, 'codex', 'gpt-5.3-codex-spark', 100);
      addCost(next, 'grok', 'grok-4', 40);
    },
    {
      'claude-a/monthly': 80,
      'codex-b/monthly': 80,
      'codex-b/GPT-5.3-Codex-Spark monthly': 70,
      'grok-c/monthly': 80,
    },
  );
}

export const test = base.extend<{ alpha: FakeHub }>({
  // eslint-disable-next-line no-empty-pattern -- Playwrightは依存のないfixtureにも分割代入を要求する
  alpha: async ({}, use) => {
    const hub = await startFakeHub('alpha-secret-token', initialStats());
    await use(hub);
    await hub.close();
  },
  hubs: async ({ alpha }, use) => {
    await use([{ id: 'alpha', name: 'Alpha Hub', url: alpha.url, token: alpha.token }]);
  },
});

export interface RecordRow {
  hub_id: string;
  provider: string;
  account_key: string;
  limit_group: string;
  date: string;
  plan: string | null;
  monthly_limit_usd: number;
  price_usd: number | null;
  recorded_at: string;
}

export const records = (db: string) =>
  query<RecordRow>(
    db,
    'SELECT * FROM daily_monthly_limits ORDER BY provider, account_key, limit_group, date',
  );

/** アプリを動かしているPCの現地日付から、days日前の日付（YYYY-MM-DD）。 */
export function localDate(days = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 過去の日の記録を直接書き込む。日次記録は1日1行なので、過去の日は同期では作れない。 */
export function insertRecords(
  db: string,
  rows: {
    key: keyof typeof PRODUCT;
    days: number;
    plan: string;
    monthly: number;
    price: number | null;
  }[],
) {
  const database = new DatabaseSync(db, { timeout: 5000 });
  try {
    const insert = database.prepare(
      `INSERT INTO daily_monthly_limits
         (hub_id, provider, account_key, limit_group, date, plan, monthly_limit_usd, price_usd, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      const [hub, provider, account, group] = PRODUCT[row.key].split('/');
      insert.run(
        hub,
        provider,
        account,
        group,
        localDate(row.days),
        row.plan,
        row.monthly,
        row.price,
        new Date(Date.now() - row.days * 86_400_000).toISOString(),
      );
    }
  } finally {
    database.close();
  }
}

/** 価格表の行を直接書き換える。起動時の同梱一覧の適用を確かめるため、停止中に使う。 */
export function execute(db: string, sql: string, ...params: (string | number)[]) {
  const database = new DatabaseSync(db, { timeout: 5000 });
  try {
    database.prepare(sql).run(...params);
  } finally {
    database.close();
  }
}

export { expect, query, receivedAt };
