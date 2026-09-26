import type { components } from '../../../contracts/api.gen.ts';

export type Overview = components['schemas']['OverviewOutput'];

export async function fetchOverview(): Promise<Overview> {
  const response = await fetch('/api/overview');
  if (!response.ok) throw new Error(`利用状況を取得できませんでした（HTTP ${response.status}）。`);
  return (await response.json()) as Overview;
}

// 表示更新の合成点。VITE_OVERVIEW_MOCK=1 のときだけ、変更通知の代わりに一定間隔で固定データを順に渡す。
export function watchOverview(
  onOverview: (overview: Overview) => void,
  onError: (reason: unknown) => void,
): () => void {
  if (import.meta.env.VITE_OVERVIEW_MOCK === '1') {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    void import('./overview.mock.ts').then(({ overviewMocks }) => {
      let index = 0;
      const notify = () => {
        if (stopped) return;
        onOverview(overviewMocks[index++ % overviewMocks.length]);
        timer = setTimeout(notify, 5000);
      };
      notify();
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }
  fetchOverview().then(onOverview, onError);
  return () => {};
}
