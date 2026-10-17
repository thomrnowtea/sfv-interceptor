import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const skip = new Set(['.git', 'node_modules', '.claude', '.codex', '.artifacts', 'dist', 'test-results', 'playwright-report']);
function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (skip.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

const files = filesIn('.').filter(path => /\.(?:js|mjs)$/.test(path));
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(file, result.stderr);
    failed = true;
  }
}
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
if (!manifest.permissions.includes('alarms')) throw new Error('Remote synchronization requires the alarms permission');
if (failed) process.exitCode = 1;
else console.log(`Syntax checked ${files.length} JavaScript files; manifest is valid.`);
