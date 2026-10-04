import type { components } from '../../../contracts/api.gen.ts';

// 契約は Hub × 提供元 × アカウント。並びは Hub の登録順、Home と同じ契約の順。
export type LimitHistoryContract = components['schemas']['LimitHistoryContractOutput'];
// 契約ごと1日1行。枠グループの月換算上限額の合計と、その時点の支払額（価格表に無ければ null）。
// 記録のない枠グループがある日は lowerBound（下限値）。
export type LimitHistoryDay = components['schemas']['LimitHistoryDayOutput'];
export type LimitHistoryData = components['schemas']['LimitHistoryOutput'];

export async function fetchLimitHistory(): Promise<LimitHistoryData> {
  // 段階3の動作合意用。VITE_LIMITS_MOCK=1 のときだけ固定データを返す。
  if (import.meta.env.VITE_LIMITS_MOCK === '1')
    return (await import('./limits.mock.ts')).limitHistoryMock();
  const response = await fetch('/api/limit-history');
  if (!response.ok) throw new Error(`Unable to load usage limits (HTTP ${response.status}).`);
  return (await response.json()) as LimitHistoryData;
}
