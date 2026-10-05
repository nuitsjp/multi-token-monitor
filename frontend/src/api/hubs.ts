import type { components } from '../../../contracts/api.gen.ts';
import type { HubInput, HubInputErrors } from '../hub-form.ts';

// 認証トークンは含めない。
export type RegisteredHub = components['schemas']['HubRegistrationOutput'];
export type HubStatus = 'connected' | 'notReceived' | 'reconnecting';

// サーバーが入力を拒んだとき、項目ごとのメッセージを持つ。
export class HubInputRejected extends Error {
  constructor(readonly errors: HubInputErrors) {
    super('The hub was not saved.');
  }
}

export async function fetchHubs(): Promise<RegisteredHub[]> {
  const response = await fetch('/api/hubs');
  if (!response.ok) throw new Error(`Unable to load hubs (HTTP ${response.status}).`);
  return (await response.json()) as RegisteredHub[];
}

export async function addHub(input: HubInput): Promise<RegisteredHub> {
  const response = await fetch('/api/hubs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (response.status === 400) {
    const problem =
      (await response.json()) as components['schemas']['HttpValidationProblemDetails'];
    const errors = problem.errors ?? {};
    throw new HubInputRejected({
      name: errors.name?.[0],
      url: errors.url?.[0],
      token: errors.token?.[0],
    });
  }
  if (!response.ok) throw new Error(`Unable to save the hub (HTTP ${response.status}).`);
  return (await response.json()) as RegisteredHub;
}
