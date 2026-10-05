import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser } from '@dbml/core';

// テーブル設計前の製品や DB を使わない製品には data.dbml がない。
const path = fileURLToPath(new URL('../docs/design/data.dbml', import.meta.url));
if (existsSync(path)) {
  try {
    // CHECK 制約などの現行構文は dbmlv2 の解析器だけが扱える。
    new Parser().parse(readFileSync(path, 'utf8'), 'dbmlv2');
  } catch (error) {
    if (!error.diags) throw error;
    for (const { message, location } of error.diags)
      console.error(
        `[NG] DBML: docs/design/data.dbml:${location.start.line}:${location.start.column} ${message}`,
      );
    process.exit(1);
  }
  console.log('[OK] DBML: docs/design/data.dbml を解析できる');
}
