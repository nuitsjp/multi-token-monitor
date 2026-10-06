import { describe, expect, it } from 'vitest';
import { validateHubInput } from '../../frontend/src/hub-form.ts';

const valid = { name: 'Lab', url: 'https://hub.example.com', token: 'secret' };

describe('validateHubInput', () => {
  it('追加では空のTokenを拒む', () => {
    expect(validateHubInput({ ...valid, token: ' ' })).toEqual({ token: 'Enter a valid token.' });
  });

  it('変更ではTokenが空でもよいが、制御文字を含むTokenは拒む', () => {
    expect(validateHubInput({ ...valid, token: '' }, { tokenOptional: true })).toEqual({});
    expect(validateHubInput({ ...valid, token: 'a\nb' }, { tokenOptional: true })).toEqual({
      token: 'Enter a valid token.',
    });
  });

  it('変更でも表示名とURLの検証は行う', () => {
    expect(validateHubInput({ name: ' ', url: 'x', token: '' }, { tokenOptional: true })).toEqual({
      name: 'Enter a name.',
      url: 'Enter a URL like http(s)://host[:port].',
    });
  });
});
