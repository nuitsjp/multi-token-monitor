import type { HubUsageDevice, HubUsageHub } from './api/hub-usage.ts';

export type AggregationUnit = 'daily' | 'weekly' | 'monthly';
export type RangePreset = '7d' | '2w' | '4w' | '3m' | '1y';
export type HubUsageAggregate = {
  series: { key: string; name: string; color: string }[];
  buckets: { key: string; label: string; tokens: (number | null)[]; costs: (number | null)[] }[];
  devices: {
    device: HubUsageDevice;
    tokens: number | null;
    costUsd: number | null;
    tokenShare: number | null;
    costShare: number | null;
  }[];
  totalTokens: number | null;
  totalCostUsd: number | null;
  partial: boolean;
};

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function rangeForPreset(preset: RangePreset, today: string): { start: string; end: string } {
  const start = new Date(`${today}T00:00:00Z`);
  if (preset === '7d' || preset === '2w' || preset === '4w') {
    start.setUTCDate(start.getUTCDate() - { '7d': 6, '2w': 13, '4w': 27 }[preset]);
  } else {
    start.setUTCDate(start.getUTCDate() + 1);
    const targetDay = start.getUTCDate();
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - (preset === '3m' ? 3 : 12));
    const lastDay = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
    ).getUTCDate();
    start.setUTCDate(Math.min(targetDay, lastDay));
  }
  return { start: dateKey(start), end: today };
}

export function bucketKey(date: string, unit: AggregationUnit): string {
  if (unit === 'monthly') return date.slice(0, 7);
  if (unit === 'daily') return date;
  const monday = new Date(`${date}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return dateKey(monday);
}

export function sumCosts(values: (number | null)[]): number | null {
  if (values.length === 0) return 0;
  const known = values.filter((value): value is number => value !== null);
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}

export function bucketLabel(key: string, unit: AggregationUnit): string {
  return unit === 'monthly'
    ? new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        timeZone: 'UTC',
      })
    : `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
}

export function aggregateHub(
  hub: HubUsageHub,
  start: string,
  end: string,
  unit: AggregationUnit,
): HubUsageAggregate {
  const days = hub.days.filter((day) => day.date >= start && day.date <= end);
  const totals = new Map<string, number>();
  for (const day of days) totals.set(day.model, (totals.get(day.model) ?? 0) + day.tokens);
  const top = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  const colors = ['#9789c7', '#6b9eac', '#bf966b', '#83a584', '#b97d94'];
  const series = top.map(([model], index) => ({ key: model, name: model, color: colors[index] }));
  const hasOther = totals.size > 5;
  if (hasOther) series.push({ key: '__other__', name: 'Other', color: '#626572' });
  const indexes = new Map(top.map(([model], index) => [model, index]));
  const grouped = new Map<string, { tokens: number[]; costs: (number | null)[][] }>();
  if (days.length > 0) {
    for (
      const date = new Date(`${start}T00:00:00Z`);
      dateKey(date) <= end;
      date.setUTCDate(date.getUTCDate() + 1)
    ) {
      const key = bucketKey(dateKey(date), unit);
      if (!grouped.has(key))
        grouped.set(key, { tokens: series.map(() => 0), costs: series.map(() => []) });
    }
  }
  for (const day of days) {
    const bucket = grouped.get(bucketKey(day.date, unit))!;
    const index = indexes.get(day.model) ?? 5;
    bucket.tokens[index] += day.tokens;
    bucket.costs[index].push(day.costUsd);
  }
  const totalTokens = days.length > 0 ? days.reduce((sum, day) => sum + day.tokens, 0) : null;
  const totalCostUsd = days.length > 0 ? sumCosts(days.map((day) => day.costUsd)) : null;
  const devices = hub.devices
    .map((device) => {
      const records = days.filter((day) => day.deviceId === device.deviceId);
      const known = records.length > 0;
      const tokens = known ? records.reduce((sum, day) => sum + day.tokens, 0) : null;
      const costUsd = known ? sumCosts(records.map((day) => day.costUsd)) : null;
      return {
        device,
        tokens,
        costUsd,
        tokenShare:
          tokens !== null && totalTokens !== null && totalTokens > 0 ? tokens / totalTokens : null,
        costShare:
          costUsd !== null && totalCostUsd !== null && totalCostUsd > 0
            ? costUsd / totalCostUsd
            : null,
      };
    })
    .sort((a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1));
  return {
    series,
    buckets: [...grouped].map(([key, bucket]) => ({
      key,
      label: bucketLabel(key, unit),
      tokens: bucket.costs.some((records) => records.length > 0)
        ? bucket.tokens
        : series.map(() => null),
      costs: bucket.costs.some((records) => records.some((cost) => cost !== null))
        ? bucket.costs.map(sumCosts)
        : series.map(() => null),
    })),
    devices,
    totalTokens,
    totalCostUsd,
    partial:
      days.length === 0 ||
      hub.devices.some((device) => !days.some((day) => day.deviceId === device.deviceId)) ||
      days.some((day) => day.costUsd === null),
  };
}
