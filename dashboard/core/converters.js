export function toRQ(rule) {
  const now = Date.now();
  const resType = rule.resourceType === 'graphql' ? 'graphqlApi'
                : rule.resourceType === 'html'    ? 'staticFile' : 'restApi';
  const pairs = (rule.pairs || []).map(p => ({
    id: p.id || Math.random().toString(36).slice(2, 7),
    response: {
      resourceType: resType, statusCode: p.statusCode || '',
      type: p.responseType === 'dynamic' ? 'code' : 'static',
      value: p.responseBody || '',
    },
    source: {
      filters: p.method ? [{ requestMethod: [p.method] }] : [],
      key: 'Url', operator: p.urlOperator || 'Contains', value: p.urlPattern || '',
    },
  }));
  return {
    createdBy: null, creationDate: now, currentOwner: null,
    description: rule.description || '', groupId: '',
    id: rule.id || ('Response_' + Math.random().toString(36).slice(2, 8)),
    isSample: false, lastModifiedBy: null, modificationDate: now,
    name: rule.name || 'Untitled', objectType: 'rule',
    pairs: pairs.length ? pairs : [{ id:'p0', response:{resourceType:resType,statusCode:'',type:'static',value:''}, source:{filters:[],key:'Url',operator:'Contains',value:''} }],
    ruleType: 'Response',
    status: rule.enabled !== false ? 'Active' : 'Inactive',
  };
}

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
