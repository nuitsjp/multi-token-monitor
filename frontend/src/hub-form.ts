export type HubInput = { name: string; url: string; token: string };
export type HubInputErrors = Partial<Record<keyof HubInput, string>>;

// 表示名・URL・認証トークンの検証。条件とメッセージは接続するHubを管理するユースケースの共通の受け入れ条件に従う。
export function validateHubInput(input: HubInput): HubInputErrors {
  const errors: HubInputErrors = {};
  if (input.name.trim() === '') errors.name = 'Enter a name.';
  if (!/^https?:\/\/[^\s/?#@]+$/i.test(input.url.trim()))
    errors.url = 'Enter a URL like http(s)://host[:port].';
  // eslint-disable-next-line no-control-regex
  if (input.token === '' || /[\u0000-\u001f\u007f]/.test(input.token))
    errors.token = 'Enter a valid token.';
  return errors;
}
