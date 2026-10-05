export type HubInput = { name: string; url: string; token: string };
export type HubInputErrors = Partial<Record<keyof HubInput, string>>;

// 表示名・URL・認証トークンの検証。条件とメッセージは接続するHubを管理するユースケースの共通の受け入れ条件に従う。
// 変更では、Tokenが空なら登録済みの値を保つため、空を許す（登録済みのTokenが空かどうかはサーバーが判定する）。
export function validateHubInput(
  input: HubInput,
  options?: { tokenOptional: boolean },
): HubInputErrors {
  const errors: HubInputErrors = {};
  if (input.name.trim() === '') errors.name = 'Enter a name.';
  if (!/^https?:\/\/[^\s/?#@]+\/?$/i.test(input.url.trim()))
    errors.url = 'Enter a URL like http(s)://host[:port].';
  const token = input.token.trim();
  // eslint-disable-next-line no-control-regex
  if ((token === '' && !options?.tokenOptional) || /[\u0000-\u001f\u007f]/.test(token))
    errors.token = 'Enter a valid token.';
  return errors;
}
