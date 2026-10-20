import { getRules } from '../core/rules.js';
import { pairToRegexFilter } from '../core/matcher.js';
import { clearAssetCaches } from '../cache/assets.js';
import { fileRuleId, isFileRule } from '../core/file-rules.js';

function dynamicRule(rule, pair) {
  const regexFilter = pairToRegexFilter(pair);
  if (!regexFilter) return null;
  return {
    id: fileRuleId(rule.id, pair.id),
    priority: 1,
    action: { type: 'block' },
    condition: {
      regexFilter,
      resourceTypes: rule.resourceSubtype === 'css' ? ['stylesheet'] : ['script'],
      isUrlFilterCaseSensitive: pair.caseSensitive,
    },
  };
}

function dynamicRules(rules) {
  return rules.filter(isFileRule).flatMap(rule => rule.pairs.map(pair => dynamicRule(rule, pair)).filter(Boolean));
}

async function removeObsoleteRules(existing, desired) {
  const desiredIds = new Set(desired.map(rule => rule.id));
  const obsolete = existing.filter(rule => !desiredIds.has(rule.id)).map(rule => rule.id);
  if (obsolete.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: obsolete, addRules: [] });
  }
}

export async function rebuildDNR(options) {
  const toAdd = dynamicRules(await getRules());
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map(r => r.id),
      addRules:      toAdd,
    });
    console.log('[SFV-I SW] DNR:', toAdd.length, 'block rule(s)');
    if (options?.preserveAssetCache !== true) clearAssetCaches();
  } catch (error) {
    // Even if applying additions fails, remove blockers belonging to deleted
    // rules so unsubscribed sources cannot keep blocking files.
    await removeObsoleteRules(existing, toAdd);
    throw new Error('Could not apply file interception rules: ' + error.message);
  }
}
