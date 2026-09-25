import { describe, it, expect } from 'vitest';
import {
  HttpError,
  parseProblemDetails,
  readErrorMessage,
  readErrorMessages,
  readFieldError,
} from '../../../frontend/src/shared/errors.ts';

const fallbackMessage = '処理を完了できませんでした。接続とサーバーの状態を確認してください。';

describe('readErrorMessage', () => {
  it('Problem Detailsの公開メッセージを返す', () => {
    // Arrange
    const error = new HttpError(409, { status: 409, detail: '版が古くなっています。' });

    // Act
    const message = readErrorMessage(error);

    // Assert
    expect(message).toBe('版が古くなっています。');
  });

  it('HttpError以外の内部エラー文字列を表示へ流さない', () => {
    // Arrange
    const error = new Error('password=secret');

    // Act
    const message = readErrorMessage(error);

    // Assert
    expect(message).toBe(fallbackMessage);
  });
});

describe('readErrorMessages', () => {
  it('項目別の入力エラーをすべて返す', () => {
    // Arrange
    const error = new HttpError(400, {
      status: 400,
      errors: { title: ['タイトルを入力してください。'], body: ['本文が長すぎます。'] },
    });

    // Act
    const messages = readErrorMessages(error);

    // Assert
    expect(messages).toEqual(['タイトルを入力してください。', '本文が長すぎます。']);
  });

  it('入力欄で表示する項目のエラーを除く', () => {
    // Arrange
    const error = new HttpError(400, {
      status: 400,
      errors: {
        Title: ['タイトルを入力してください。'],
        request: ['入力の形式を確認してください。'],
      },
    });

    // Act
    const messages = readErrorMessages(error, ['Title']);

    // Assert
    expect(messages).toEqual(['入力の形式を確認してください。']);
  });

  it('すべての項目を入力欄で表示するなら空にする', () => {
    // Arrange
    const error = new HttpError(400, {
      status: 400,
      errors: { Title: ['タイトルを入力してください。'] },
    });

    // Act
    const messages = readErrorMessages(error, ['Title']);

    // Assert
    expect(messages).toEqual([]);
  });
});

describe('readFieldError', () => {
  it('指定した項目のエラーだけを返す', () => {
    // Arrange
    const error = new HttpError(400, {
      status: 400,
      errors: { Title: ['タイトルを入力してください。'] },
    });

    // Act
    const title = readFieldError(error, 'Title');
    const body = readFieldError(error, 'Body');

    // Assert
    expect(title).toBe('タイトルを入力してください。');
    expect(body).toBeUndefined();
  });
});

describe('parseProblemDetails', () => {
  it('文字列配列でない項目エラーを捨てる', () => {
    // Arrange
    const body = {
      status: 400,
      errors: { Title: ['タイトルを入力してください。'], Body: 'not-array', Id: [1] },
    };

    // Act
    const problem = parseProblemDetails(body, 400);

    // Assert
    expect(problem.errors).toEqual({ Title: ['タイトルを入力してください。'] });
  });

  it('オブジェクトでない応答は既定メッセージにする', () => {
    // Arrange
    const body = '<html>Bad Gateway</html>';

    // Act
    const problem = parseProblemDetails(body, 502);

    // Assert
    expect(problem).toEqual({ status: 502, detail: fallbackMessage });
  });
});
