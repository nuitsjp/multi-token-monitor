import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { npm, root } from './lib.mjs';

if (!existsSync(join(root, 'node_modules')))
  throw new Error(
    'npm依存が未導入です。このプロジェクトのディレクトリで mise run setup を実行してください。',
  );

await npm('run', 'contracts');
await npm('run', 'typecheck');
await npm('exec', '--', 'vite', 'build', '--config', 'frontend/vite.config.ts');
