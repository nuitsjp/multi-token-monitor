import { npm, run, root } from './lib.mjs';
import { join } from 'node:path';

const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'hosted')
  throw new Error('E2Eモードはdevまたはhostedを指定してください。');
if (mode === 'dev') await npm('run', 'routes');
await run(process.execPath, [mode === 'dev' ? 'scripts/build-backend.mjs' : 'scripts/build.mjs']);
await run(
  process.execPath,
  [join(root, 'node_modules/@playwright/test/cli.js'), 'test', ...process.argv.slice(3)],
  {
    env: { ...process.env, E2E_MODE: mode },
  },
);
