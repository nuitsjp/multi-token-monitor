import type { components } from '../../../contracts/api.gen.ts';

export type Overview = components['schemas']['OverviewOutput'];

export async function fetchOverview(): Promise<Overview> {
  const response = await fetch('/api/overview');
  if (!response.ok) throw new Error(`利用状況を取得できませんでした（HTTP ${response.status}）。`);
  return (await response.json()) as Overview;
}

// 変更通知を購読し、接続・再接続（ready）と保存確定（overview.changed）のたびに取得し直す。
export function watchOverview(
  onOverview: (overview: Overview) => void,
  onError: (reason: unknown) => void,
): () => void {
  // 段階3の動作合意用。VITE_OVERVIEW_MOCK=1 のときだけ、変更通知の代わりに5秒ごとに固定データを順に渡す。
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
  const source = new EventSource('/api/events');
  let latest = 0;
  const refresh = () => {
    // 応答の到着順が前後しても、最後に要求した取得の結果だけを表示する。
    const request = ++latest;
    fetchOverview().then(
      (overview) => {
        if (request === latest) onOverview(overview);
      },
      (reason: unknown) => {
        if (request === latest) onError(reason);
      },
    );
  };
  source.addEventListener('ready', refresh);
  source.addEventListener('overview.changed', refresh);
  return () => {
    latest++;
    source.close();
  };
}
