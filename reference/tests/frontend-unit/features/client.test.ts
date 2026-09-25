import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postJson, requestJson } from '../../../frontend/src/features/client.ts';
import { HttpError } from '../../../frontend/src/shared/errors.ts';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('requestJson', () => {
  it('成功応答のJSONを返す', async () => {
    // Arrange
    const notes = [{ id: 'note-1', title: '題名' }];
    fetchMock.mockResolvedValue(jsonResponse(notes));

    // Act
    const result = await requestJson('/api/notes');

    // Assert
    expect(result).toEqual(notes);
  });

  it('成功応答の不正JSONを成功値として扱わない', async () => {
    // Arrange
    fetchMock.mockResolvedValue(new Response('not-json', { status: 200 }));

    // Act
    const result = requestJson('/api/notes');

    // Assert
    await expect(result).rejects.toThrow('サーバーの応答を読み取れませんでした。');
  });

  it('エラー応答のProblem DetailsをHttpErrorで保持する', async () => {
    // Arrange
    fetchMock.mockResolvedValue(
      jsonResponse(
        { title: '更新が競合しました。', status: 409, detail: '版が古くなっています。' },
        409,
      ),
    );

    // Act
    const error = await requestJson('/api/notes').catch((reason: unknown) => reason);

    // Assert
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 409, message: '版が古くなっています。' });
  });

  it('JSONでないエラー応答は既定メッセージのHttpErrorにする', async () => {
    // Arrange
    fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));

    // Act
    const error = await requestJson('/api/notes').catch((reason: unknown) => reason);

    // Assert
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      status: 502,
      message: '処理を完了できませんでした。接続とサーバーの状態を確認してください。',
    });
  });
});

describe('postJson', () => {
  it('入力をJSON本文としてPOSTする', async () => {
    // Arrange
    const input = { id: 'note-1', version: 2 };
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    // Act
    await postJson('/api/notes/remove', input);

    // Assert
    expect(fetchMock).toHaveBeenCalledWith('/api/notes/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  });
});
