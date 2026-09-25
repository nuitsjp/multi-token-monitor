import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isTemplateSource, root, run } from './lib.mjs';

if (isTemplateSource) {
  // 共通文書は正本へ複製せず、配布と同じ重ね合わせで検査する。
  const temporary = mkdtempSync(join(tmpdir(), 'aidd-dotnet-docs-'));
  const project = join(temporary, 'app');
  try {
    await run(process.execPath, [
      resolve(root, '../../scripts/init-template.mjs'),
      'react-dotnet',
      project,
      '--name',
      'Template.Project',
    ]);
    await run(process.env.PYTHON ?? 'python', ['scripts/doc_check.py', 'reference'], {
      cwd: project,
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
} else {
  await run(process.env.PYTHON ?? 'python', ['../scripts/doc_check.py', '.']);
}
