const STORAGE_KEY = 'sfvi_rules';
let _cache = null;

function canonicalPair(p) {
  return {
    id:            p.id            || '',
    urlPattern:    p.urlPattern    || '',
    urlOperator:   p.urlOperator   || 'Contains',
    method:        p.method        || '',
    caseSensitive: p.caseSensitive ?? false,
    gqlOperation:  p.gqlOperation  || '',
    redirectUrl:   p.redirectUrl   || '',
  };
}

function canonicalRequest(rule, pair0) {
  if (rule.request) {
    return {
      type:          rule.request.type          || 'static',
      body:          rule.request.body          || '',
      customHeaders: rule.request.customHeaders || '',
    };
  }
  // Migrate from old per-pair fields
  const type = pair0.requestBodyType || (pair0.requestModifier ? 'dynamic' : 'static');
  const body = type === 'dynamic'
    ? (pair0.requestBody || pair0.requestModifier || '')
    : (pair0.requestBody || '');
  return { type, body, customHeaders: rule.requestCustomHeaders || '' };
}

function canonicalResponse(rule, pair0) {
  if (rule.response) {
    return {
      type:          rule.response.type          || 'static',
      body:          rule.response.body          || '',
      statusCode:    String(rule.response.statusCode ?? ''),
      delay:         parseInt(rule.response.delay) || 0,
      customHeaders: rule.response.customHeaders || '',
    };
  }
  // Migrate from old per-pair fields
  const type = pair0.responseType || rule.responseType || 'static';
  const body = pair0.responseBody || rule.responseBody || '';
  return {
    type,
    body,
    statusCode:    String(pair0.statusCode ?? rule.statusCode ?? ''),
    delay:         parseInt(pair0.delay ?? rule.delay) || 0,
    customHeaders: rule.customHeaders || '',
  };
}

export function migrateRule(rule) {
  const resourceType    = rule.resourceType || 'rest';
  const resourceSubtype = resourceType === 'html' ? (rule.resourceSubtype || 'html') : undefined;
  const pair0 = Array.isArray(rule.pairs) && rule.pairs.length ? rule.pairs[0] : {};

  const pairs = Array.isArray(rule.pairs) && rule.pairs.length
    ? rule.pairs.map(canonicalPair)
    : [canonicalPair({
        id:          'pair_' + (rule.id || 'migrated'),
        urlPattern:  rule.urlPattern  || '',
        urlOperator: rule.urlOperator || 'Contains',
        method:      rule.method      || '',
      })];

  return {
    id:             rule.id,
    name:           rule.name        || '',
    enabled:        rule.enabled     !== false,
    resourceType,
    resourceSubtype,
    description:    rule.description || '',
    pairs,
    request:        canonicalRequest(rule, pair0),
    response:       canonicalResponse(rule, pair0),
  };
}

export async function getRules() {
  if (_cache) return _cache;
  return new Promise((resolve, reject) =>
    chrome.storage.local.get([STORAGE_KEY], d => {
      const raw = d[STORAGE_KEY];
      if (raw != null && !Array.isArray(raw)) {
        reject(new Error('Corrupted rules storage: expected array'));
        return;
      }
      _cache = (raw || []).map(migrateRule);
      resolve(_cache);
    })
  );
}

export async function saveRules(rules) {
  _cache = null;
  return new Promise((resolve, reject) =>
    chrome.storage.local.set({ [STORAGE_KEY]: rules }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    })
  );
}

export function generateId() {
  return 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

export function generatePairId() {
  return 'pair_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}
