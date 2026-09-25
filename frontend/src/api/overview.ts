import type { components } from '../../../contracts/api.gen.ts';

export type Overview = components['schemas']['OverviewOutput'];

// 閲覧の合成点。VITE_OVERVIEW_MOCK=1 のときだけ固定データを返す。実APIの失敗時に固定データへ切り替えない。
export async function fetchOverview(): Promise<Overview> {
  if (import.meta.env.VITE_OVERVIEW_MOCK === '1')
    return (await import('./overview.mock.ts')).overviewMock;
  const response = await fetch('/api/overview');
  if (!response.ok) throw new Error(`利用状況を取得できませんでした（HTTP ${response.status}）。`);
  return (await response.json()) as Overview;
}
