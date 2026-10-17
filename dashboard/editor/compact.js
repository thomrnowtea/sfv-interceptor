import { portableRule } from '../../shared/rule-schema.js';

let minifier;

export function compactJSON(source) {
  try { JSON.parse(source); }
  catch { return source; } // Plain-text bodies remain plain text.
  // Preserve numeric spellings, duplicate keys, property order and string escapes.
  return source.replace(/("(?:[^"\\]|\\[\s\S])*")|[ \t\r\n]+/g, (_match, string) => string ?? '');
}

export async function compactJavaScript(source, label = 'JavaScript') {
  if (!source.trim()) return '';
  minifier ??= import('../../shared/vendor/terser/terser.mjs');
  const { minify } = await minifier;
  try {
    const result = await minify(source, {
      compress: false, mangle: false, module: false,
      keep_fnames: true, keep_classnames: true,
      parse: { bare_returns: true },
      format: { comments: false, semicolons: true, beautify: false },
    });
    return result.code;
  } catch (error) {
    throw new Error(`${label}: invalid JavaScript at line ${error.line ?? '?'}, column ${error.col ?? '?'}. Fix it before saving or exporting.`);
  }
}

function isScriptResource(rule, field) {
  return field === 'response' && rule.resourceType === 'html' && rule.resourceSubtype === 'js';
}

function bodyLabel(rule, field) {
  return `${rule.name || rule.id || 'Rule'} · ${field}.body`;
}

function compactBody(rule, body, field) {
  const source = body.body;
  if (body.type === 'dynamic' || isScriptResource(rule, field)) return compactJavaScript(source, bodyLabel(rule, field));
  if (field === 'request' || rule.resourceType !== 'html') return compactJSON(source);
  return source; // HTML/CSS whitespace can be meaningful; do not rewrite it.
}

export async function compactRuleCopy(rule) {
  const copy = structuredClone(rule);
  for (const field of ['request', 'response']) {
    const body = copy[field];
    body.body = await compactBody(copy, body, field);
    body.customHeaders = compactJSON(body.customHeaders);
  }
  return copy;
}

export function compactRuleCopies(rules) {
  return Promise.all(rules.map(compactRuleCopy));
}

export async function serializeRules(rules) {
  const copies = rules.map(portableRule);
  return JSON.stringify(await compactRuleCopies(copies));
}
