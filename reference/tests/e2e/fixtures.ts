import { test as base, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { createServer, type ViteDevServer } from 'vite';

type E2EMode = 'dev' | 'hosted';
const mode = process.env.E2E_MODE ?? 'hosted';
if (mode !== 'dev' && mode !== 'hosted') throw new Error('E2E_MODEはdevまたはhostedです。');

export interface IsolatedApp {
  mode: E2EMode;
  url: string;
  databasePath: string;
  pid: number;
  restart: () => Promise<void>;
  rows: () => Array<{
    owner_id: string;
    title: string;
    body: string;
    version: number;
  }>;
}

type ProxyEntry = { target?: string };

function updateViteProxyTarget(server: ViteDevServer, target: string) {
  const proxy = server.config.server.proxy;
  if (!proxy || Array.isArray(proxy)) throw new Error('Viteのproxy設定を読み取れません。');
  for (const path of ['/api', '/events', '/health']) {
    const entry = proxy[path] as ProxyEntry | string | undefined;
    if (!entry || typeof entry === 'string' || Array.isArray(entry))
      throw new Error(`Viteのproxy設定が不正です: ${path}`);
    entry.target = target;
  }
}

export const test = base.extend<{
  app: IsolatedApp;
  serveFrontend: boolean;
}>({
  serveFrontend: [true, { option: true }],
  app: async ({ serveFrontend }, use, testInfo) => {
    // worker番号だけでなくmkdtempで分けるので、再試行・shard・複数コマンド同時実行でも衝突しない。
    const directory = await mkdtemp(join(tmpdir(), `aidd-e2e-${mode}-w${testInfo.workerIndex}-`));
    const databasePath = join(directory, 'app.sqlite');
    const viteCacheDirectory = join(directory, 'node_modules/.vite');
    let child: ChildProcess | undefined;
    let vite: ViteDevServer | undefined;
    let output = '';
    let address = '';
    let backendAddress = '';
    let viteAddress = '';
    let pid = 0;
    const append = (chunk: Buffer | string) => {
      output = (output + chunk.toString()).slice(-128 * 1024);
    };

    async function startVite() {
      if (mode !== 'dev' || !serveFrontend) return;
      if (vite) {
        if (!vite.httpServer?.listening) throw new Error('Viteサーバーが予期せず停止しました。');
        return;
      }
      vite = await createServer({
        configFile: resolve('frontend/vite.config.ts'),
        cacheDir: viteCacheDirectory,
        server: { host: '127.0.0.1', port: 0, strictPort: true },
      });
      // Viteのlisten(0)は既定ポートになるため、NodeのHTTPサーバーに直接空きポートを割り当てる。
      const httpServer = vite.httpServer!;
      await new Promise<void>((ready, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', () => {
          httpServer.off('error', reject);
          ready();
        });
      });
      const serverAddress = vite.httpServer?.address();
      if (!serverAddress || typeof serverAddress === 'string')
        throw new Error('Viteの起動URLを取得できません。');
      viteAddress = `http://127.0.0.1:${serverAddress.port}`;
    }

    async function stop() {
      const running = child;
      if (!running) return;
      try {
        if (running.exitCode !== null || running.signalCode !== null) {
          if (running.exitCode !== 0 || running.signalCode)
            throw new Error(
              `E2Eサーバーが異常終了しました code=${running.exitCode ?? 'null'} signal=${running.signalCode ?? 'null'}: ${output}`,
            );
          return;
        }
        await new Promise<void>((resolveStop, reject) => {
          let forced = false;
          const timer = setTimeout(() => {
            // テスト所有の子プロセスだけを終了。ファイル削除より先にexitを待つ。
            forced = true;
            running.kill('SIGKILL');
          }, 12000);
          const finish = (code: number | null, signal: NodeJS.Signals | null) => {
            clearTimeout(timer);
            if (forced) reject(new Error('E2Eサーバーの通常終了が期限を超えました'));
            else if (code !== 0 || signal)
              reject(
                new Error(
                  `E2Eサーバーが異常終了しました code=${code ?? 'null'} signal=${signal ?? 'null'}: ${output}`,
                ),
              );
            else resolveStop();
          };
          running.once('exit', finish);
          if (running.stdin && !running.stdin.destroyed) running.stdin.write('shutdown\n');
          else running.kill('SIGTERM');
        });
      } finally {
        if (child === running) child = undefined;
      }
    }

    async function start() {
      await startVite();
      address = vite ? viteAddress : '';
      backendAddress = '';
      const running = spawn(
        'dotnet',
        [resolve(mode === 'dev' ? 'dist/backend/App.dll' : 'dist/server/App.dll')],
        {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            DOTNET_ENVIRONMENT: 'Production',
            ASPNETCORE_ENVIRONMENT: 'Production',
            HOST: '127.0.0.1',
            PORT: '0',
            DB_PATH: databasePath,
            AUTH_MODE: 'demo',
            PUBLIC_ORIGIN: '',
            DEV_ORIGINS: vite ? viteAddress : '',
            AIDD_CONTROL_STDIN: '1',
            Logging__LogLevel__Default: 'Warning',
          },
        },
      );
      child = running;
      running.stderr?.on('data', append);
      await new Promise<void>((ready, reject) => {
        const lines = createInterface({ input: running.stdout! });
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          lines.close();
          running.off('exit', failed);
          reject(error);
        };
        const failed = (code: number | null, signal: NodeJS.Signals | null) => {
          fail(
            new Error(
              `サーバー起動失敗 code=${code ?? 'null'} signal=${signal ?? 'null'}: ${output}`,
            ),
          );
        };
        const timer = setTimeout(
          () => fail(new Error(`E2Eサーバーの起動が期限を超えました: ${output}`)),
          45000,
        );
        lines.on('line', (line) => {
          if (settled || !line.startsWith('AIDD_READY ')) return;
          try {
            const value: unknown = JSON.parse(line.slice('AIDD_READY '.length));
            if (
              !value ||
              typeof value !== 'object' ||
              !('url' in value) ||
              typeof value.url !== 'string'
            )
              throw new Error('urlがありません');
            backendAddress = new URL(value.url).origin;
            pid = running.pid ?? 0;
            if (vite) {
              updateViteProxyTarget(vite, backendAddress);
            } else {
              address = backendAddress;
            }
            settled = true;
            clearTimeout(timer);
            running.off('exit', failed);
            ready();
          } catch {
            fail(new Error(`E2Eサーバーのready情報が不正です: ${line}`));
          }
        });
        running.once('error', (error) => fail(error));
        running.once('exit', failed);
      });
    }

    const instance: IsolatedApp = {
      mode,
      get url() {
        return address;
      },
      databasePath,
      get pid() {
        return pid;
      },
      restart: async () => {
        await stop();
        await start();
      },
      rows: () => {
        // 検証は別の読取専用接続。HTTPの結果を再利用してDB更新済みと判断しない。
        const db = new DatabaseSync(databasePath, { readOnly: true });
        try {
          db.exec('PRAGMA busy_timeout=2000');
          return db
            .prepare('SELECT owner_id,title,body,version FROM notes ORDER BY title')
            .all() as unknown as ReturnType<IsolatedApp['rows']>;
        } finally {
          db.close();
        }
      },
    };
    try {
      await start();
      testInfo.annotations.push({
        type: 'isolated-instance',
        description: `mode=${mode}; pid=${pid}; worker=${testInfo.workerIndex}; DB=temporary-file`,
      });
      await use(instance);
    } finally {
      try {
        await stop();
      } finally {
        try {
          await vite?.close();
        } finally {
          if (testInfo.status !== testInfo.expectedStatus)
            await testInfo.attach('server-output', { body: output, contentType: 'text/plain' });
          await rm(directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
        }
      }
    }
  },
  baseURL: async ({ app }, use) => {
    await use(app.url);
  },
});

export { expect };
