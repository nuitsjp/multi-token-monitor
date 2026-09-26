import type { components } from '../../../contracts/api.gen.ts';

export type Overview = components['schemas']['OverviewOutput'];

// 通知配信APIの hub.freshness の本文。SSEは型契約の対象外のため、ここで形を定める。
export type HubFreshness = {
  hubId: string;
  receivedAt: string;
  updatedAt: string;
  devices: { deviceId: string; updatedAt: string; stale: boolean }[];
};

// 時刻の更新を表示中の状態へ当てはめる。表示していない端末は無視し、利用量・利用枠は変えない。
export function applyFreshness(overview: Overview, freshness: HubFreshness): Overview {
  const devices = new Map(freshness.devices.map((device) => [device.deviceId, device]));
  return {
    ...overview,
    hubs: overview.hubs.map((hub) =>
      hub.hubId === freshness.hubId
        ? { ...hub, receivedAt: freshness.receivedAt, updatedAt: freshness.updatedAt }
        : hub,
    ),
    devices: overview.devices.map((device) => {
      const update = device.hubId === freshness.hubId ? devices.get(device.deviceId) : undefined;
      return update ? { ...device, updatedAt: update.updatedAt, stale: update.stale } : device;
    }),
  };
}

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
  // 段階3の動作合意用。VITE_OVERVIEW_MOCK=1 のときだけ、変更通知の代わりに固定の全体状態を表示し、
  // 以後5秒ごとに固定の時刻の更新を順に当てはめる。一巡したら全体状態から繰り返す。
  if (import.meta.env.VITE_OVERVIEW_MOCK === '1') {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    void import('./overview.mock.ts').then(({ overviewMock, freshnessMocks }) => {
      let current = overviewMock;
      let index = 0;
      const notify = () => {
        if (stopped) return;
        current = index === 0 ? overviewMock : applyFreshness(current, freshnessMocks[index - 1]);
        onOverview(current);
        index = (index + 1) % (freshnessMocks.length + 1);
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
