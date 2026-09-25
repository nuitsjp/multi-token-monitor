import { resolve } from 'node:path';
import { run, root } from './lib.mjs';

const [command, ...args] = process.argv.slice(2);
if (command !== 'backup' && command !== 'check')
  throw new Error(
    '使い方: npm run db:backup -- <バックアップ先> または npm run db:check -- [DB_PATH]',
  );
const path =
  command === 'check' && args.length === 0
    ? (process.env.DB_PATH ?? './data/app.sqlite')
    : undefined;
await run('dotnet', [
  resolve(root, 'dist/server/App.dll'),
  `db:${command}`,
  ...(path === undefined ? args : [path]),
]);
