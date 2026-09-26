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
// 時刻の更新（hub.freshness）は取得し直さず、表示中の状態へ当てはめる。
export function watchOverview(
  onOverview: (overview: Overview) => void,
  onError: (reason: unknown) => void,
): () => void {
  const source = new EventSource('/api/events');
  let current: Overview | undefined;
  // 取得し直した応答が時刻の更新より前の保存状態でも古い時刻へ戻さないよう、Hubごとに最新の更新を覚えておく。
  const freshness = new Map<string, HubFreshness>();
  const show = (overview: Overview) => {
    current = overview;
    onOverview(overview);
  };
  let latest = 0;
  const refresh = () => {
    // 応答の到着順が前後しても、最後に要求した取得の結果だけを表示する。
    const request = ++latest;
    fetchOverview().then(
      (overview) => {
        if (request !== latest) return;
        let next = overview;
        for (const update of freshness.values()) {
          const hub = next.hubs.find((item) => item.hubId === update.hubId);
          if (hub?.receivedAt != null && hub.receivedAt < update.receivedAt)
            next = applyFreshness(next, update);
        }
        show(next);
      },
      (reason: unknown) => {
        if (request === latest) onError(reason);
      },
    );
  };
  source.addEventListener('ready', refresh);
  source.addEventListener('overview.changed', refresh);
  source.addEventListener('hub.freshness', (event) => {
    const update = JSON.parse(event.data as string) as HubFreshness;
    freshness.set(update.hubId, update);
    if (current) show(applyFreshness(current, update));
  });
  return () => {
    latest++;
    source.close();
  };
}
