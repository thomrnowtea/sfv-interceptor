const resourceTypes = new Map([['graphqlApi', 'graphql'], ['staticFile', 'html']]);

function requestlyPair(pair, index) {
  const source = pair.source || {};
  const methodFilter = source.filters?.find(filter => filter.requestMethod);
  return {
    id: pair.id || ('pair_' + (index + 1)),
    urlPattern: source.value || '',
    urlOperator: source.operator === 'Wildcard_Matches' ? 'Wildcard' : (source.operator || 'Contains'),
    method: methodFilter?.requestMethod?.[0] || '',
    caseSensitive: false, gqlOperation: '', redirectUrl: '',
  };
}

function requestlyResponse(rule, response) {
  const script = rule.ruleType === 'Script';
  return {
    type: script || response.type === 'code' ? 'dynamic' : 'static',
    body: script ? (rule.pairs?.[0]?.scripts?.[0]?.value || '') : (response.value || ''),
    statusCode: response.statusCode || '', delay: 0, customHeaders: '',
  };
}

export function fromRQ(rq) {
  const firstPair = rq.pairs?.[0] || {};
  const firstResp = firstPair.response || {};

  return {
    id:           rq.id || ('rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
    name:         rq.name || 'Imported',
    version:      rq.version ?? '1.0.0',
    enabled:      rq.status !== 'Inactive',
    resourceType: resourceTypes.get(firstResp.resourceType) || 'rest',
    description:  rq.description || '',
    pairs:        (rq.pairs || [firstPair]).map(requestlyPair),
    request:  { type: 'static', body: '', customHeaders: '' },
    response: requestlyResponse(rq, firstResp),
  };
}
