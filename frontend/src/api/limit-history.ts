import type { components } from '../../../contracts/api.gen.ts';

// 製品は Hub × 契約 × 枠グループ。並びは Hub の登録順、Home と同じ契約の順、枠グループの順。
export type LimitHistoryProduct = components['schemas']['LimitHistoryProductOutput'];
// 1日1行。その日に最後に求まった月換算上限額と、その時点の支払額（価格表に無ければ null）。
export type LimitHistoryDay = components['schemas']['LimitHistoryDayOutput'];
export type LimitHistoryData = components['schemas']['LimitHistoryOutput'];

export async function fetchLimitHistory(): Promise<LimitHistoryData> {
  const response = await fetch('/api/limit-history');
  if (!response.ok) throw new Error(`Unable to load usage limits (HTTP ${response.status}).`);
  return (await response.json()) as LimitHistoryData;
}
