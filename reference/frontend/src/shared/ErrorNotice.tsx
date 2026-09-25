import { Alert } from '@mantine/core';
import { readErrorMessages } from './errors.ts';
export function ErrorNotice({
  error,
  title = '処理を完了できませんでした',
  fields,
}: {
  error: unknown;
  title?: string;
  fields?: readonly string[];
}) {
  if (!error) return null;
  const messages = readErrorMessages(error, fields);
  if (messages.length === 0) return null;
  return (
    <Alert color="red" title={title} role="alert">
      {messages.length === 1 ? (
        <span>{messages[0]}</span>
      ) : (
        <ul>
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
