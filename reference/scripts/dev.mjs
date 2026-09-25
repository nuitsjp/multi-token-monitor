import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { createServer } from 'vite';
import { root, run } from './lib.mjs';

await run(process.execPath, ['scripts/contracts.mjs']);
await run(process.execPath, ['scripts/build-backend.mjs']);
const host = process.env.HOST ?? '127.0.0.1';
const port = process.env.PORT ?? '3000';
process.env.AIDD_API_URL = `http://${host === '::1' ? '[::1]' : host}:${port}`;
const vite = await createServer({
  configFile: join(root, 'frontend/vite.config.ts'),
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
let child;
let stopping;

function stop() {
  stopping ??= (async () => {
    control?.close();
    if (control) process.stdin.destroy();
    // Viteを先に閉じてSSEの接続も解放してから.NETを停止する。
    await vite.close();
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 12000);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (code !== 0 || signal)
          reject(new Error(`開発サーバーの終了に失敗しました: ${code ?? signal}`));
        else resolve();
      });
      child.stdin.write('shutdown\n');
    });
  })();
  return stopping;
}

const onStop = () => {
  void stop().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
};
process.once('SIGINT', onStop);
process.once('SIGTERM', onStop);
let control;
if (process.env.AIDD_CONTROL_STDIN === '1') {
  control = createInterface({ input: process.stdin });
  control.on('line', (line) => {
    if (line === 'shutdown') {
      control.close();
      onStop();
    }
  });
}
try {
  await vite.listen();
  const url = vite.resolvedUrls.local[0].replace(/\/$/, '');
  child = spawn('dotnet', [join(root, 'dist/backend/App.dll')], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      HOST: host,
      PORT: port,
      DEV_ORIGINS: url,
      ASPNETCORE_ENVIRONMENT: 'Development',
      AIDD_CONTROL_STDIN: '1',
    },
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('.NETの起動が期限を超えました')), 20000);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      console.log(line);
      if (line.startsWith('AIDD_READY ')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`.NETが終了しました: ${code ?? signal}`));
      if (!stopping) {
        process.exitCode = 1;
        control?.close();
        onStop();
      }
    });
  });
  console.log(`開発画面: ${url}/notes（Vite HMR + ASP.NET Core）`);
  console.log('AIDD_DEV_READY ' + JSON.stringify({ url }));
} catch (error) {
  control?.close();
  await stop();
  throw error;
}
