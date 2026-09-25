import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isSource =
  existsSync(resolve(root, '../scripts/init-template.mjs')) &&
  existsSync(resolve(root, '../template/scripts/doc_check.py'));
const temporary = isSource ? mkdtempSync(join(tmpdir(), 'aidd-dotnet-docs-')) : undefined;

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

try {
  const project = isSource ? join(temporary, 'app') : root;
  if (isSource)
    run(
      process.execPath,
      [
        resolve(root, '../scripts/init-template.mjs'),
        'react-dotnet',
        project,
        '--name',
        'Template.Project',
      ],
      root,
    );
  run(process.env.PYTHON ?? 'python', ['scripts/doc_check.py', '.'], project);
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
