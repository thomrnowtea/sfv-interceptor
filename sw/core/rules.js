const STORAGE_KEY = 'sfvi_rules';
let _cache = null;

export function migrateRule(rule) {
  if (rule.resourceType === 'html' && !rule.resourceSubtype) {
    rule = { ...rule, resourceSubtype: 'html' };
  }
  if (Array.isArray(rule.pairs) && rule.pairs.length) return rule;
  return {
    id:           rule.id,
    name:         rule.name,
    enabled:      rule.enabled,
    resourceType: rule.resourceType || 'rest',
    pairs: [{
      id:           'pair_' + (rule.id || 'migrated'),
      urlPattern:   rule.urlPattern   || '',
      urlOperator:  rule.urlOperator  || 'Contains',
      method:       rule.method       || '',
      responseType: rule.responseType || 'static',
      responseBody: rule.responseBody || '',
      statusCode:   rule.statusCode   || '',
      delay:        parseInt(rule.delay) || 0,
    }],
  };
}

export async function getRules() {
  if (_cache) return _cache;
  return new Promise(r =>
    chrome.storage.local.get([STORAGE_KEY], d => {
      _cache = (d[STORAGE_KEY] || []).map(migrateRule);
      r(_cache);
    })
  );
}

export async function saveRules(rules) {
  _cache = null;
  return new Promise(r => chrome.storage.local.set({ [STORAGE_KEY]: rules }, r));
}

export function generateId() {
  return 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

export function generatePairId() {
  return 'pair_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}
