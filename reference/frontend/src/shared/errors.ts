import type { ApiProblem, ValidationProblem } from '@contracts/notes.ts';

const fallbackMessage = '処理を完了できませんでした。接続とサーバーの状態を確認してください。';

export type ProblemDetails = ApiProblem & Pick<ValidationProblem, 'errors'>;

export class HttpError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;

  constructor(status: number, problem: ProblemDetails) {
    super(readProblemMessages(problem)[0] ?? fallbackMessage);
    this.name = 'HttpError';
    this.status = status;
    this.problem = problem;
  }
}

export function readErrorMessage(error: unknown): string {
  return error instanceof HttpError ? error.message : fallbackMessage;
}

// fieldsに指定した項目のエラーは入力欄で表示するため除く。
export function readErrorMessages(error: unknown, fields: readonly string[] = []): string[] {
  return error instanceof HttpError
    ? readProblemMessages(error.problem, fields)
    : [fallbackMessage];
}

export function readFieldError(error: unknown, field: string): string | undefined {
  return error instanceof HttpError ? error.problem.errors?.[field]?.join(' ') : undefined;
}

export function parseProblemDetails(value: unknown, status: number): ProblemDetails {
  if (!value || typeof value !== 'object') return { status, detail: fallbackMessage };
  const source = value as Record<string, unknown>;
  const errors =
    source.errors && typeof source.errors === 'object'
      ? Object.fromEntries(
          Object.entries(source.errors as Record<string, unknown>).filter(
            (entry): entry is [string, string[]] =>
              Array.isArray(entry[1]) && entry[1].every((item) => typeof item === 'string'),
          ),
        )
      : undefined;
  return {
    status: typeof source.status === 'number' ? source.status : status,
    title: typeof source.title === 'string' ? source.title : undefined,
    detail: typeof source.detail === 'string' ? source.detail : undefined,
    errors,
  };
}

function readProblemMessages(problem: ProblemDetails, fields: readonly string[] = []): string[] {
  const entries = Object.entries(problem.errors ?? {}).filter(
    ([, messages]) => messages.length > 0,
  );
  if (entries.length > 0)
    return entries.filter(([field]) => !fields.includes(field)).flatMap(([, messages]) => messages);
  if (problem.detail) return [problem.detail];
  if (problem.title) return [problem.title];
  return [fallbackMessage];
}
