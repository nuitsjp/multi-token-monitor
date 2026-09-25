import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { root, run } from './lib.mjs';

rmSync(join(root, 'dist/backend'), { recursive: true, force: true });
await run('dotnet', [
  'build',
  'backend/App.csproj',
  '--no-restore',
  '-p:SkipFrontendBuild=true',
  '-o',
  'dist/backend',
]);
