import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { isTemplateSource, root } from './lib.mjs';
const target = join(root, 'release/app');
if (existsSync(target))
  throw new Error('release/app が既にあります。内容を確認し別名へ移動してから実行してください。');
mkdirSync(target, { recursive: true });
cpSync(join(root, 'dist/server'), target, { recursive: true });
const license = isTemplateSource
  ? resolve(root, '../../LICENSE')
  : basename(root) === 'reference'
    ? resolve(root, '../LICENSE')
    : resolve(root, 'LICENSE');
cpSync(license, join(target, 'LICENSE'));
console.log(
  'release/app を配備しました。環境変数を設定し、dotnet App.dll を実行してください。dataは配備領域の外へ置いてください。',
);
