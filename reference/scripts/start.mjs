import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { root } from './lib.mjs';

const child = spawn('dotnet', [resolve(root, 'dist/server/App.dll')], {
  cwd: root,
  stdio: ['pipe', 'inherit', 'inherit'],
  env: { ...process.env, AIDD_CONTROL_STDIN: '1' },
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  if (child.stdin && !child.stdin.destroyed) child.stdin.write('shutdown\n');
  else child.kill('SIGTERM');
}
child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) process.exitCode = 1;
  else process.exitCode = code ?? 1;
});
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
