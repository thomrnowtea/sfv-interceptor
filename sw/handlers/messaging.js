import { getRules, saveRules, mergeRules, saveRule, deleteRule, toggleRule } from '../core/rules.js';
import { getSourceSummaries, addSource, updateSource, deleteSource, syncSource } from '../core/sources.js';
import { portableRule } from '../../shared/rule-schema.js';
import { rebuildDNR } from './dnr.js';
import { pairToRegexFilter } from '../core/matcher.js';
import { ruleColor } from '../../shared/rule-display.js';
import { executionRules, getCommittedPage, invalidateExecutionSnapshot, pageExecution, recordApplied, tabActivity } from '../core/activity.js';

const PRIVATE_TYPES = new Set([
  'GET_RULES', 'GET_TAB_ACTIVITY', 'EXPORT_RULES', 'IMPORT_RULES', 'MERGE_RULES', 'SAVE_RULE', 'DELETE_RULE', 'TOGGLE_RULE',
  'GET_SOURCES', 'ADD_SOURCE', 'UPDATE_SOURCE', 'DELETE_SOURCE', 'SYNC_SOURCE',
]);

export async function getApiRules(snapshot = null) {
  const { rules, configRevision, configGeneration } = snapshot || await executionRules();
  const result = [];
  for (const rule of rules) {
    if (rule.enabled === false || rule.resourceType === 'html') continue;
    for (const pair of (rule.pairs || [])) {
      if (!pair.urlPattern) continue;
      const regexFilter = pairToRegexFilter(pair);
      if (!regexFilter) continue;
      result.push({
        id:                   rule.id + '|' + pair.id,
        ruleId:               rule.id,
        pairId:               pair.id,
        color:                ruleColor(rule),
        configRevision,
        configGeneration,
        name:                 rule.name,
        regex:                regexFilter,
        caseSensitive:        pair.caseSensitive === true,
        method:               pair.method,
        responseType:         rule.response.type,
        responseBody:         rule.response.body,
        statusCode:           rule.response.statusCode || 200,
        delay:                rule.response.delay,
        gqlOperation:         pair.gqlOperation,
        customHeaders:        rule.response.customHeaders,
        requestBodyType:      rule.request.type,
        requestBody:          rule.request.body,
        requestCustomHeaders: rule.request.customHeaders,
        redirectUrl:          pair.redirectUrl,
      });
    }
  }
  return result;
}

export function notifyRulesChanged() {
  chrome.runtime.sendMessage({ type: 'RULES_CHANGED' }).catch(() => {});
}

export function configurePageHook(apis, activity) {
  const hook = Reflect.ownKeys(window).reduce((found, key) => {
    if (found) return found;
    try { return typeof key === 'symbol' && window[key]?._sfvi === 1 ? window[key] : null; }
    catch { return null; }
  }, null);
  if (hook?.updateApis) hook.updateApis(apis, activity);
}

async function pushRulesToTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async tab => {
    if (!tab.id || !tab.url || /^(chrome|chrome-extension|about|devtools):/.test(tab.url)) return;
    const snapshot = await pageExecution(tab.id);
    if (!snapshot.activity || !snapshot.documentIds.length) return;
    const apiRules = await getApiRules(snapshot);
    const target = { tabId: tab.id, documentIds: snapshot.documentIds };
    try { await chrome.scripting.executeScript({ target, files: ['page-hook.js'], world: 'MAIN' }); } catch {}
    try {
      await chrome.scripting.executeScript({
        target, world: 'MAIN',
        args: [apiRules, snapshot.activity],
        func: configurePageHook,
      });
    } catch {}
  }));
}

let publishQueue = Promise.resolve();

export function publishRulesChanged() {
  invalidateExecutionSnapshot();
  const next = publishQueue.then(async () => {
    await executionRules();
    let applicationError = null;
    try { await rebuildDNR(); }
    catch (error) { applicationError = error; }
    await chrome.storage.local.set({ sfvi_apply_error: applicationError?.message ?? '' });
    await pushRulesToTabs();
    notifyRulesChanged();
    if (applicationError) throw applicationError;
  });
  publishQueue = next.catch(() => {});
  return next;
}

async function mutate(operation) {
  const result = await operation();
  await publishRulesChanged();
  return { ok: true, ...result };
}

async function handleApiRules(_message, sender) {
  const tabId = sender.tab?.id;
  let injectHook = Promise.resolve();
  if (Number.isInteger(tabId)) {
    const target = sender.documentId
      ? { tabId, documentIds: [sender.documentId] }
      : { tabId, frameIds: [sender.frameId ?? 0] };
    // Install the main-world interceptor as soon as the document-start
    // handshake reaches the worker. Activity bookkeeping can run alongside it.
    injectHook = chrome.scripting.executeScript({
      target, files: ['page-hook.js'], world: 'MAIN', injectImmediately: true,
    }).catch(() => {});
  }
  const snapshotPromise = Number.isInteger(tabId)
    ? getCommittedPage(tabId, sender.documentId) || pageExecution(tabId, sender.frameId ?? 0, sender.documentId)
    : executionRules();
  const snapshot = await snapshotPromise;
  const rules = await getApiRules(snapshot);
  await injectHook;
  return { rules, activity: snapshot.activity || null };
}

async function handleToggle(message) {
  const rule = await toggleRule(message.id);
  return { enabled: rule.enabled };
}

const handlers = {
  GET_API_RULES: handleApiRules,
  RULE_APPLIED: recordApplied,
  GET_TAB_ACTIVITY: message => tabActivity(message.tabId),
  GET_RULES: async () => ({
    rules: await getRules(),
    sources: await getSourceSummaries(),
    applyError: (await chrome.storage.local.get('sfvi_apply_error')).sfvi_apply_error ?? '',
  }),
  EXPORT_RULES: async () => ({ rules: (await getRules()).map(portableRule) }),
  GET_SOURCES: async () => ({ sources: await getSourceSummaries() }),
  IMPORT_RULES: message => mutate(() => saveRules(message.rules)),
  MERGE_RULES: message => mutate(() => mergeRules(message.rules, message.strategy)),
  SAVE_RULE: message => mutate(async () => ({ rule: await saveRule(message.rule) })),
  DELETE_RULE: message => mutate(() => deleteRule(message.id)),
  TOGGLE_RULE: message => mutate(() => handleToggle(message)),
  ADD_SOURCE: message => mutate(async () => {
    const source = await addSource(message.source);
    return await syncSource(source.id);
  }),
  UPDATE_SOURCE: message => mutate(async () => ({ source: await updateSource(message.source) })),
  DELETE_SOURCE: message => mutate(() => deleteSource(message.id)),
  SYNC_SOURCE: message => mutate(() => syncSource(message.id)),
};

export async function handleMessage(message, sender) {
  const fromExtensionPage = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
  if (PRIVATE_TYPES.has(message.type) && !fromExtensionPage) throw new Error('unauthorized');
  const handler = Object.hasOwn(handlers, message.type) ? handlers[message.type] : null;
  if (!handler) throw new Error('Unknown message: ' + message.type);
  return handler(message, sender);
}

export function initMessaging() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'RULES_CHANGED' || message?.type === 'ACTIVITY_CHANGED') return false;
    handleMessage(message, sender).then(sendResponse).catch(error => sendResponse({ error: error.message }));
    return true;
  });
}
