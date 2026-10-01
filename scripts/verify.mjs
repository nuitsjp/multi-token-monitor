import { npm, run } from './lib.mjs';
await run(process.execPath, ['--test', 'tests/release-task/release.test.mjs']);
await npm('run', 'contracts:check');
await npm('run', 'typecheck');
await npm('run', 'lint');
await npm('run', 'format:check');
await run(process.execPath, ['scripts/check-docs.mjs']);
await npm('run', 'test:core');
await npm('run', 'test:unit');
// E2Eの構成は E2E_MODES（カンマ区切り）で絞れる。既定は dev と hosted の両方。
const modes = (process.env.E2E_MODES ?? 'dev,hosted').split(',');
for (const mode of modes) {
  if (mode !== 'dev' && mode !== 'hosted')
    throw new Error(`E2E_MODESはdevまたはhostedをカンマ区切りで指定してください: ${mode}`);
  await run(process.execPath, ['scripts/test-e2e.mjs', mode]);
}
