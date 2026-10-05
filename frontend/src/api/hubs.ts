import type { HubInput } from '../hub-form.ts';

export type HubStatus = 'connected' | 'notReceived' | 'reconnecting';
// 認証トークンは含めない。
export type RegisteredHub = { hubId: string; name: string; url: string; status: HubStatus };

// モック確認用の合成点。実装フェーズで Hub管理API（GET・POST /api/hubs）の呼び出しに置き換え、固定表を削除する。
// ?hubs=none で登録済みのHubが0件の状態から始める。
const hubs: RegisteredHub[] =
  new URLSearchParams(location.search).get('hubs') === 'none'
    ? []
    : [
        { hubId: 'hub-1', name: 'Personal', url: 'https://hub.example.com', status: 'connected' },
        { hubId: 'hub-2', name: 'Work', url: 'http://10.0.0.5:8080', status: 'reconnecting' },
      ];
let sequence = hubs.length;

export async function fetchHubs(): Promise<RegisteredHub[]> {
  return hubs.map((hub) => ({ ...hub }));
}

export async function addHub(input: HubInput): Promise<RegisteredHub> {
  const hub: RegisteredHub = {
    hubId: `hub-${++sequence}`,
    name: input.name.trim(),
    url: input.url.trim(),
    status: 'notReceived',
  };
  hubs.push(hub);
  // 最初の全体状態を受けて Connected になる流れを再現する。
  setTimeout(() => {
    hub.status = 'connected';
  }, 2000);
  return { ...hub };
}
