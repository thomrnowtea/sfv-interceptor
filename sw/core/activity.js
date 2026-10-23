import { getRules } from './rules.js';
import { ruleStorageRevision } from './storage.js';
import { setIcon } from '../handlers/icons.js';

const KEY = 'sfvi_activity';
let queue = Promise.resolve();
let configEpoch = 0;
let observedRuleRevision = ruleStorageRevision();
let configuration = null;
let pageEpochCounter = 0;
const committedPages = new Map();
const pageEpochs = new Map();

function committedPageKey(tabId, documentId) { return `${tabId}:${documentId}`; }

export function getCommittedPage(tabId, documentId) {
  return committedPages.get(committedPageKey(tabId, documentId)) || null;
}

export function isExecutionSnapshotCurrent(snapshot) {
  if (!snapshot || snapshot.configEpoch !== executionConfigEpoch()) return false;
  if (!snapshot.activity) return true;
  const current = pageEpochs.get(Number(snapshot.tabId));
  return current ? current.epoch === snapshot.pageEpoch && current.cycleId === snapshot.activity.cycleId : false;
}

function pageEpoch(tabId, tab) {
  const key = Number(tabId);
  const current = pageEpochs.get(key);
  if (!current || current.documentId !== tab.documentId || current.cycleId !== tab.cycleId) {
    const next = { documentId: tab.documentId, cycleId: tab.cycleId, epoch: ++pageEpochCounter };
    pageEpochs.set(key, next);
    return next.epoch;
  }
  return current.epoch;
}

export function invalidateExecutionSnapshot() {
  configEpoch++;
  configuration = null;
}

export function executionConfigEpoch() {
  const revision = ruleStorageRevision();
  if (revision !== observedRuleRevision) {
    observedRuleRevision = revision;
    invalidateExecutionSnapshot();
  }
  return configEpoch;
}

async function fingerprint(rules) {
  const bytes = new TextEncoder().encode(JSON.stringify(rules.filter(rule => rule.enabled !== false)));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function freezeConfiguration(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeConfiguration(child);
    Object.freeze(value);
  }
  return value;
}

async function currentConfiguration() {
  for (;;) {
    const epoch = executionConfigEpoch();
    if (!configuration) {
      const pending = getRules().then(async rules => ({ rules: freezeConfiguration(rules), hash: await fingerprint(rules), epoch }));
      configuration = pending;
      pending.catch(() => { if (configuration === pending) configuration = null; });
    }
    try {
      const snapshot = await configuration;
      if (snapshot.epoch === executionConfigEpoch()) return snapshot;
    } catch (error) {
      if (epoch === executionConfigEpoch()) throw error;
    }
  }
}

// Reads, unions, and cycle changes share this queue, including after worker wakeup.
function transact(operation) {
  const next = queue.then(async () => {
    let config = await currentConfiguration();
    let stored = (await chrome.storage.session.get(KEY))[KEY];
    // Session IPC can overlap a write too; never bind old rules to a new epoch.
    while (config.epoch !== executionConfigEpoch()) {
      config = await currentConfiguration();
      stored = (await chrome.storage.session.get(KEY))[KEY];
    }
    const { rules, hash } = config;
    const state = stored || { fingerprint: hash, revision: crypto.randomUUID(), generation: 1, tabs: {} };
    let dirty = !stored;
    const changed = new Map();
    const touch = (tabId, reset = false) => {
      dirty = true;
      changed.set(Number(tabId), reset || changed.get(Number(tabId)) || false);
    };
    if (state.fingerprint !== hash) {
      // The content hash persists across worker wakeups; internal epochs do not.
      configEpoch++;
      config.epoch = configEpoch;
      state.fingerprint = hash;
      state.revision = crypto.randomUUID();
      state.generation = (state.generation || 1) + 1;
      dirty = true;
      for (const [tabId, tab] of Object.entries(state.tabs)) {
        tab.appliedRuleIds = [];
        touch(tabId, true);
      }
    }
    const result = await operation(state, rules, touch, config.epoch);
    if (dirty) await chrome.storage.session.set({ [KEY]: state });
    for (const [tabId, reset] of changed) {
      setIcon(tabId, Boolean(state.tabs[tabId]?.appliedRuleIds.length));
      chrome.runtime.sendMessage({ type: 'ACTIVITY_CHANGED', tabId }).catch(() => {});
      if (reset) chrome.tabs.sendMessage(tabId, { type: 'ACTIVITY_CYCLE_CHANGED' }).catch(() => {});
    }
    return result;
  });
  queue = next.catch(() => {});
  return next;
}

async function activeFrames(tabId) {
  try {
    return (await chrome.webNavigation.getAllFrames({ tabId }) || [])
      .filter(frame => frame.documentId && (!frame.documentLifecycle || frame.documentLifecycle === 'active'));
  } catch { return []; }
}

function currentFrame(frames, frameId, documentId) {
  const frame = frames.find(item => item.frameId === frameId && (!documentId || item.documentId === documentId));
  let ancestor = frame;
  const visited = new Set();
  while (ancestor && ancestor.frameId !== 0 && !visited.has(ancestor.frameId)) {
    visited.add(ancestor.frameId);
    ancestor = frames.find(item => item.frameId === ancestor.parentFrameId);
  }
  return ancestor?.frameId === 0 ? frame : null;
}

function bindPage(state, tabId, frames, touch) {
  const root = frames.find(frame => frame.frameId === 0);
  if (!root) return null;
  return bindDocument(state, tabId, root.documentId, touch);
}

function bindDocument(state, tabId, documentId, touch) {
  if (!documentId) return null;
  if (state.tabs[tabId]?.documentId !== documentId) {
    state.tabs[tabId] = { documentId, cycleId: crypto.randomUUID(), commitStamp: null, appliedRuleIds: [] };
    touch(tabId, true);
  }
  return state.tabs[tabId];
}

function envelope(state, tab) {
  return { documentId: tab.documentId, cycleId: tab.cycleId, configRevision: state.revision, configGeneration: state.generation };
}

export function executionRules() {
  return transact((state, rules, _touch, configEpoch) => ({ rules, configRevision: state.revision, configGeneration: state.generation, configEpoch }));
}

export function pageExecution(tabId, frameId = 0, documentId) {
  return transact(async (state, rules, touch, configEpoch) => {
    // A document ID from a content script or webNavigation event identifies
    // the document before getAllFrames exposes it as active. Bind directly so
    // document_start interception never waits for that browser bookkeeping.
    if (documentId && frameId === 0) {
      const tab = bindDocument(state, tabId, documentId, touch);
      return { tabId, rules, configRevision: state.revision, configGeneration: state.generation,
        configEpoch, pageEpoch: tab ? pageEpoch(tabId, tab) : null,
        activity: tab ? envelope(state, tab) : null, documentIds: [documentId], frameDocumentId: documentId };
    }
    // Subframe senders are also browser-authenticated. Reuse the already-bound
    // top-level cycle and let recordApplied verify frame ancestry at completion.
    if (documentId && state.tabs[tabId]) {
      const tab = state.tabs[tabId];
      return { tabId, rules, configRevision: state.revision, configGeneration: state.generation,
        configEpoch, pageEpoch: pageEpoch(tabId, tab),
        activity: envelope(state, tab), documentIds: [documentId], frameDocumentId: documentId };
    }
    const frames = await activeFrames(tabId);
    const frame = currentFrame(frames, frameId, documentId);
    const tab = frame && bindPage(state, tabId, frames, touch);
    return { tabId, rules, configRevision: state.revision, configGeneration: state.generation, configEpoch,
      pageEpoch: tab ? pageEpoch(tabId, tab) : null, activity: tab ? envelope(state, tab) : null,
      documentIds: frames.map(item => item.documentId), frameDocumentId: frame?.documentId };
  });
}

export function tabActivity(tabId) {
  return transact(async (state, _rules, touch) => {
    const tab = bindPage(state, tabId, await activeFrames(tabId), touch);
    return { tabId, appliedRuleIds: tab?.appliedRuleIds || [], activity: tab ? envelope(state, tab) : null };
  });
}

export function recordApplied(message, sender) {
  return transact(async (state, rules, touch) => {
    const tabId = sender.tab?.id;
    if (sender.id !== chrome.runtime.id || !Number.isInteger(tabId) || !sender.documentId) return { ok: false };
    const frames = await activeFrames(tabId);
    if (!currentFrame(frames, sender.frameId ?? 0, sender.documentId)) return { ok: false };
    const tab = bindPage(state, tabId, frames, touch);
    if (!tab || !message.activity) return { ok: false };
    const expected = envelope(state, tab);
    if (Object.keys(expected).some(key => expected[key] !== message.activity[key])) return { ok: false };
    const rule = rules.find(item => item.id === message.ruleId && item.enabled !== false);
    if (!rule?.pairs?.some(pair => pair.id === message.pairId)) return { ok: false };
    if (!tab.appliedRuleIds.includes(rule.id)) {
      tab.appliedRuleIds.push(rule.id);
      touch(tabId);
    }
    return { ok: true };
  });
}

export function commitPage(details) {
  if (details.frameId !== 0) return Promise.resolve();
  const committed = transact(async (state, rules, touch, configEpoch) => {
    const frames = details.documentId ? null : await activeFrames(details.tabId);
    const tab = details.documentId
      ? bindDocument(state, details.tabId, details.documentId, touch)
      : bindPage(state, details.tabId, frames, touch);
    if (!tab) return;
    // A handshake may precede onCommitted; reconcile that activation just once.
    if (tab.commitStamp !== null && tab.commitStamp !== details.timeStamp) {
      tab.cycleId = crypto.randomUUID();
      tab.appliedRuleIds = [];
      touch(details.tabId, true);
    }
    tab.commitStamp = details.timeStamp;
    touch(details.tabId);
    const documentId = details.documentId || tab.documentId;
    return {
      tabId: details.tabId,
      rules,
      configRevision: state.revision,
      configGeneration: state.generation,
      configEpoch,
      pageEpoch: pageEpoch(details.tabId, tab),
      activity: envelope(state, tab),
      documentIds: documentId ? [documentId] : [],
      frameDocumentId: documentId,
    };
  });
  if (details.documentId) {
    const key = committedPageKey(details.tabId, details.documentId);
    committedPages.set(key, committed);
    while (committedPages.size > 64) committedPages.delete(committedPages.keys().next().value);
  }
  return committed;
}

function forgetTab(tabId) {
  return transact((state, _rules, touch) => {
    if (state.tabs[tabId]) { delete state.tabs[tabId]; touch(tabId); }
    pageEpochs.delete(Number(tabId));
  });
}

export function initActivity() {
  chrome.webNavigation.onCommitted.addListener(details => { commitPage(details).catch(() => {}); });
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && (Object.hasOwn(changes, 'sfvi_rules') || Object.hasOwn(changes, 'sfvi_sources'))) {
      invalidateExecutionSnapshot();
    }
  });
  chrome.tabs.onRemoved.addListener(tabId => { forgetTab(tabId).catch(() => {}); });
  chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => { forgetTab(removedTabId).catch(() => {}); });
}
