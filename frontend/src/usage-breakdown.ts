import type { HubUsageData, HubUsageDay, HubUsageHub } from './api/hub-usage.ts';
import { bucketKey, bucketLabel, dateKey, sumCosts, type AggregationUnit } from './hub-usage.ts';

export const seriesPalette = [
  '#9789c7',
  '#6b9eac',
  '#bf966b',
  '#83a584',
  '#b97d94',
  '#c7b26b',
  '#6bbfa7',
  '#7d8fc7',
];
export const otherColor = '#626572';

export type UsageIdentity = { key: string; name: string; detail: string | null };
export type UsageItem = UsageIdentity & {
  color: string;
  tokens: number;
  costUsd: number | null;
  share: number;
  trend: number[];
};
export type UsageAggregate = {
  items: UsageItem[];
  buckets: { key: string; label: string; tokens: (number | null)[]; costs: (number | null)[] }[];
};

export const compareItems = (a: UsageIdentity, b: UsageIdentity) =>
  a.name.localeCompare(b.name) || a.key.localeCompare(b.key);

// 全Hubの日次明細を identify が返すキーで合算する。名前と補足は登録順で最初のHubの値を使う。
// 系列はコストの大きい順（不明は最後、同順位は名前順・キー順）に並べる。
export function aggregateUsage(
  data: HubUsageData,
  start: string,
  end: string,
  unit: AggregationUnit,
  identify: (hub: HubUsageHub, day: HubUsageDay) => UsageIdentity,
): UsageAggregate {
  const days = data.hubs.flatMap((hub) =>
    hub.days
      .filter((day) => day.date >= start && day.date <= end)
      .map((day) => ({ day, identity: identify(hub, day) })),
  );
  if (days.length === 0) return { items: [], buckets: [] };
  const totals = new Map<
    string,
    { identity: UsageIdentity; tokens: number; costs: (number | null)[] }
  >();
  for (const { day, identity } of days) {
    const total = totals.get(identity.key) ?? { identity, tokens: 0, costs: [] };
    total.tokens += day.tokens;
    total.costs.push(day.costUsd);
    totals.set(identity.key, total);
  }
  const costs = new Map([...totals].map(([key, total]) => [key, sumCosts(total.costs)]));
  const keys = [...totals.keys()].sort((a, b) => {
    const left = costs.get(a)!;
    const right = costs.get(b)!;
    const byName = compareItems(totals.get(a)!.identity, totals.get(b)!.identity);
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1;
      return byName;
    }
    return right - left || byName;
  });
  const indexes = new Map(keys.map((key, index) => [key, index]));
  const dates: string[] = [];
  for (
    const date = new Date(`${start}T00:00:00Z`);
    dateKey(date) <= end;
    date.setUTCDate(date.getUTCDate() + 1)
  )
    dates.push(dateKey(date));
  const dateIndexes = new Map(dates.map((date, index) => [date, index]));
  const trends = keys.map(() => dates.map(() => 0));
  const grouped = new Map<string, { tokens: number[]; costs: (number | null)[][] }>();
  for (const date of dates)
    grouped.set(
      bucketKey(date, unit),
      grouped.get(bucketKey(date, unit)) ?? {
        tokens: keys.map(() => 0),
        costs: keys.map(() => []),
      },
    );
  for (const { day, identity } of days) {
    const index = indexes.get(identity.key)!;
    trends[index][dateIndexes.get(day.date)!] += day.tokens;
    const bucket = grouped.get(bucketKey(day.date, unit))!;
    bucket.tokens[index] += day.tokens;
    bucket.costs[index].push(day.costUsd);
  }
  const allTokens = days.reduce((sum, { day }) => sum + day.tokens, 0);
  return {
    items: keys.map((key, index) => {
      const total = totals.get(key)!;
      return {
        ...total.identity,
        color: seriesPalette[index % seriesPalette.length],
        tokens: total.tokens,
        costUsd: costs.get(key)!,
        share: allTokens > 0 ? total.tokens / allTokens : 0,
        trend: trends[index],
      };
    }),
    buckets: [...grouped].map(([key, bucket]) => ({
      key,
      label: bucketLabel(key, unit),
      tokens: bucket.costs.some((records) => records.length > 0)
        ? bucket.tokens
        : keys.map(() => null),
      costs: bucket.costs.some((records) => records.some((cost) => cost !== null))
        ? bucket.costs.map(sumCosts)
        : keys.map(() => null),
    })),
  };
}

// グラフ用に、選択中の系列はそのまま、選択していない系列は1本の Other に合算する。
export function groupUnselected(usage: UsageAggregate, chosen: ReadonlySet<string>) {
  const kept = usage.items.flatMap((item, index) => (chosen.has(item.key) ? [index] : []));
  const rest = usage.items.flatMap((item, index) => (chosen.has(item.key) ? [] : [index]));
  const series = kept.map((index) => ({
    key: usage.items[index].key,
    name: usage.items[index].name,
    color: usage.items[index].color,
  }));
  if (rest.length > 0) series.push({ key: '__other__', name: 'Other', color: otherColor });
  const buckets = usage.buckets.map((bucket) => {
    const tokens = kept.map((index) => bucket.tokens[index]);
    const costs = kept.map((index) => bucket.costs[index]);
    if (rest.length > 0) {
      tokens.push(
        bucket.tokens[rest[0]] === null
          ? null
          : rest.reduce((sum, index) => sum + (bucket.tokens[index] ?? 0), 0),
      );
      costs.push(sumCosts(rest.map((index) => bucket.costs[index])));
    }
    return { ...bucket, tokens, costs };
  });
  return { series, buckets };
}
