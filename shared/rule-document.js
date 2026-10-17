import { migrateRule, portableRule } from './rule-schema.js';
import { fromRQ } from './converters.js';

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertText(value, label) {
  if (value != null && typeof value !== 'string') throw new Error(`${label} must be text`);
}

function validatePair(pair) {
  assertObject(pair, 'URL pattern');
  for (const field of ['id', 'urlPattern', 'urlOperator', 'method', 'gqlOperation', 'redirectUrl']) {
    assertText(pair[field], field);
  }
  if (!['Contains', 'Equals', 'Wildcard', 'Regex'].includes(pair.urlOperator ?? 'Contains')) {
    throw new Error('Unsupported URL operator');
  }
  if (pair.caseSensitive !== undefined && typeof pair.caseSensitive !== 'boolean') {
    throw new Error('caseSensitive must be a boolean');
  }
  if (pair.urlOperator === 'Regex') new RegExp(pair.urlPattern);
}

function validateBody(body, label) {
  if (body === undefined) return;
  assertObject(body, label);
  if (!['static', 'dynamic'].includes(body.type ?? 'static')) throw new Error(`Invalid ${label} type`);
  assertText(body.body, `${label} body`);
  assertText(body.customHeaders, `${label} headers`);
}

function validateRule(input) {
  assertObject(input, 'Rule');
  for (const field of ['id', 'name', 'description', 'resourceType', 'resourceSubtype', 'urlPattern']) {
    assertText(input[field], field);
  }
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('enabled must be a boolean');
  if (!['rest', 'graphql', 'html'].includes(input.resourceType ?? 'rest')) throw new Error('Unsupported resource type');
  if (input.resourceSubtype !== undefined && !['html', 'css', 'js'].includes(input.resourceSubtype)) {
    throw new Error('Unsupported resource subtype');
  }
  if (input.pairs !== undefined && !Array.isArray(input.pairs)) throw new Error('pairs must be an array');
  for (const pair of input.pairs ?? []) validatePair(pair);
  validateBody(input.request, 'request');
  validateBody(input.response, 'response');
}

function parseRule(input, index, requireIds) {
  assertObject(input, `Rule ${index + 1}`);
  const converted = input.objectType === 'rule' || input.ruleType ? fromRQ(input) : input;
  // The publisher's identity is mandatory for subscriptions, even for legacy JSON.
  if (requireIds && (typeof input.id !== 'string' || !input.id.trim())) {
    throw new Error(`Rule ${index + 1} needs a stable id for synchronization`);
  }
  validateRule(converted);
  const rule = migrateRule(converted);
  rule.pairs.forEach((pair, pairIndex) => {
    if (!pair.id) pair.id = `pair_${pairIndex + 1}`;
  });
  if (new Set(rule.pairs.map(pair => pair.id)).size !== rule.pairs.length) throw new Error('Duplicate pair IDs in rule');
  return requireIds ? rule : portableRule(rule);
}

export function parseRuleDocument(document, { requireIds = false } = {}) {
  const input = Array.isArray(document) ? document : document?.rules;
  if (!Array.isArray(input)) throw new Error('Expected a JSON array or an object with a rules array');
  const rules = input.map((rule, index) => parseRule(rule, index, requireIds));
  const ids = rules.map(rule => rule.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate rule IDs in JSON');
  return rules;
}

export function validateSourceUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error('Enter a valid HTTPS source URL'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS URL without embedded credentials');
  url.hash = '';
  return url.href;
}

function validEtag(value) {
  if (typeof value !== 'string' || value.length > 1024) return '';
  return /^(?:W\/)?"[\x21\x23-\x7e]*"$/.test(value) ? value : '';
}

async function responseDocument(response) {
  try { return await response.json(); }
  catch { throw new Error('The URL must respond directly with rule JSON (an array or an object with a rules array)'); }
}

function unchangedSnapshot(response, etag) {
  if (!etag) throw new Error('Received HTTP 304 without a saved snapshot. Try syncing again.');
  return { notModified: true, etag: validEtag(response.headers.get('ETag')) || etag };
}

export async function fetchRuleSnapshot(url, { signal, requireIds = false, etag = '' } = {}) {
  const cachedEtag = validEtag(etag);
  const headers = { Accept: 'application/json' };
  if (cachedEtag) headers['If-None-Match'] = cachedEtag;
  const response = await fetch(validateSourceUrl(url), {
    signal,
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers,
  });
  if (response.url) validateSourceUrl(response.url);
  if (response.status === 304) return unchangedSnapshot(response, cachedEtag);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const rules = parseRuleDocument(await responseDocument(response), { requireIds });
  signal?.throwIfAborted();
  return { rules, etag: validEtag(response.headers.get('ETag')) };
}

export async function fetchRuleDocument(url, options = {}) {
  // A one-time import always downloads its own document; it has no cached snapshot.
  const { rules } = await fetchRuleSnapshot(url, { signal: options.signal, requireIds: options.requireIds });
  return rules;
}
