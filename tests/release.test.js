import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { packageRelease, projectRoot, releaseFileNames } from '../scripts/package-release.mjs';

const testDirectory = resolve(projectRoot, '.artifacts/release-tests');
mkdirSync(testDirectory, { recursive: true });

function fixture(t) {
  const root = mkdtempSync(join(testDirectory, 'fixture-'));
  t.after(() => {
    assert.equal(dirname(root), testDirectory);
    rmSync(root, { recursive: true, force: true });
  });
  for (const name of [...releaseFileNames(), 'package.json', 'scripts/release-files.json']) {
    const destination = join(root, name);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(projectRoot, name), destination);
  }
  return root;
}

function writeJSON(root, name, value) {
  writeFileSync(join(root, name), JSON.stringify(value));
}

test('release ZIP contains only opted-in runtime files and licenses, with manifest at root', t => {
  const root = fixture(t);
  for (const name of ['AGENTS.md', 'README.md', '.env', 'private-rules.json', 'popup/debug.js', 'popup/private-rules.json']) {
    writeFileSync(join(root, name), 'DO NOT SHIP: synthetic development fixture');
  }
  const version = JSON.parse(readFileSync(join(root, 'manifest.json'))).version;
  const result = packageRelease({ root, tag: 'v' + version });
  const archive = readFileSync(result.zipPath);
  const entries = unzipSync(archive);
  assert.deepEqual(Object.keys(entries).sort(), releaseFileNames());
  assert.equal(JSON.parse(Buffer.from(entries['manifest.json'])).version, version);
  for (const [name, bytes] of Object.entries(entries)) {
    assert.ok(Buffer.from(bytes).equals(readFileSync(join(root, name))), `Changed release file: ${name}`);
  }
  const digest = createHash('sha256').update(archive).digest('hex');
  assert.equal(readFileSync(result.checksumPath, 'utf8'), `${digest}  sfv-interceptor-v${version}.zip\n`);
  for (const name of ['shared/fonts/Manrope-LICENSE.txt', 'dashboard/editor/codemirror-LICENSE.txt', 'shared/vendor/prettier/LICENSE', 'shared/vendor/terser/LICENSE']) {
    assert.ok(entries[name], `Missing bundled license: ${name}`);
  }
});

test('release ZIP bytes are reproducible even when source timestamps change', t => {
  const root = fixture(t);
  const first = readFileSync(packageRelease({ root }).zipPath);
  utimesSync(join(root, 'background.js'), new Date(2025, 0, 1), new Date(2026, 9, 17));
  const second = readFileSync(packageRelease({ root }).zipPath);
  assert.ok(first.equals(second));
});

test('release refuses a missing file before writing an archive', t => {
  const root = fixture(t);
  unlinkSync(join(root, 'shared/fonts/manrope-latin-wght-normal.woff2'));
  assert.throws(() => packageRelease({ root }), /ENOENT.*manrope/i);
  assert.equal(existsSync(join(root, 'dist')), false);
});

test('release refuses missing dynamic dependencies even when their source files exist', t => {
  const root = fixture(t);
  writeJSON(root, 'scripts/release-files.json', releaseFileNames().filter(name => name !== 'shared/vendor/terser/terser.mjs'));
  assert.throws(() => packageRelease({ root }), /Missing release dependency: dashboard\/editor\/compact.js -> shared\/vendor\/terser\/terser.mjs/);
  assert.equal(existsSync(join(root, 'dist')), false);
});

test('release requires matching package, Chrome manifest and tag versions', t => {
  const root = fixture(t);
  assert.throws(() => packageRelease({ root, tag: 'v999.0.0' }), /Release tag must be/);
  const packageJSON = JSON.parse(readFileSync(join(root, 'package.json')));
  writeJSON(root, 'package.json', { ...packageJSON, version: '999.0.0' });
  assert.throws(() => packageRelease({ root }), /versions must match/);
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json')));
  for (const version of ['1.3.65536', '01.3.0', '0.0.0', '1.3.0-beta']) {
    writeJSON(root, 'manifest.json', { ...manifest, version });
    assert.throws(() => packageRelease({ root }), /Chrome-compatible/);
  }
  assert.equal(existsSync(join(root, 'dist')), false);
});

test('release paths reject traversal, hidden paths and case-insensitive collisions', t => {
  const root = fixture(t);
  for (const path of ['../private.json', '/absolute.js', 'C:\\private.js', 'popup/../private.json', '.env', 'popup/.secret', 'popup//popup.js']) {
    writeJSON(root, 'scripts/release-files.json', [path]);
    assert.throws(() => releaseFileNames(root), /Invalid release path/);
  }
  writeJSON(root, 'scripts/release-files.json', ['manifest.json', 'MANIFEST.json']);
  assert.throws(() => releaseFileNames(root), /Duplicate release path/);
});

test('release refuses directory links that resolve outside its source tree', t => {
  const root = fixture(t);
  const outside = fixture(t);
  const popupDirectory = join(root, 'popup');
  assert.equal(dirname(popupDirectory), root);
  rmSync(popupDirectory, { recursive: true });
  symlinkSync(join(outside, 'popup'), popupDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => packageRelease({ root }), /escapes the project/);
  assert.equal(existsSync(join(root, 'dist')), false);
});
