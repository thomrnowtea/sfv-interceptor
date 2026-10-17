// Maintenance only. The unpacked extension uses the checked-in module directly.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const directory = 'shared/vendor/terser';
mkdirSync(directory, { recursive: true });
await build({
  stdin: { contents: 'export { minify } from "terser";', resolveDir: process.cwd(), sourcefile: 'terser-entry.js' },
  bundle: true, format: 'esm', platform: 'browser', target: 'chrome120',
  minify: true, legalComments: 'inline', outfile: directory + '/terser.mjs',
});
for (const [source, name] of [
  ['terser/LICENSE', 'LICENSE'],
  ['@jridgewell/source-map/LICENSE', 'source-map-LICENSE'],
  ['@jridgewell/gen-mapping/LICENSE', 'gen-mapping-LICENSE'],
  ['@jridgewell/trace-mapping/LICENSE', 'trace-mapping-LICENSE'],
  ['@jridgewell/sourcemap-codec/LICENSE', 'sourcemap-codec-LICENSE'],
  ['@jridgewell/resolve-uri/LICENSE', 'resolve-uri-LICENSE'],
]) copyFileSync('node_modules/' + source, directory + '/' + name);
