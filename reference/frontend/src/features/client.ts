import { HttpError, parseProblemDetails } from '../shared/errors.ts';

export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (response.ok) throw new Error('サーバーの応答を読み取れませんでした。');
    body = undefined;
  }
  if (!response.ok)
    throw new HttpError(response.status, parseProblemDetails(body, response.status));
  return body as T;
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
