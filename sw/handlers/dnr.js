import { getRules } from '../core/rules.js';
import { pairToRegexFilter } from '../core/matcher.js';
import { clearAssetCaches } from '../cache/assets.js';

export function stableId(ruleId, pairId) {
  const str = ruleId + '\x00' + pairId;
  let h1 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h1 ^= str.charCodeAt(i); h1 = Math.imul(h1, 0x01000193) >>> 0; }
  let h2 = 5381;
  for (let i = 0; i < str.length; i++) { h2 = (Math.imul(h2, 33) ^ str.charCodeAt(i)) >>> 0; }
  return ((h1 ^ h2) % 2147483646) + 1;
}

export async function rebuildDNR() {
  const rules = await getRules();
  const toAdd = [];
  for (const rule of rules) {
    if (rule.enabled === false || rule.resourceType !== 'html') continue;
    const sub = rule.resourceSubtype || 'js';
    if (sub === 'html') continue;
    const dnrTypes = sub === 'css' ? ['stylesheet'] : ['script'];
    for (const pair of (rule.pairs || [])) {
      const pat = pair.urlPattern || '';
      if (!pat) continue;
      const regexFilter = pairToRegexFilter(pair);
      if (!regexFilter) continue;
      toAdd.push({
        id:       stableId(rule.id, pair.id),
        priority: 1,
        action:   { type: 'block' },
        condition: { regexFilter, resourceTypes: dnrTypes, isUrlFilterCaseSensitive: pair.caseSensitive || false },
      });
    }
  }
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map(r => r.id),
      addRules:      toAdd,
    });
    console.log('[SFV-I SW] DNR:', toAdd.length, 'block rule(s)');
    clearAssetCaches();
  } catch(e) { console.error('[SFV-I SW] DNR failed:', e.message); }
}
