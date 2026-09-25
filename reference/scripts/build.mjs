import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { root, run } from './lib.mjs';
rmSync(join(root, 'dist/server'), { recursive: true, force: true });
await run('dotnet', [
  'publish',
  'backend/App.csproj',
  '-c',
  'Release',
  '-o',
  'dist/server',
  '--no-restore',
]);
console.log('ビルド完了。mise run start で同梱UIとAPIを同じoriginで起動します。');
