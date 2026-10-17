import { urlMatchesPair, pairToRegexFilter } from './matcher.js';
import { fileRuleId } from './file-rules.js';

function appliedPair(rule, pair, applied) {
  const condition = applied.get(fileRuleId(rule.id, pair.id))?.condition;
  if (!condition) return false;
  return condition.regexFilter === pairToRegexFilter(pair) && condition.isUrlFilterCaseSensitive === pair.caseSensitive;
}

function candidateUrls(rule, pair, urls, pageUrl, applied) {
  if (rule.resourceSubtype === 'html') return urlMatchesPair(pageUrl, pair) ? [pageUrl] : [];
  if (!appliedPair(rule, pair, applied)) return [];
  const extension = rule.resourceSubtype === 'css' ? /\.css(\?|$)/i : /\.js(\?|$)/i;
  return urls.filter(url => extension.test(url) && urlMatchesPair(url, pair));
}

export function selectAssetMatches(rules, urls, pageUrl, appliedRules) {
  const applied = new Map(appliedRules.map(rule => [rule.id, rule]));
  const selected = new Map();
  const enabled = rules.filter(rule => rule.enabled !== false && rule.resourceType === 'html');
  for (const rule of enabled) {
    const isPageInject = rule.resourceSubtype === 'html';
    for (const pair of rule.pairs) {
      for (const assetUrl of candidateUrls(rule, pair, urls, pageUrl, applied)) {
        // First matching file rule wins, just as it does for REST. Page
        // injections remain independent so separate page customizations coexist.
        const key = isPageInject ? 'page:' + rule.id : assetUrl;
        if (!selected.has(key)) selected.set(key, { assetUrl, ruleId: rule.id, pairId: pair.id, isPageInject });
      }
    }
  }
  return [...selected.values()];
}
