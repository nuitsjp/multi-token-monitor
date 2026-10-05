import type { HubInput, HubInputErrors } from '../hub-form.ts';

export type HubStatus = 'connected' | 'notReceived' | 'reconnecting';
// 認証トークンは含めない。
export type RegisteredHub = { hubId: string; name: string; url: string; status: HubStatus };

// サーバーが入力を拒んだとき、項目ごとのメッセージを持つ。
export class HubInputRejected extends Error {
  constructor(readonly errors: HubInputErrors) {
    super('The hub was not saved.');
  }
}

// モック確認用の合成点。実装フェーズで Hub管理API（GET・POST・PUT /api/hubs）の呼び出しに置き換え、固定表を削除する。
// ?hubs=none で登録済みのHubが0件の状態から始める。
// 接続確認の再現: URLのホスト名に reject を含むと認証の拒否、down を含むと接続の失敗、それ以外は成功とする。
type MockHub = RegisteredHub & { token: string };
const hubs: MockHub[] =
  new URLSearchParams(location.search).get('hubs') === 'none'
    ? []
    : [
        {
          hubId: 'hub-1',
          name: 'Personal',
          url: 'https://hub.example.com',
          token: 'secret-1',
          status: 'connected',
        },
        {
          hubId: 'hub-2',
          name: 'Work',
          url: 'http://10.0.0.5:8080',
          token: 'secret-2',
          status: 'reconnecting',
        },
        // 接続情報の導入前から存在したHub。URLとTokenが空で、受信しない。
        { hubId: 'hub-3', name: 'Legacy', url: '', token: '', status: 'reconnecting' },
      ];
let sequence = hubs.length;

// モック専用。実装では保存確定の通知（UCP-3）が取得し直しを促す。
const notifyChanged = () => window.dispatchEvent(new Event('mock-hubs-changed'));

const view = ({ token: _token, ...hub }: MockHub): RegisteredHub => hub;

async function checkConnection(url: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (url.includes('reject')) throw new HubInputRejected({ token: 'The hub rejected the token.' });
  if (url.includes('down')) throw new HubInputRejected({ token: 'Could not connect to the hub.' });
}

// 最初の全体状態を受けて Connected になる流れを再現する。
function receiveSoon(hub: MockHub) {
  hub.status = 'notReceived';
  setTimeout(() => {
    hub.status = 'connected';
    notifyChanged();
  }, 2000);
}

export async function fetchHubs(): Promise<RegisteredHub[]> {
  return hubs.map(view);
}

export async function addHub(input: HubInput): Promise<RegisteredHub> {
  const url = input.url.trim();
  await checkConnection(url);
  const hub: MockHub = {
    hubId: `hub-${++sequence}`,
    name: input.name.trim(),
    url,
    token: input.token.trim(),
    status: 'notReceived',
  };
  hubs.push(hub);
  receiveSoon(hub);
  notifyChanged();
  return view(hub);
}

// Tokenが空なら登録済みの値を保つ。
export async function updateHub(hubId: string, input: HubInput): Promise<RegisteredHub> {
  const hub = hubs.find((candidate) => candidate.hubId === hubId);
  if (!hub) throw new Error('Unable to save the hub (HTTP 404).');
  const url = input.url.trim();
  const token = input.token.trim() === '' ? hub.token : input.token.trim();
  if (token === '') throw new HubInputRejected({ token: 'Enter a valid token.' });
  const connectionChanged = url !== hub.url || token !== hub.token;
  if (connectionChanged) await checkConnection(url);
  hub.name = input.name.trim();
  hub.url = url;
  hub.token = token;
  if (connectionChanged) receiveSoon(hub);
  notifyChanged();
  return view(hub);
}
