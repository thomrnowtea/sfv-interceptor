import { getRules } from '../core/rules.js';
import { getApiRules, configurePageHook } from './messaging.js';
import { getScriptUrlsForPage, getOriginalText, clearHtmlCache } from '../cache/assets.js';
import { executionConfigEpoch, getCommittedPage, isExecutionSnapshotCurrent, pageExecution, recordApplied } from '../core/activity.js';
import { ruleColor } from '../../shared/rule-display.js';
import { resolveTheme } from '../../shared/themes.js';
import { applyPageRule, applyAssetRule, notifyAssetRule } from './execute.js';
import { selectAssetMatches } from '../core/asset-matches.js';

const preparations = new Map();

function preparationKey(tabId, pageUrl) { return `${tabId}:${pageUrl}`; }

export function initNavigation() {
  chrome.webNavigation.onBeforeNavigate.addListener(details => {
    if (details.frameId !== 0) return;
    const pageUrl = details.url;
    if (!pageUrl || /^(chrome|about|devtools|chrome-extension):/.test(pageUrl)) return;

    clearHtmlCache();
    const key = preparationKey(details.tabId, pageUrl);
    const entry = { ready: false, value: null, promise: null };
    entry.promise = prepareNavigation(details.tabId, pageUrl).then(value => {
      entry.value = value;
      entry.ready = true;
      return value;
    });
    preparations.set(key, entry);
    while (preparations.size > 32) preparations.delete(preparations.keys().next().value);
  });

  chrome.webNavigation.onCommitted.addListener(details => {
    applyNavigation(details).catch(error => console.error('[SFV-I] Navigation:', error.message));
  });
}

async function prepareNavigation(tabId, pageUrl) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const configEpoch = executionConfigEpoch();
    const rules = await getRules();
    if (configEpoch !== executionConfigEpoch()) continue;
    if (!rules.some(rule => rule.enabled !== false && rule.resourceType === 'html')) {
      return { tabId, configEpoch, assets: [] };
    }
    const [scriptUrls, blockers] = await Promise.all([
      getScriptUrlsForPage(pageUrl),
      chrome.declarativeNetRequest.getDynamicRules().catch(() => []),
    ]);
    if (configEpoch !== executionConfigEpoch()) continue;
    const matches = selectAssetMatches(rules, scriptUrls, pageUrl, blockers);
    const assets = await Promise.all(matches.map(async match => {
      const rule = rules.find(item => item.id === match.ruleId && item.enabled !== false);
      if (!rule) return null;
      const needsOriginal = !match.isPageInject && rule.response.type !== 'static';
      const original = needsOriginal ? await getOriginalText(match.assetUrl, pageUrl) : null;
      return { ruleId: match.ruleId, pairId: match.pairId, isPageInject: match.isPageInject, notificationId: crypto.randomUUID(),
        payload: assetPayload(rule, match, original) };
    }));
    if (configEpoch !== executionConfigEpoch()) continue;
    return { tabId, configEpoch, assets: assets.filter(Boolean) };
  }
  return null;
}

async function applyNavigation(details) {
  const { tabId, frameId, documentId, url: pageUrl } = details;
  if (!pageUrl || /^(chrome|about|devtools|chrome-extension):/.test(pageUrl)) return;
  const target = { tabId, documentIds: [documentId] };
  if (frameId !== 0) {
    const snapshot = await pageExecution(tabId, frameId, documentId);
    if (!snapshot.activity || snapshot.frameDocumentId !== documentId) return;
    const apis = await getApiRules(snapshot);
    if (!apis.length) return;
    try {
      await chrome.scripting.executeScript({ target, files: ['page-hook.js'], world: 'MAIN', injectImmediately: true });
      await chrome.scripting.executeScript({ target, world: 'MAIN', injectImmediately: true, args: [apis, snapshot.activity], func: configurePageHook });
    } catch {}
    return;
  }

  // onBeforeNavigate prepares matching rules and source bodies while the
  // document request is in flight. Start the page injection as soon as the
  // commit event arrives; activity persistence can finish alongside it.
  const key = preparationKey(tabId, pageUrl);
  const entry = preparations.get(key);
  preparations.delete(key);
  const committedSnapshot = getCommittedPage(tabId, documentId);
  const loadSnapshot = async () => {
    let snapshot = await (committedSnapshot || pageExecution(tabId, frameId, documentId));
    if (!isExecutionSnapshotCurrent(snapshot)) snapshot = await pageExecution(tabId, frameId, documentId);
    return snapshot;
  };
  if (entry?.ready && entry.value?.assets.length && isExecutionSnapshotCurrent(entry.value)) {
    const injectionJobs = entry.value.assets.map(asset => applyPreparedAsset(details, entry.value, asset));
    await finishPreparedNavigation(details, entry.value, injectionJobs, loadSnapshot());
    return;
  }
  let prepared = await (entry?.promise || prepareNavigation(tabId, pageUrl));
  if (!prepared || !isExecutionSnapshotCurrent(prepared)) prepared = await prepareNavigation(tabId, pageUrl);
  if (!prepared?.assets.length || !isExecutionSnapshotCurrent(prepared)) return;

  const injectionJobs = prepared.assets.map(asset => applyPreparedAsset(details, prepared, asset));
  await finishPreparedNavigation(details, prepared, injectionJobs, loadSnapshot());
}

async function finishPreparedNavigation(details, prepared, injectionJobs, snapshotPromise) {
  const { tabId, frameId, documentId } = details;
  const snapshot = await snapshotPromise;
  const current = () => snapshot.activity && snapshot.frameDocumentId === documentId &&
    isExecutionSnapshotCurrent(snapshot) && snapshot.configEpoch === prepared.configEpoch;
  if (!current()) return;
  const target = { tabId, documentIds: [documentId] };
  let presentation;
  const ready = () => presentation ||= Promise.all([
    chrome.scripting.executeScript({ target, files: ['page-hook.js'], world: 'MAIN', injectImmediately: true }),
    chrome.storage.local.get(['sfvi_theme', 'sfvi_theme_vars', 'sfvi_theme_custom']),
  ]).then(([, stored]) => resolveTheme(stored));
  await Promise.all(injectionJobs.map(async (job, index) => {
    if (!(await job) || !current()) return;
    const asset = prepared.assets[index];
    const result = await recordApplied({ ruleId: asset.ruleId, pairId: asset.pairId, activity: snapshot.activity },
      { id: chrome.runtime.id, tab: { id: tabId }, frameId, documentId });
    if (!result.ok || !current()) return;
    try {
      // Presentation follows successful execution; it never gates the patch.
      const theme = await ready();
      if (!current()) return;
      const { subtype, name, file, color } = asset.payload;
      await chrome.scripting.executeScript({ target, world: 'MAIN', injectImmediately: true,
        func: notifyAssetRule, args: [{ id: asset.notificationId, theme, name, color,
          statusLabel: asset.isPageInject ? 'Page Injected' : subtype === 'css' ? 'CSS Patched' : 'JS Patched',
          sub: file + ' \u00b7 ' + subtype }] });
    } catch (error) { console.warn('[SFV-I] Notification failed:', error.message); }
  }));
}

function assetPayload(rule, match, original) {
  const file = new URL(match.assetUrl).pathname.split('/').filter(Boolean).pop() || 'page';
  return { url: match.assetUrl, file, name: rule.name, color: ruleColor(rule),
    code: rule.response.body, original,
    staticBody: rule.response.type === 'static' ? rule.response.body : null,
    subtype: rule.resourceSubtype || 'js' };
}

async function applyPreparedAsset(details, snapshot, asset) {
  const { tabId, frameId, documentId } = details;
  const { isPageInject, payload } = asset;
  if (!isExecutionSnapshotCurrent(snapshot)) return;
  if (isPageInject && !payload.code) return;
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId, documentIds: [documentId] },
      world: 'MAIN', injectImmediately: true, args: [payload], func: isPageInject ? applyPageRule : applyAssetRule });
    return results.some(result => result.documentId === documentId && result.result?.applied === true);
  } catch (error) { console.error('[SFV-I] Injection failed:', error.message); }
}
