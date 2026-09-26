import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, serverDll, test } from '../fixtures.ts';

// 拡張シナリオ「接続設定が不正なため起動しない」を検証する。
test.use({ serveFrontend: false });

const TOKEN = 'invalid-config-secret-token';
const ADDRESS = '127.0.0.1:9';
const hub = (override: Record<string, unknown> = {}) => ({
  id: 'alpha',
  name: 'Alpha Hub',
  url: `http://${ADDRESS}`,
  token: TOKEN,
  ...override,
});
const json = (hubs: unknown[]) => JSON.stringify({ hubs });

const FORMAT = 'Hub接続設定ファイルの形式が不正です。';
const DUPLICATE = 'Hub接続設定ファイルのHub IDが重複しています。';
const URL = 'Hub接続設定ファイルのURLが不正です。';

// [条件, 設定ファイルの内容（undefined はファイルなし）, 標準エラーの理由]
const CASES: [string, string | undefined, string][] = [
  ['ファイルがない', undefined, 'Hub接続設定ファイルを読み込めません。'],
  ['JSONが不正', '{"hubs": [', FORMAT],
  ['Hubが0件', json([]), FORMAT],
  [
    '認証トークンの欠落',
    json([{ id: 'alpha', name: 'Alpha Hub', url: `http://${ADDRESS}` }]),
    FORMAT,
  ],
  ['表示名が空白', json([hub({ name: ' ' })]), FORMAT],
  ['認証トークンに制御文字', json([hub({ token: `${TOKEN}\u0001` })]), FORMAT],
  ['Hub IDの重複', json([hub(), hub({ id: ' alpha ' })]), DUPLICATE],
  ['URLにパス', json([hub({ url: `http://${ADDRESS}/api` })]), URL],
  ['URLがhttp(s)以外', json([hub({ url: `ftp://${ADDRESS}` })]), URL],
  ['URLにユーザー情報', json([hub({ url: `http://user:${TOKEN}@${ADDRESS}` })]), URL],
];

// 本体と書き込みログを合わせたDBの内容。
function databaseHash(databasePath: string): string {
  const hash = createHash('sha256');
  for (const path of [databasePath, `${databasePath}-wal`])
    hash.update(existsSync(path) ? readFileSync(path) : Buffer.alloc(0));
  return hash.digest('hex');
}

// .NETのコンソール出力の文字コードは実行環境のコードページで決まる（日本語Windowsの手元はShift_JIS、CIはUTF-8）。
function decode(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

function run(databasePath: string, hubConfigPath: string | undefined) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DOTNET_ENVIRONMENT: 'Production',
    ASPNETCORE_ENVIRONMENT: 'Production',
    HOST: '127.0.0.1',
    PORT: '0',
    DB_PATH: databasePath,
    Logging__LogLevel__Default: 'Warning',
  };
  if (hubConfigPath === undefined) delete env.HUB_CONFIG_PATH;
  else env.HUB_CONFIG_PATH = hubConfigPath;
  const result = spawnSync('dotnet', [serverDll], { env, timeout: 30_000 });
  return { status: result.status, stdout: decode(result.stdout), stderr: decode(result.stderr) };
}

test('接続設定が不正なら理由を出力して終了コード1で終わり、DBを変更しない', async ({ app }) => {
  test.setTimeout(120_000);
  // 正しい設定で一度起動したDBを用意する。
  await app.stop();
  const db = app.databasePath;
  const before = databaseHash(db);
  const directory = dirname(db);

  const cases: [string, string | undefined, string][] = [
    [
      'HUB_CONFIG_PATHが未設定',
      undefined,
      'HUB_CONFIG_PATHにHub接続設定ファイルを指定してください。',
    ],
    ...CASES.map(([condition, content, reason], index): [string, string | undefined, string] => {
      const path = join(directory, `invalid-${index}.json`);
      if (content !== undefined) writeFileSync(path, content);
      return [condition, path, reason];
    }),
  ];

  for (const [condition, hubConfigPath, reason] of cases) {
    const result = run(db, hubConfigPath);
    expect(result.status, condition).toBe(1);
    expect(result.stderr.trim(), condition).toBe(reason);
    // Webサーバーは起動しない。
    expect(result.stdout, condition).not.toContain('AIDD_READY');
    for (const secret of [TOKEN, ADDRESS])
      expect(result.stdout + result.stderr, condition).not.toContain(secret);
    expect(databaseHash(db), condition).toBe(before);
  }
});
