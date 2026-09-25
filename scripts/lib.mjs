import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
export const root = fileURLToPath(new URL('../', import.meta.url));
// 配布元の拡張と、共通資材を配置済みの採用プロジェクトを区別する。
export const isTemplateSource =
  basename(root) === 'reference' &&
  basename(resolve(root, '..')) === 'react-dotnet-template' &&
  existsSync(resolve(root, '../../scripts/init-template.mjs')) &&
  existsSync(resolve(root, '../../template/scripts/doc_check.py'));
export function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(' ')} failed (${code ?? signal})`)),
    );
  });
}
// npm.cmd は cmd.exe を要する。引数はすべて本リポジトリのスクリプトが固定した値であり、shell: true と引数配列の併用（DEP0190）は避ける。
export const npm = (...args) =>
  process.platform === 'win32'
    ? run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`])
    : run('npm', args);
