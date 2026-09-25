import { run, root } from './lib.mjs';
import { join } from 'node:path';

await run(process.execPath, [
  join(root, 'node_modules/@playwright/test/cli.js'),
  'install',
  ...(process.platform === 'linux' ? ['--with-deps'] : []),
  '--only-shell',
  'chromium',
]);
