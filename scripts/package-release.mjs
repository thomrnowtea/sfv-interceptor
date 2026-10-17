import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { validateReleaseReferences } from './release/references.mjs';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function releaseFileNames(root = projectRoot) {
  const names = JSON.parse(readFileSync(join(root, 'scripts/release-files.json'), 'utf8'));
  if (!Array.isArray(names) || !names.length) throw new Error('Release file list must be a nonempty array.');
  const seen = new Set();
  for (const name of names) {
    if (typeof name !== 'string' || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(name)) {
      throw new Error(`Invalid release path: ${name}`);
    }
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate release path: ${name}`);
    seen.add(key);
  }
  return names.sort();
}

function readReleaseFile(root, name) {
  const path = join(root, name);
  if (!lstatSync(path).isFile()) throw new Error(`Release entry must be a regular file: ${name}`);
  const resolved = relative(root, realpathSync(path));
  if (resolved === '..' || resolved.startsWith('..' + sep) || isAbsolute(resolved)) {
    throw new Error(`Release entry escapes the project: ${name}`);
  }
  return readFileSync(path);
}

function releaseVersion(root, manifest, tag) {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(manifest.version)
      || manifest.version === '0.0.0' || manifest.version.split('.').some(part => Number(part) > 65535)) {
    throw new Error('Release version must be a Chrome-compatible X.Y.Z version.');
  }
  if (version !== manifest.version) throw new Error('package.json and manifest.json versions must match.');
  if (tag !== undefined && tag !== 'v' + version) throw new Error(`Release tag must be v${version}; received ${tag}.`);
  return version;
}

export function packageRelease({ root = projectRoot, outputDirectory, tag } = {}) {
  root = realpathSync(root);
  const files = new Map(releaseFileNames(root).map(name => [name, readReleaseFile(root, name)]));
  if (!files.has('manifest.json')) throw new Error('Release must contain manifest.json at its root.');
  const manifest = JSON.parse(files.get('manifest.json').toString('utf8'));
  const version = releaseVersion(root, manifest, tag);
  validateReleaseReferences(files, manifest);
  // Fixed metadata + sorted paths make unchanged inputs byte-for-byte reproducible.
  const archive = zipSync(Object.fromEntries(files), {
    level: 9, mtime: new Date(2000, 0, 1), os: 3, attrs: 0o100644 << 16,
  });
  const filename = `sfv-interceptor-v${version}.zip`;
  const output = resolve(outputDirectory ?? join(root, 'dist'));
  mkdirSync(output, { recursive: true });
  const zipPath = join(output, filename);
  const checksumPath = zipPath + '.sha256';
  const checksum = createHash('sha256').update(archive).digest('hex');
  writeFileSync(zipPath, archive);
  writeFileSync(checksumPath, `${checksum}  ${filename}\n`);
  return { version, zipPath, checksumPath, checksum, fileCount: files.size, bytes: archive.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--tag')) throw new Error('Usage: npm run package -- [--tag vX.Y.Z]');
    const result = packageRelease({ tag: args[1] });
    console.log(`Packaged ${result.fileCount} files (${result.bytes.toLocaleString('en-US')} bytes): ${result.zipPath}`);
    console.log(`SHA-256: ${result.checksumPath}`);
  } catch (error) {
    console.error('Release packaging failed:', error.message);
    process.exitCode = 1;
  }
}
