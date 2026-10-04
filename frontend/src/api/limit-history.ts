import { dateKey } from '../hub-usage.ts';

// 製品は Hub × 契約 × 枠グループ。group は契約の枠グループが1つなら null。並びは Hub の登録順、契約の順、枠グループの順。
export type LimitHistoryProduct = {
  key: string;
  hubId: string;
  hubName: string;
  provider: string;
  plan: string | null;
  group: string | null;
};
// 1日1行。その日に最後に求まった月換算上限額と、その時点の支払額（価格表に無ければ null）。
export type LimitHistoryDay = {
  productKey: string;
  date: string;
  monthlyLimitUsd: number;
  priceUsd: number | null;
};
export type LimitHistoryData = {
  today: string;
  products: LimitHistoryProduct[];
  days: LimitHistoryDay[];
};

// 動作合意用の固定データ（段階4で GET /api/limit-history に置き換える）。
const products: (LimitHistoryProduct & {
  since: number;
  priceUsd: number | null;
  value: (day: number) => number;
  skip?: (day: number) => boolean;
})[] = [
  {
    key: 'personal/claude/a/',
    hubId: 'personal',
    hubName: 'Personal',
    provider: 'claude',
    plan: 'Max 20x',
    group: null,
    since: 110,
    priceUsd: 200,
    value: (day) => 2400 + 180 * Math.sin(day / 9) + day * 2,
  },
  {
    key: 'personal/codex/b/',
    hubId: 'personal',
    hubName: 'Personal',
    provider: 'codex',
    plan: 'Pro 20x',
    group: '',
    since: 110,
    priceUsd: 200,
    value: (day) => 1600 + 120 * Math.sin(day / 6 + 1) - day * 1.5,
  },
  {
    key: 'personal/codex/b/GPT-5.3-Codex-Spark',
    hubId: 'personal',
    hubName: 'Personal',
    provider: 'codex',
    plan: 'Pro 20x',
    group: 'GPT-5.3-Codex-Spark',
    since: 110,
    priceUsd: 200,
    value: (day) => 650 + 40 * Math.sin(day / 5),
  },
  {
    key: 'work/claude/c/',
    hubId: 'work',
    hubName: 'Work',
    provider: 'claude',
    plan: 'Team',
    group: null,
    since: 110,
    priceUsd: null,
    value: (day) => 310 + 25 * Math.sin(day / 7),
    skip: (day) => day % 13 === 4,
  },
  {
    key: 'work/copilot/d/',
    hubId: 'work',
    hubName: 'Work',
    provider: 'copilot',
    plan: 'Pro',
    group: null,
    since: 45,
    priceUsd: 10,
    value: (day) => 48 + 4 * Math.sin(day / 4),
  },
];

function fixedLimitHistory(): LimitHistoryData {
  const now = new Date();
  const today = dateKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const days: LimitHistoryDay[] = [];
  for (const product of products)
    for (let day = 0; day <= product.since; day++) {
      if (product.skip?.(day)) continue;
      const date = new Date(`${today}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - (product.since - day));
      days.push({
        productKey: product.key,
        date: dateKey(date),
        monthlyLimitUsd: Math.round(product.value(day) * 100) / 100,
        priceUsd: product.priceUsd,
      });
    }
  return {
    today,
    products: products.map(({ key, hubId, hubName, provider, plan, group }) => ({
      key,
      hubId,
      hubName,
      provider,
      plan,
      group,
    })),
    days,
  };
}

export async function fetchLimitHistory(): Promise<LimitHistoryData> {
  return Promise.resolve(fixedLimitHistory());
}
