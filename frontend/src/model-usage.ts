import type { HubUsageData } from './api/hub-usage.ts';
import type { AggregationUnit } from './hub-usage.ts';
import { aggregateUsage } from './usage-breakdown.ts';

// 同名モデルはツール・Hub・デバイスをまたいで合算する。
export const aggregateModels = (
  data: HubUsageData,
  start: string,
  end: string,
  unit: AggregationUnit,
) =>
  aggregateUsage(data, start, end, unit, (_hub, day) => ({
    key: day.model,
    name: day.model,
    detail: null,
  }));
