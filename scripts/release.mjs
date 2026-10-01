import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function parseVersion(value) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) throw new Error(`正式版のバージョンを指定してください: ${value}`);
  const numbers = match.slice(1).map(Number);
  if (!numbers.every(Number.isSafeInteger)) throw new Error('バージョン番号が大きすぎます。');
  return numbers;
}

function compare(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

try {
  const args = process.argv.slice(2);
  if (!args.length && process.env.usage_version) args.push(process.env.usage_version);
  if (args.length > 1) throw new Error('使い方: mise run release [vX.Y.Z]');
  const requested = args.length ? parseVersion(args[0]) : undefined;
  if (git('status', '--porcelain')) throw new Error('変更をコミットしてから発行してください。');
  git('rev-parse', '--verify', 'HEAD');
  git('fetch', 'origin', '--tags');
  let latest = parseVersion(JSON.parse(readFileSync('package.json', 'utf8')).version);
  for (const tag of git('tag', '--list').split('\n')) {
    if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) continue;
    const version = parseVersion(tag);
    if (compare(version, latest) > 0) latest = version;
  }
  const version = requested ?? [latest[0], latest[1], latest[2] + 1];
  if (!version.every(Number.isSafeInteger)) throw new Error('バージョン番号が大きすぎます。');
  if (compare(version, latest) < 0) throw new Error('現在のバージョンより古い版は発行できません。');
  const tag = `v${version.join('.')}`;
  if (git('tag', '--list', tag)) throw new Error(`タグは既に存在します: ${tag}`);
  git('tag', '-a', tag, '-m', `Release ${tag}`);
  try {
    git('push', 'origin', `refs/tags/${tag}`);
  } catch (error) {
    throw new Error(
      `${error.message}\nローカルタグは保持しています。git push origin ${tag} で再試行してください。`,
    );
  }
  console.log(`${tag} をpushしました。タグ起点のCIが検証後にGitHub Releaseを公開します。`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
