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
