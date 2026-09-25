import { existsSync, copyFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { npm, root, run } from './lib.mjs';
const expectedNode = readFileSync(join(root, '.nvmrc'), 'utf8').trim();
if (process.versions.node !== expectedNode)
  throw new Error(`Node.js ${expectedNode}が必要です（実行中: ${process.versions.node}）。`);
const miseName = process.platform === 'win32' ? 'mise.exe' : 'mise';
const misePath = process.env.PATH.split(delimiter)
  .map((directory) => join(directory, miseName))
  .find(existsSync);
if (!misePath) throw new Error('miseがPATHに見つかりません。mise run setup から実行してください。');
const escapedMisePath = realpathSync(misePath)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');
writeFileSync(
  join(root, 'backend/mise.local.props'),
  `<Project><PropertyGroup><MiseExecutable>${escapedMisePath}</MiseExecutable></PropertyGroup></Project>\n`,
);
await npm('ci');
if (!existsSync(join(root, '.env'))) copyFileSync(join(root, '.env.example'), join(root, '.env'));
await npm('run', 'routes');
await run('dotnet', ['restore', 'App.slnx', '--locked-mode']);
console.log('起動: mise run dev ／ ブラウザ導入: mise run setup:browser');
