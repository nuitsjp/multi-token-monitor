import type { components } from '../../../contracts/api.gen.ts';

export type Overview = components['schemas']['OverviewOutput'];

export async function fetchOverview(): Promise<Overview> {
  const response = await fetch('/api/overview');
  if (!response.ok) throw new Error(`利用状況を取得できませんでした（HTTP ${response.status}）。`);
  return (await response.json()) as Overview;
}
