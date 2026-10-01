import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const source = new URL('../../scripts/release.mjs', import.meta.url);

test('mise forwards the optional version and supports automatic numbering', (t) => {
  const { repository, git } = fixture(t);
  mkdirSync(join(repository, 'scripts'));
  copyFileSync(source, join(repository, 'scripts/release.mjs'));
  const task = readFileSync(new URL('../../mise.toml', import.meta.url), 'utf8')
    .split('[tasks.release]')[1]
    .split('\n[tasks.')[0];
  writeFileSync(join(repository, 'mise.toml'), `[tasks.release]${task}`);
  git('add', '.');
  git('commit', '-m', 'Mise task');
  for (const [args, tag] of [
    [['0.3.0'], 'v0.3.0'],
    [[], 'v0.3.1'],
  ]) {
    const result = spawnSync('mise', ['run', 'release', ...args], {
      cwd: repository,
      env: { ...process.env, MISE_TRUSTED_CONFIG_PATHS: repository },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`), new RegExp(tag));
  }
});

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'release-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repository = join(directory, 'repository');
  const remote = join(directory, 'remote.git');
  mkdirSync(repository);
  function git(...args) {
    const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git('init', '--bare', remote);
  git('init');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release-test@example.invalid');
  git('remote', 'add', 'origin', remote);
  copyFileSync(source, join(repository, 'release.mjs'));
  writeFileSync(join(repository, 'package.json'), '{"version":"0.1.0"}\n');
  git('add', '.');
  git('commit', '-m', 'Fixture');
  function release(...args) {
    return spawnSync(process.execPath, ['release.mjs', ...args], {
      cwd: repository,
      encoding: 'utf8',
    });
  }
  return { repository, remote, git, release };
}

test('automatic patch versions and explicit versions publish annotated tags at HEAD', (t) => {
  const { git, release } = fixture(t);
  for (const [args, tag] of [
    [[], 'v0.1.1'],
    [['0.2.0'], 'v0.2.0'],
    [[], 'v0.2.1'],
  ]) {
    const result = release(...args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git('cat-file', '-t', tag), 'tag');
    assert.equal(git('rev-parse', `${tag}^{commit}`), git('rev-parse', 'HEAD'));
    assert.match(git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`), new RegExp(tag));
  }
});

test('remote tags determine the next patch even when absent locally', (t) => {
  const { git, release } = fixture(t);
  git('tag', 'v0.1.9');
  git('push', 'origin', 'v0.1.9');
  git('tag', '-d', 'v0.1.9');
  const result = release();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /v0\.1\.10/);
  assert.match(git('ls-remote', '--tags', 'origin', 'refs/tags/v0.1.10'), /v0\.1\.10/);
});

test('invalid, duplicate and older versions do not publish extra tags', (t) => {
  const { git, release } = fixture(t);
  assert.equal(release('v0.1.0').status, 0);
  const before = git('ls-remote', '--tags', 'origin');
  for (const args of [
    ['v0.1.0'],
    ['0.0.9'],
    ['01.2.3'],
    ['0.1.1-rc.1'],
    ['--force'],
    ['1.2.3', 'extra'],
  ]) {
    assert.notEqual(release(...args).status, 0);
    assert.equal(git('ls-remote', '--tags', 'origin'), before);
  }
});

test('uncommitted changes prevent tag creation', (t) => {
  const { repository, git, release } = fixture(t);
  writeFileSync(join(repository, 'package.json'), '{"version":"0.2.0"}\n');
  assert.notEqual(release().status, 0);
  assert.equal(git('tag', '--list'), '');
  assert.equal(git('ls-remote', '--tags', 'origin'), '');
});

test('a rejected push preserves the local tag and reports how to retry', (t) => {
  const { remote, git, release } = fixture(t);
  writeFileSync(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const result = release();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /git push origin v0\.1\.1/);
  assert.equal(git('tag', '--list'), 'v0.1.1');
  assert.equal(git('ls-remote', '--tags', 'origin'), '');
});

test(
  'Linux package uses the release tag and rejects a tag pointing elsewhere',
  { skip: process.platform !== 'linux' },
  (t) => {
    const { repository, git } = fixture(t);
    git('tag', 'v0.1.0');
    mkdirSync(join(repository, 'scripts'));
    copyFileSync(
      new URL('../../scripts/package-linux.sh', import.meta.url),
      join(repository, 'scripts/package-linux.sh'),
    );
    writeFileSync(join(repository, 'LICENSE'), 'Test license');
    git('add', '.');
    git('commit', '-m', 'Packaging');
    git('tag', 'v0.2.0');
    mkdirSync(join(repository, 'dist/server/wwwroot'), { recursive: true });
    writeFileSync(join(repository, 'dist/server/MultiTokenMonitor.dll'), 'Fixture');
    writeFileSync(join(repository, 'dist/server/wwwroot/index.html'), '<html></html>');
    const pack = (version) =>
      spawnSync('bash', ['scripts/package-linux.sh'], {
        cwd: repository,
        env: { ...process.env, RELEASE_VERSION: version },
        encoding: 'utf8',
      });
    const result = pack('v0.2.0');
    assert.equal(result.status, 0, result.stderr);
    const archive = join(repository, 'dist/package/token-monitor-analytics-linux-x64.tar.gz');
    const manifest = spawnSync('tar', ['-xOf', archive, './release.json'], { encoding: 'utf8' });
    assert.equal(manifest.status, 0, manifest.stderr);
    assert.deepEqual(JSON.parse(manifest.stdout), {
      version: 'v0.2.0',
      revision: git('rev-parse', 'HEAD'),
      platform: 'linux-x64',
    });
    const checksum = readFileSync(`${archive}.sha256`, 'utf8').split(' ')[0];
    assert.equal(checksum, createHash('sha256').update(readFileSync(archive)).digest('hex'));
    assert.notEqual(pack('v0.1.0').status, 0);
  },
);
