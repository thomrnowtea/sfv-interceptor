export function fromRQ(rq) {
  const firstPair = rq.pairs?.[0] || {};
  const firstResp = firstPair.response || {};
  let rt = 'rest';
  if (firstResp.resourceType === 'graphqlApi') rt = 'graphql';
  else if (firstResp.resourceType === 'staticFile') rt = 'html';
  const pairs = (rq.pairs || [firstPair]).map(p => {
    const s = p.source || {}, r = p.response || {};
    const mf = s.filters?.find(f => f.requestMethod);
    let rb = r.value || '', rtype = r.type === 'code' ? 'dynamic' : 'static';
    if (rq.ruleType === 'Script') { rb = rq.pairs?.[0]?.scripts?.[0]?.value || ''; rtype = 'dynamic'; }
    return {
      id:           p.id || ('pair_' + Math.random().toString(36).slice(2, 8)),
      urlPattern:   s.value || '',
      urlOperator:  s.operator === 'Wildcard_Matches' ? 'Wildcard' : (s.operator || 'Contains'),
      method:       mf?.requestMethod?.[0] || '',
      responseType: rtype, responseBody: rb,
      statusCode:   r.statusCode || '', delay: 0,
    };
  });
  return {
    id:           rq.id || ('rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
    name:         rq.name || 'Imported',
    enabled:      rq.status !== 'Inactive',
    resourceType: rt,
    description:  rq.description || '',
    pairs,
  };
}
