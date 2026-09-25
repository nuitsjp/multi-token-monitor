import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';
import { root, run } from './lib.mjs';

const output = join(root, 'dist/contracts');
mkdirSync(output, { recursive: true });
await run('dotnet', [
  'build',
  'backend/App.csproj',
  '--no-restore',
  '-p:SkipFrontendBuild=true',
  '-o',
  'dist/contracts/backend',
]);
const schemaPath = join(output, 'openapi.json');
await run('dotnet', [join(output, 'backend/App.dll'), 'openapi', schemaPath]);
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const generated = astToString(await openapiTS(schema));
const files = [
  ['contracts/openapi.json', `${JSON.stringify(schema, null, 2)}\n`],
  ['contracts/api.gen.ts', generated],
];
for (const [path, content] of files) {
  if (process.argv.includes('--check')) {
    if (
      readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n') !==
      content.replaceAll('\r\n', '\n')
    )
      throw new Error(
        `${path} がC#のAPI定義と一致しません。mise run contracts を実行してください。`,
      );
  } else {
    writeFileSync(join(root, path), content);
  }
}
console.log(
  process.argv.includes('--check')
    ? 'API契約の一致を確認しました。'
    : 'OpenAPIとReact用の型を生成しました。',
);
