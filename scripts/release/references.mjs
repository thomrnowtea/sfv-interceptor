// Development-only validation. None of this module is shipped in the extension.
import { posix } from 'node:path';
import { parse } from 'acorn';

function* syntaxNodes(root) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    yield node;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) pending.push(...value.filter(child => child?.type));
      else if (value?.type) pending.push(value);
    }
  }
}

function* scriptReferences(text) {
  const imports = new Set(['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ImportExpression']);
  for (const node of syntaxNodes(parse(text, { ecmaVersion: 'latest', sourceType: 'module' }))) {
    if (imports.has(node.type) && typeof node.source?.value === 'string') {
      yield { path: node.source.value };
    }
    if (node.type === 'CallExpression' && node.callee?.property?.name === 'getURL' && typeof node.arguments[0]?.value === 'string') {
      yield { path: node.arguments[0].value, root: true };
    }
  }
}

function* documentReferences(name, text) {
  if (name.endsWith('.html')) {
    for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) yield { path: match[1] };
  }
  if (name.endsWith('.css')) {
    for (const match of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)) yield { path: match[1] };
  }
}

function manifestReferences(manifest) {
  return [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    ...(manifest.sandbox?.pages ?? []),
    ...(manifest.content_scripts ?? []).flatMap(script => [...(script.js ?? []), ...(script.css ?? [])]),
    ...(manifest.web_accessible_resources ?? []).flatMap(group => group.resources),
  ].filter(Boolean).map(path => ({ path, root: true }));
}

function requireReference(files, owner, reference) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference.path)) return;
  const path = reference.path.split(/[?#]/, 1)[0];
  if (!path) return;
  const target = reference.root ? path : posix.join(posix.dirname(owner), path);
  // Manifest resources may contain wildcards; exact paths are checked as well.
  const pattern = new RegExp('^' + target.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  if (![...files.keys()].some(name => pattern.test(name))) {
    throw new Error(`Missing release dependency: ${owner} -> ${target}. Update scripts/release-files.json.`);
  }
}

export function validateReleaseReferences(files, manifest) {
  for (const reference of manifestReferences(manifest)) requireReference(files, 'manifest.json', reference);
  for (const [name, bytes] of files) {
    const text = bytes.toString('utf8');
    const references = /\.(?:js|mjs)$/.test(name) ? scriptReferences(text) : documentReferences(name, text);
    for (const reference of references) requireReference(files, name, reference);
  }
}
