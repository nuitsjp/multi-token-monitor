import type { Overview } from './api/overview.ts';

export type LimitWindow = Overview['limitWindows'][number];

// 枠の長さ（分）。Hubが windowMinutes を送らない枠だけ、この表から補う。新しい kind はここへ追加する。
const kindMinutes: Record<string, number> = {
  session: 300,
  daily: 1440,
  weekly: 10080,
  billing: 43200,
};

// 枠グループは、ラベルから末尾の枠名を除いた部分。除いて空なら契約全体で1グループ。
const windowWord = /\s*\b(5-hour|5h|session|weekly|daily|monthly)$/i;

export const groupOf = (window: LimitWindow) => (window.label ?? '').replace(windowWord, '').trim();

export const lengthOf = (window: LimitWindow): number | null =>
  window.windowMinutes ?? kindMinutes[window.kind] ?? null;

const DAY = 1440;

export function windowLabel(window: LimitWindow): string {
  const minutes = lengthOf(window);
  if (minutes === null) return window.kind;
  if (minutes >= 28 * DAY && minutes <= 31 * DAY) return '1mo';
  if (minutes < DAY) return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
  return `${Math.round(minutes / DAY)}d`;
}

// リセットまでの残り時間。1日未満は Xh Ym（1時間未満は Ym）、1日以上は Xd Yh。
export function remainingText(resetsAt: string | null, now: number): string {
  if (resetsAt === null) return '—';
  const minutes = Math.max(0, Math.floor((Date.parse(resetsAt) - now) / 60000));
  if (minutes >= DAY) return `${Math.floor(minutes / DAY)}d ${Math.floor((minutes % DAY) / 60)}h`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}

export type Pace = 'normal' | 'caution' | 'danger';

// ペース = 残量 ÷ 理想の残量。理想の残量 = 残り時間 ÷ 枠の長さ。判定できない枠は normal（紫のまま）。
export function paceOf(window: LimitWindow, now: number): Pace {
  const length = lengthOf(window);
  if (length === null || window.resetsAt === null) return 'normal';
  const ideal = Math.min(1, Math.max(0, (Date.parse(window.resetsAt) - now) / 60000 / length));
  if (ideal === 0) return 'normal';
  const pace = window.remainingPercent / (ideal * 100);
  return pace >= 0.8 ? 'normal' : pace >= 0.5 ? 'caution' : 'danger';
}

// 残量の規則: 40%超は normal、25%以上40%以下は caution、25%未満は danger。
export function remainingStateOf(window: LimitWindow): Pace {
  const remaining = window.remainingPercent;
  return remaining > 40 ? 'normal' : remaining >= 25 ? 'caution' : 'danger';
}

const severity: Record<Pace, number> = { normal: 0, caution: 1, danger: 2 };

// 円弧の色の状態 = ペースの規則と残量の規則のうち悪い方。
export function stateOf(window: LimitWindow, now: number): Pace {
  const pace = paceOf(window, now);
  const remaining = remainingStateOf(window);
  return severity[pace] >= severity[remaining] ? pace : remaining;
}

// monthlyUsd は枠グループの月換算上限額。契約の枠グループが複数のとき、グループの先頭の円だけが持つ（2つ目以降の円と、グループが1つの契約は null）。
export type LimitCircle = {
  key: string;
  group: string;
  windows: LimitWindow[];
  monthlyUsd: number | null;
};
// monthlyUsd は契約の月換算上限額（枠グループの月換算上限額の合計。パネルの見出し行に示す）。どのグループも値を持たなければ null。
// monthlyLowerBound は、値を持たない枠グループがあり、monthlyUsd が下限値であること。
export type LimitAccount = {
  key: string;
  provider: string;
  accountLabel: string | null;
  planLabel: string | null;
  circles: LimitCircle[];
  monthlyUsd: number | null;
  monthlyLowerBound: boolean;
};

// 契約ごとに枠グループを作り、グループ内を長さの短い順（不明は最後）に並べて2枠ずつ円に詰める。
export function buildAccounts(windows: LimitWindow[]): LimitAccount[] {
  const accounts = new Map<string, { account: LimitAccount; groups: Map<string, LimitWindow[]> }>();
  for (const window of windows) {
    const key = `${window.provider}/${window.accountKey}`;
    let entry = accounts.get(key);
    if (entry === undefined) {
      entry = {
        account: {
          key,
          provider: window.provider,
          accountLabel: window.accountLabel,
          planLabel: window.planLabel,
          circles: [],
          monthlyUsd: null,
          monthlyLowerBound: false,
        },
        groups: new Map(),
      };
      accounts.set(key, entry);
    }
    const group = groupOf(window);
    entry.groups.set(group, [...(entry.groups.get(group) ?? []), window]);
  }
  return [...accounts.values()].map(({ account, groups }) => {
    const single = groups.size === 1;
    for (const [group, members] of groups) {
      const sorted = [...members].sort(
        (a, b) => (lengthOf(a) ?? Infinity) - (lengthOf(b) ?? Infinity),
      );
      const monthlyUsd = monthlyLimitUsd(sorted);
      if (monthlyUsd === null) account.monthlyLowerBound = true;
      else account.monthlyUsd = (account.monthlyUsd ?? 0) + monthlyUsd;
      for (let index = 0; index < sorted.length; index += 2)
        account.circles.push({
          key: `${group}/${index}`,
          group,
          windows: sorted.slice(index, index + 2),
          monthlyUsd: !single && index === 0 ? monthlyUsd : null,
        });
    }
    if (account.monthlyUsd === null) account.monthlyLowerBound = false;
    return account;
  });
}

const MONTH = 31 * DAY;

// 推定上限額が金額の各枠を31日に比例換算し、最小値を採用する。約1か月の枠はそのまま。候補がなければ null。
export function monthlyLimitUsd(windows: LimitWindow[]): number | null {
  let minimum: number | null = null;
  for (const window of windows) {
    const minutes = lengthOf(window);
    if (minutes === null || window.estimatedLimitUsd === null) continue;
    const monthly =
      minutes >= 28 * DAY && minutes <= 31 * DAY
        ? window.estimatedLimitUsd
        : (window.estimatedLimitUsd / minutes) * MONTH;
    minimum = minimum === null ? monthly : Math.min(minimum, monthly);
  }
  return minimum;
}
