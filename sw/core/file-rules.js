import { pairToRegexFilter } from './matcher.js';

export function fileRuleId(ruleId, pairId) {
  const value = ruleId + '\x00' + pairId;
  let first = 0x811c9dc5;
  let second = 5381;
  for (let index = 0; index < value.length; index++) {
    first = Math.imul(first ^ value.charCodeAt(index), 0x01000193) >>> 0;
    second = (Math.imul(second, 33) ^ value.charCodeAt(index)) >>> 0;
  }
  return (((first ^ second) >>> 0) % 2147483646) + 1;
}

export function isFileRule(rule) {
  return rule.enabled !== false && rule.resourceType === 'html' && rule.resourceSubtype !== 'html';
}

export async function validateFileRules(rules) {
  for (const rule of rules.filter(isFileRule)) {
    for (const pair of rule.pairs) {
      const regex = pairToRegexFilter(pair);
      if (!regex) continue;
      const result = await chrome.declarativeNetRequest.isRegexSupported({ regex, isCaseSensitive: pair.caseSensitive });
      if (!result.isSupported) throw new Error(`Unsupported file URL expression in ${rule.name}: ${result.reason}`);
    }
  }
}
