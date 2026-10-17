export const REMOTE_ID_PREFIX = 'remote:';
export const DEFAULT_VERSION = '1.0.0';

export function normalizeVersion(value = DEFAULT_VERSION) {
  const version = String(value).trim();
  if (!/^\d+(?:\.\d+){0,2}$/.test(version) || version.length > 32) {
    throw new Error('Version must be a number such as 1, 1.2, or 1.2.0');
  }
  return version;
}

export function isRemoteRule(rule) {
  return rule?.readOnly === true || String(rule?.id ?? '').startsWith(REMOTE_ID_PREFIX);
}

function canonicalPair(pair) {
  return {
    id: pair.id || '',
    urlPattern: pair.urlPattern || '',
    urlOperator: pair.urlOperator || 'Contains',
    method: pair.method || '',
    caseSensitive: pair.caseSensitive ?? false,
    gqlOperation: pair.gqlOperation || '',
    redirectUrl: pair.redirectUrl || '',
  };
}

function canonicalRequest(rule, firstPair) {
  if (rule.request) {
    return {
      type: rule.request.type || 'static',
      body: rule.request.body || '',
      customHeaders: rule.request.customHeaders || '',
    };
  }
  return legacyRequest(rule, firstPair);
}

function legacyRequest(rule, firstPair) {
  const type = firstPair.requestBodyType || (firstPair.requestModifier ? 'dynamic' : 'static');
  const body = type === 'dynamic'
    ? (firstPair.requestBody || firstPair.requestModifier || '')
    : (firstPair.requestBody || '');
  return { type, body, customHeaders: rule.requestCustomHeaders || '' };
}

function canonicalResponse(rule, firstPair) {
  if (rule.response) {
    return {
      type: rule.response.type || 'static',
      body: rule.response.body || '',
      statusCode: String(rule.response.statusCode ?? ''),
      delay: parseInt(rule.response.delay) || 0,
      customHeaders: rule.response.customHeaders || '',
    };
  }
  return legacyResponse(rule, firstPair);
}

function legacyResponse(rule, firstPair) {
  return {
    type: firstPair.responseType || rule.responseType || 'static',
    body: firstPair.responseBody || rule.responseBody || '',
    statusCode: String(firstPair.statusCode ?? rule.statusCode ?? ''),
    delay: parseInt(firstPair.delay ?? rule.delay) || 0,
    customHeaders: rule.customHeaders || '',
  };
}

export function migrateRule(rule) {
  const resourceType = rule.resourceType || 'rest';
  const firstPair = rule.pairs?.[0] || {};
  const pairs = rule.pairs?.length ? rule.pairs.map(canonicalPair) : [canonicalPair({
    id: 'pair_' + (rule.id || 'migrated'),
    urlPattern: rule.urlPattern,
    urlOperator: rule.urlOperator,
    method: rule.method,
  })];
  return {
    id: rule.id,
    name: rule.name || '',
    version: normalizeVersion(rule.version ?? DEFAULT_VERSION),
    enabled: rule.enabled !== false,
    resourceType,
    resourceSubtype: resourceType === 'html' ? (rule.resourceSubtype || 'html') : undefined,
    description: rule.description || '',
    pairs,
    request: canonicalRequest(rule, firstPair),
    response: canonicalResponse(rule, firstPair),
  };
}

export function portableRule(rule) {
  const id = isRemoteRule(rule) ? 'copy:' + rule.id : rule.id;
  return migrateRule({ ...rule, id });
}

export function remoteRuleId(sourceId, publisherRuleId) {
  return `${REMOTE_ID_PREFIX}${sourceId}:${encodeURIComponent(publisherRuleId)}`;
}

export function sourceRuleEnabled(source, rule) {
  const overrides = source.enabledOverrides ?? {};
  if (Object.hasOwn(overrides, rule.id) && typeof overrides[rule.id] === 'boolean') return overrides[rule.id];
  return rule.enabled !== false;
}

export function materializeSourceRules(source) {
  return source.rules.map(rule => ({
    ...migrateRule(rule),
    id: remoteRuleId(source.id, rule.id),
    enabled: sourceRuleEnabled(source, rule),
    readOnly: true,
    sourceId: source.id,
    sourceRuleId: rule.id,
    sourceName: source.name,
    sourceUrl: source.url,
  }));
}
