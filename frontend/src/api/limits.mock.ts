import { dateKey } from '../hub-usage.ts';
import type { LimitHistoryContract, LimitHistoryData, LimitHistoryDay } from './limit-history.ts';
import type { Overview } from './overview.ts';

// 段階3の動作合意用の固定データ（段階4で削除する）。VITE_LIMITS_MOCK=1 のときだけ使う。

type LimitWindow = Overview['limitWindows'][number];

const HOUR = 3_600_000;
const resetIn = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

type Account = Pick<
  LimitWindow,
  'hubId' | 'provider' | 'accountKey' | 'accountLabel' | 'planLabel'
>;
const window = (
  account: Account,
  label: string,
  kind: string,
  windowMinutes: number,
  remainingPercent: number,
  resetHours: number,
  estimatedLimitUsd: number | null,
): LimitWindow => ({
  ...account,
  kind,
  limitKey: label,
  label,
  remainingPercent,
  resetsAt: resetIn(resetHours),
  estimatedLimitUsd,
  estimate: estimatedLimitUsd === null ? 'estimating' : 'estimated',
  unavailableReason: null,
  windowMinutes,
});

const antigravity: Account = {
  hubId: 'personal',
  provider: 'antigravity',
  accountKey: 'ag1',
  accountLabel: 'Pro',
  planLabel: null,
};
const claudeMax: Account = {
  hubId: 'personal',
  provider: 'claude',
  accountKey: 'a1',
  accountLabel: 'Pro',
  planLabel: null,
};
const codexPro: Account = {
  hubId: 'personal',
  provider: 'codex',
  accountKey: 'c1',
  accountLabel: 'Pro',
  planLabel: null,
};
const claudeTeam: Account = {
  hubId: 'work',
  provider: 'claude',
  accountKey: 'b2',
  accountLabel: 'Work',
  planLabel: 'Team',
};
const copilotPro: Account = {
  hubId: 'work',
  provider: 'copilot',
  accountKey: 'd1',
  accountLabel: 'Work',
  planLabel: 'Pro',
};

// 枠グループが複数で全グループに値がある契約（antigravity: $555 + $23 = $578/mo）、
// グループが1つの契約（claude Pro）、一部のグループが Estimating の契約（codex: ≥）、
// 全グループが Estimating の契約（claude Team: 金額なし）、約1か月の枠の契約（copilot）を並べる。
const limitWindows: LimitWindow[] = [
  window(antigravity, 'Gemini 5h', 'session', 300, 100, 4.98, null),
  window(antigravity, 'Gemini Weekly', 'weekly', 10_080, 75, 141, 125.33),
  window(antigravity, 'Claude/GPT Weekly', 'weekly', 10_080, 0, 133, 5.24),
  window(claudeMax, '5h', 'session', 300, 62, 2.2, 38.9),
  window(claudeMax, 'Weekly', 'weekly', 10_080, 41, 76, 310.12),
  window(codexPro, '5h', 'session', 300, 88, 3.5, 22.4),
  window(codexPro, 'Weekly', 'weekly', 10_080, 54, 98, 260),
  window(codexPro, 'GPT-5.3-Codex-Spark 5h', 'session', 300, 100, 4.6, null),
  window(codexPro, 'GPT-5.3-Codex-Spark Weekly', 'weekly', 10_080, 97, 150, null),
  window(claudeTeam, '5h', 'session', 300, 100, 4.1, null),
  window(claudeTeam, 'Weekly', 'weekly', 10_080, 90, 120, null),
  window(copilotPro, 'Monthly', 'billing', 43_200, 70, 400, 48),
];

const emptyPeriod = { total: { tokens: 0, costUsd: null }, hubs: [], models: [] };

export function overviewMock(): Overview {
  const now = new Date().toISOString();
  return {
    hubs: [
      { hubId: 'personal', name: 'Personal', connected: true, receivedAt: now, updatedAt: now },
      { hubId: 'work', name: 'Work', connected: true, receivedAt: now, updatedAt: now },
    ],
    periods: { today: emptyPeriod, month: emptyPeriod, allTime: emptyPeriod },
    limitWindows,
    devices: [],
    activity: { days: [] },
  };
}

// 推移は、合計した月換算上限額を算術生成する。lowerBound の日は記録のない枠グループがある日。
const contracts: (LimitHistoryContract & {
  since: number;
  priceUsd: number | null;
  value: (day: number) => number;
  lowerBound?: (day: number) => boolean;
  skip?: (day: number) => boolean;
})[] = [
  {
    key: 'personal/antigravity/ag1',
    hubId: 'personal',
    hubName: 'Personal',
    provider: 'antigravity',
    plan: 'Pro',
    since: 110,
    priceUsd: 19.99,
    value: (day) => 560 + 30 * Math.sin(day / 8) + (day % 9 === 3 ? -25 : 0),
    lowerBound: (day) => day % 9 === 3,
  },
  {
    key: 'personal/claude/a1',
    hubId: 'personal',
    hubName: 'Personal',
    provider: 'claude',
    plan: 'Pro',
    since: 110,
    priceUsd: 20,
    value: (day) => 1300 + 90 * Math.sin(day / 9) + day * 0.6,
  },
  {
    key: 'personal/codex/c1',
    hubId: 'personal',
    hubName: 'Personal',
    provider: 'codex',
    plan: 'Pro',
    since: 110,
    // codex の「Pro」は価格表に無いため、支払額と倍率は N/A になる。
    priceUsd: null,
    value: (day) => (day >= 108 ? 1151 : 1650 + 110 * Math.sin(day / 6 + 1)),
    lowerBound: (day) => day >= 108,
  },
  {
    key: 'work/claude/b2',
    hubId: 'work',
    hubName: 'Work',
    provider: 'claude',
    plan: 'Team',
    since: 110,
    priceUsd: null,
    value: (day) => 310 + 25 * Math.sin(day / 7),
    skip: (day) => day % 13 === 4 || day >= 109,
  },
  {
    key: 'work/copilot/d1',
    hubId: 'work',
    hubName: 'Work',
    provider: 'copilot',
    plan: 'Pro',
    since: 45,
    priceUsd: 10,
    value: (day) => 48 + 4 * Math.sin(day / 4),
  },
];

export function limitHistoryMock(): LimitHistoryData {
  const now = new Date();
  const today = dateKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const days: LimitHistoryDay[] = [];
  for (const contract of contracts)
    for (let day = 0; day <= contract.since; day++) {
      if (contract.skip?.(day)) continue;
      const date = new Date(`${today}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - (contract.since - day));
      days.push({
        contractKey: contract.key,
        date: dateKey(date),
        monthlyLimitUsd: Math.round(contract.value(day) * 100) / 100,
        priceUsd: contract.priceUsd,
        lowerBound: contract.lowerBound?.(day) ?? false,
      });
    }
  return {
    today,
    contracts: contracts.map(({ key, hubId, hubName, provider, plan }) => ({
      key,
      hubId,
      hubName,
      provider,
      plan,
    })),
    days,
  };
}
