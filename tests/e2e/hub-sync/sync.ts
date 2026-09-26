import { DatabaseSync } from 'node:sqlite';

// 保存処理とは別の読み取り専用接続で読む。アプリの移行・保存中はロックの解放を待つ。
export function query<T>(databasePath: string, sql: string, ...params: (string | number)[]): T[] {
  const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

// 通知配信APIを購読し、受け取った合図を記録する。
export async function watchEvents(url: string) {
  const controller = new AbortController();
  const response = await fetch(`${url}/api/events`, { signal: controller.signal });
  const events: { event: string; data: string }[] = [];
  let raw = '';
  void (async () => {
    const decoder = new TextDecoder();
    const reader = response.body!.getReader();
    try {
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        raw += decoder.decode(chunk.value, { stream: true });
        let end;
        while ((end = raw.indexOf('\n\n')) >= 0) {
          const block = raw.slice(0, end);
          raw = raw.slice(end + 2);
          const field = (name: string) =>
            block
              .split('\n')
              .find((line) => line.startsWith(`${name}: `))
              ?.slice(name.length + 2) ?? '';
          events.push({ event: field('event'), data: field('data') });
        }
      }
    } catch {
      // 購読の終了による中断。
    }
  })();
  return {
    response,
    events,
    changed: () => events.filter((item) => item.event === 'overview.changed').length,
    close: () => controller.abort(),
  };
}
