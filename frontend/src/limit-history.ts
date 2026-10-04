import type { LimitHistoryData, LimitHistoryProduct } from './api/limit-history.ts';
import { bucketKey, bucketLabel, dateKey, type AggregationUnit } from './hub-usage.ts';
import { seriesPalette } from './usage-breakdown.ts';

export type LimitPoint = { limitUsd: number; priceUsd: number | null; multiplier: number | null };
export type LimitProductHistory = LimitHistoryProduct & {
  color: string;
  latest: LimitPoint;
  change: number;
  trend: number[];
};
export type LimitHistoryAggregate = {
  products: LimitProductHistory[];
  buckets: { key: string; label: string; points: Map<string, LimitPoint> }[];
};

const pointOf = (day: { monthlyLimitUsd: number; priceUsd: number | null }): LimitPoint => ({
  limitUsd: day.monthlyLimitUsd,
  priceUsd: day.priceUsd,
  multiplier: day.priceUsd === null ? null : day.monthlyLimitUsd / day.priceUsd,
});

// 選択期間の記録から、製品ごとの最新値・変化率・日次推移と、集約単位ごとの点（その単位の最後の記録）を作る。
export function aggregateLimitHistory(
  data: LimitHistoryData,
  start: string,
  end: string,
  unit: AggregationUnit,
): LimitHistoryAggregate {
  const days = data.days
    .filter((day) => day.date >= start && day.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
  const products = data.products
    .map((product) => ({ product, records: days.filter((day) => day.productKey === product.key) }))
    .filter(({ records }) => records.length > 0)
    .map(({ product, records }, index) => {
      const first = records[0];
      const last = records[records.length - 1];
      return {
        ...product,
        color: seriesPalette[index % seriesPalette.length],
        latest: pointOf(last),
        change: last.monthlyLimitUsd / first.monthlyLimitUsd - 1,
        trend: records.map((day) => day.monthlyLimitUsd),
      };
    });
  const buckets = new Map<string, Map<string, LimitPoint>>();
  for (let date = new Date(`${start}T00:00:00Z`); dateKey(date) <= end;) {
    buckets.set(bucketKey(dateKey(date), unit), new Map());
    date.setUTCDate(date.getUTCDate() + 1);
  }
  for (const day of days) buckets.get(bucketKey(day.date, unit))!.set(day.productKey, pointOf(day));
  return {
    products,
    buckets: [...buckets].map(([key, points]) => ({
      key,
      label: bucketLabel(key, unit),
      points,
    })),
  };
}
