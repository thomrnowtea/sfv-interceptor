import { getRules, saveRules, generateId, generatePairId, migrateRule } from '../core/rules.js';
import { rebuildDNR } from './dnr.js';
import { pairToRegexFilter, urlMatchesPair } from '../core/matcher.js';
import { setIcon } from './icons.js';

const MUTATION_TYPES = new Set(['IMPORT_RULES', 'MERGE_RULES', 'SAVE_RULE', 'DELETE_RULE', 'TOGGLE_RULE']);

export async function getApiRules() {
  const rules = await getRules();
  const result = [];
  for (const rule of rules) {
    if (rule.enabled === false || rule.resourceType === 'html') continue;
    for (const pair of (rule.pairs || [])) {
      if (!pair.urlPattern) continue;
      const regexFilter = pairToRegexFilter(pair);
      if (!regexFilter) continue;
      result.push({
        id:            rule.id + '|' + pair.id,
        name:          rule.name          || '',
        regex:         regexFilter,
        method:        pair.method        || '',
        responseType:  pair.responseType  || 'static',
        responseBody:  pair.responseBody  || '',
        statusCode:    pair.statusCode    || 200,
        delay:         parseInt(pair.delay) || 0,
        gqlOperation:  pair.gqlOperation  || '',
        customHeaders: rule.customHeaders || '',
      });
    }
  }
  return result;
}

export function notifyRulesChanged() {
  chrome.runtime.sendMessage({ type: 'RULES_CHANGED' }).catch(() => {});
}

async function pushRulesToActiveTab(changedRule) {
  const apiRules = await getApiRules();
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async tab => {
    if (!tab.id || !tab.url || /^(chrome|chrome-extension|about|devtools):/.test(tab.url)) return;
    if (changedRule) {
      const tabMatches = (changedRule.pairs || []).some(pair => urlMatchesPair(tab.url, pair));
      if (!tabMatches) { if (!apiRules.length) setIcon(tab.id, false); return; }
    }
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page-hook.js'], world: 'MAIN' }); } catch {}
    try { await chrome.tabs.sendMessage(tab.id, { type: '__sfvi_push_rules__', apis: apiRules }); } catch {}
    if (!apiRules.length) setIcon(tab.id, false);
  }));
}

export function initMessaging() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      const fromExtensionPage = sender.url?.startsWith('chrome-extension://');

      if (MUTATION_TYPES.has(msg.type) && sender.tab && !fromExtensionPage) {
        sendResponse({ error: 'unauthorized' }); return;
      }

      const tabId = sender.tab?.id;
      switch (msg.type) {

        case 'GET_API_RULES': sendResponse({ rules: await getApiRules() }); break;

        case 'INJECT_HOOK': {
          if (!tabId || (sender.tab && !fromExtensionPage)) { sendResponse({ ok: false }); break; }
          try {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['page-hook.js'], world: 'MAIN' });
            sendResponse({ ok: true });
          } catch(e) { sendResponse({ ok: false, error: e.message }); }
          break;
        }

        case 'RULE_APPLIED':
          if (tabId) setIcon(tabId, true);
          sendResponse({ ok: true });
          break;

        case 'GET_RULES':    sendResponse({ rules: await getRules() }); break;
        case 'EXPORT_RULES': sendResponse({ rules: await getRules() }); break;

        case 'IMPORT_RULES':
          await saveRules(msg.rules.map(migrateRule)); await rebuildDNR();
          sendResponse({ ok: true }); break;

        case 'MERGE_RULES': {
          const existing = await getRules();
          const incoming = (msg.rules || []).map(migrateRule);
          const strategy = msg.strategy || 'skip';
          const merged   = [...existing];
          let added = 0, updated = 0, skipped = 0;
          for (const r of incoming) {
            const idx = merged.findIndex(e => e.id === r.id);
            if (idx >= 0) {
              if (strategy === 'overwrite') { merged[idx] = r; updated++; }
              else skipped++;
            } else { merged.push(r); added++; }
          }
          await saveRules(merged); await rebuildDNR(); notifyRulesChanged();
          sendResponse({ ok: true, added, updated, skipped }); break;
        }

        case 'SAVE_RULE': {
          const rules = await getRules();
          const rule  = migrateRule(msg.rule);
          if (!rule.id) rule.id = generateId();
          rule.pairs = (rule.pairs || []).map(p => ({ ...p, id: p.id || generatePairId() }));
          const idx = rules.findIndex(r => r.id === rule.id);
          if (idx >= 0) rules[idx] = rule; else rules.push(rule);
          await saveRules(rules); await rebuildDNR(); notifyRulesChanged();
          await pushRulesToActiveTab(rule);
          sendResponse({ ok: true, rule }); break;
        }

        case 'DELETE_RULE': {
          const rules = await getRules();
          await saveRules(rules.filter(r => r.id !== msg.id));
          await rebuildDNR(); notifyRulesChanged(); sendResponse({ ok: true }); break;
        }

        case 'TOGGLE_RULE': {
          const rules   = await getRules();
          const toggled = rules.map(r => r.id === msg.id ? { ...r, enabled: !r.enabled } : r);
          await saveRules(toggled); await rebuildDNR(); notifyRulesChanged();
          const rule = toggled.find(r => r.id === msg.id);
          if (!rule?.enabled) {
            const allTabs = await chrome.tabs.query({});
            for (const t of allTabs) {
              if (t.id && t.url && !/^(chrome|chrome-extension|about|devtools):/.test(t.url))
                setIcon(t.id, false);
            }
          }
          await pushRulesToActiveTab(rule);
          sendResponse({ ok: true, enabled: rule?.enabled ?? false }); break;
        }

        default: sendResponse({ error: 'unknown: ' + msg.type });
      }
    })();
    return true;
  });
}
