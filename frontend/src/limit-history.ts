import type { LimitHistoryContract, LimitHistoryData } from './api/limit-history.ts';
import { bucketKey, bucketLabel, dateKey, type AggregationUnit } from './hub-usage.ts';
import { seriesPalette } from './usage-breakdown.ts';

// lowerBound は、記録のない枠グループがあり、月換算上限額と倍率が下限値であること。
export type LimitPoint = {
  limitUsd: number;
  priceUsd: number | null;
  multiplier: number | null;
  lowerBound: boolean;
};
export type LimitContractHistory = LimitHistoryContract & {
  color: string;
  latest: LimitPoint;
  change: number;
  trend: number[];
};
export type LimitHistoryAggregate = {
  contracts: LimitContractHistory[];
  buckets: { key: string; label: string; points: Map<string, LimitPoint> }[];
};

const pointOf = (day: LimitHistoryData['days'][number]): LimitPoint => ({
  limitUsd: day.monthlyLimitUsd,
  priceUsd: day.priceUsd,
  multiplier: day.priceUsd === null ? null : day.monthlyLimitUsd / day.priceUsd,
  lowerBound: day.lowerBound,
});

// 選択期間の記録から、契約ごとの最新値・変化率・日次推移と、集約単位ごとの点（その単位の最後の記録）を作る。
export function aggregateLimitHistory(
  data: LimitHistoryData,
  start: string,
  end: string,
  unit: AggregationUnit,
): LimitHistoryAggregate {
  const days = data.days
    .filter((day) => day.date >= start && day.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
  const contracts = data.contracts
    .map((contract) => ({
      contract,
      records: days.filter((day) => day.contractKey === contract.key),
    }))
    .filter(({ records }) => records.length > 0)
    .map(({ contract, records }, index) => {
      const first = records[0];
      const last = records[records.length - 1];
      return {
        ...contract,
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
  for (const day of days)
    buckets.get(bucketKey(day.date, unit))!.set(day.contractKey, pointOf(day));
  return {
    contracts,
    buckets: [...buckets].map(([key, points]) => ({
      key,
      label: bucketLabel(key, unit),
      points,
    })),
  };
}
