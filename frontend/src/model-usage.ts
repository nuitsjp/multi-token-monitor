import type { HubUsageData } from './api/hub-usage.ts';
import { bucketKey, bucketLabel, dateKey, sumCosts, type AggregationUnit } from './hub-usage.ts';

export const modelPalette = [
  '#9789c7',
  '#6b9eac',
  '#bf966b',
  '#83a584',
  '#b97d94',
  '#c7b26b',
  '#6bbfa7',
  '#7d8fc7',
];

export type ModelUsage = {
  name: string;
  color: string;
  tokens: number;
  costUsd: number | null;
  share: number;
  trend: number[];
};
export type ModelAggregate = {
  models: ModelUsage[];
  buckets: { key: string; label: string; tokens: (number | null)[]; costs: (number | null)[] }[];
};

// 全Hubの日次明細をモデル名で合算する。モデルはコストの大きい順（不明は最後、同順位は名前順）に並べる。
export function aggregateModels(
  data: HubUsageData,
  start: string,
  end: string,
  unit: AggregationUnit,
): ModelAggregate {
  const days = data.hubs
    .flatMap((hub) => hub.days)
    .filter((day) => day.date >= start && day.date <= end);
  if (days.length === 0) return { models: [], buckets: [] };
  const totals = new Map<string, { tokens: number; costs: (number | null)[] }>();
  for (const day of days) {
    const total = totals.get(day.model) ?? { tokens: 0, costs: [] };
    total.tokens += day.tokens;
    total.costs.push(day.costUsd);
    totals.set(day.model, total);
  }
  const costs = new Map([...totals].map(([name, total]) => [name, sumCosts(total.costs)]));
  const names = [...totals.keys()].sort((a, b) => {
    const left = costs.get(a)!;
    const right = costs.get(b)!;
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1;
      return a.localeCompare(b);
    }
    return right - left || a.localeCompare(b);
  });
  const indexes = new Map(names.map((name, index) => [name, index]));
  const dates: string[] = [];
  for (
    const date = new Date(`${start}T00:00:00Z`);
    dateKey(date) <= end;
    date.setUTCDate(date.getUTCDate() + 1)
  )
    dates.push(dateKey(date));
  const dateIndexes = new Map(dates.map((date, index) => [date, index]));
  const trends = names.map(() => dates.map(() => 0));
  const grouped = new Map<string, { tokens: number[]; costs: (number | null)[][] }>();
  for (const date of dates)
    grouped.set(
      bucketKey(date, unit),
      grouped.get(bucketKey(date, unit)) ?? {
        tokens: names.map(() => 0),
        costs: names.map(() => []),
      },
    );
  for (const day of days) {
    const index = indexes.get(day.model)!;
    trends[index][dateIndexes.get(day.date)!] += day.tokens;
    const bucket = grouped.get(bucketKey(day.date, unit))!;
    bucket.tokens[index] += day.tokens;
    bucket.costs[index].push(day.costUsd);
  }
  const allTokens = days.reduce((sum, day) => sum + day.tokens, 0);
  return {
    models: names.map((name, index) => ({
      name,
      color: modelPalette[index % modelPalette.length],
      tokens: totals.get(name)!.tokens,
      costUsd: costs.get(name)!,
      share: allTokens > 0 ? totals.get(name)!.tokens / allTokens : 0,
      trend: trends[index],
    })),
    buckets: [...grouped].map(([key, bucket]) => ({
      key,
      label: bucketLabel(key, unit),
      tokens: bucket.costs.some((records) => records.length > 0)
        ? bucket.tokens
        : names.map(() => null),
      costs: bucket.costs.some((records) => records.some((cost) => cost !== null))
        ? bucket.costs.map(sumCosts)
        : names.map(() => null),
    })),
  };
}
