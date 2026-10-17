import { fetchRuleSnapshot, validateSourceUrl } from '../../shared/rule-document.js';
import { SOURCES_KEY, readList, updateList } from './storage.js';
import { validateFileRules } from './file-rules.js';
import { materializeSourceRules } from '../../shared/rule-schema.js';

export const SOURCE_ALARM_PREFIX = 'sfvi_source:';
export const DEFAULT_INTERVAL_MINUTES = 60;
const inFlight = new Map();
let schedulingQueue = Promise.resolve();

function scheduledOperation(operation) {
  const next = schedulingQueue.then(operation);
  schedulingQueue = next.catch(() => {});
  return next;
}

export function getSources() {
  return readList(SOURCES_KEY);
}

export async function getSourceSummaries() {
  const sources = await getSources();
  return sources.map(({ rules, enabledOverrides, ...source }) => ({ ...source, ruleCount: rules.length }));
}

function sourceInterval(value = DEFAULT_INTERVAL_MINUTES) {
  const interval = Number(value);
  if (!Number.isInteger(interval) || interval < 1 || interval > 10080) {
    throw new Error('Sync interval must be a whole number from 1 to 10080 minutes');
  }
  return interval;
}

function sourceName(value, url) {
  if (typeof value !== 'string') throw new Error('Source name must be text');
  return value.trim() || new URL(url).hostname;
}

export async function addSource(input) {
  const url = validateSourceUrl(input.url);
  const source = {
    id: 'source_' + crypto.randomUUID(),
    name: sourceName(input.name ?? '', url),
    url,
    intervalMinutes: sourceInterval(input.intervalMinutes),
    createdAt: Date.now(),
    lastCheckedAt: null,
    lastSyncedAt: null,
    lastError: '',
    scheduleError: '',
    etag: '',
    enabledOverrides: {},
    rules: [],
  };
  return scheduledOperation(async () => {
    await updateList(SOURCES_KEY, sources => {
      if (sources.some(existing => existing.url === url)) throw new Error('Already subscribed to this URL');
      return { items: [...sources, source] };
    });
    return scheduleSource(source);
  });
}

export async function updateSource(input) {
  return scheduledOperation(async () => {
    const source = await updateList(SOURCES_KEY, sources => {
      const existing = sources.find(item => item.id === input.id);
      if (!existing) throw new Error('Source not found');
      existing.name = sourceName(input.name ?? existing.name, existing.url);
      existing.intervalMinutes = sourceInterval(input.intervalMinutes ?? existing.intervalMinutes);
      return { items: sources, result: existing };
    });
    return scheduleSource(source);
  });
}

export async function deleteSource(id) {
  return scheduledOperation(async () => {
    await updateList(SOURCES_KEY, sources => ({ items: sources.filter(source => source.id !== id) }));
    inFlight.get(id)?.controller.abort();
    await chrome.alarms.clear(SOURCE_ALARM_PREFIX + id).catch(logSyncError);
  });
}

function retainedEnabledOverrides(source, rules) {
  const ids = new Set(rules.map(rule => rule.id));
  return Object.fromEntries(Object.entries(source.enabledOverrides ?? {})
    .filter(([id, enabled]) => ids.has(id) && typeof enabled === 'boolean'));
}

async function validateSourcePatch(source, patch) {
  if (patch.rules === undefined) return patch;
  const candidate = { ...source, ...patch, enabledOverrides: retainedEnabledOverrides(source, patch.rules) };
  // Local activation can enable a file rule that the publisher disabled. Validate
  // the latest effective snapshot under the same write queue as local toggles.
  await validateFileRules(materializeSourceRules(candidate));
  return { ...patch, enabledOverrides: candidate.enabledOverrides };
}

async function commitSync(id, patch, signal) {
  return updateList(SOURCES_KEY, async sources => {
    const source = sources.find(item => item.id === id);
    // A response arriving after unsubscribe must never recreate a source.
    if (!source) return { items: sources, result: null };
    signal?.throwIfAborted();
    const validated = await validateSourcePatch(source, patch);
    signal?.throwIfAborted();
    const changed = patch.rules !== undefined && JSON.stringify(source.rules) !== JSON.stringify(patch.rules);
    Object.assign(source, validated);
    return { items: sources, result: { source, changed } };
  });
}

function findSourceRule(sources, id) {
  for (const source of sources) {
    const rule = materializeSourceRules(source).find(rule => rule.id === id);
    if (rule) return { source, rule };
  }
  throw new Error('Remote rule not found. Refresh the rule list.');
}

export function toggleSourceRule(id) {
  return updateList(SOURCES_KEY, async sources => {
    const { source, rule } = findSourceRule(sources, id);
    const updated = { ...rule, enabled: !rule.enabled };
    await validateFileRules([updated]);
    source.enabledOverrides = { ...source.enabledOverrides, [rule.sourceRuleId]: updated.enabled };
    return { items: sources, result: updated };
  });
}

async function downloadSource(source, signal) {
  try {
    const snapshot = await fetchRuleSnapshot(source.url, {
      signal, requireIds: true, etag: source.lastSyncedAt ? source.etag : '',
    });
    signal.throwIfAborted();
    return await commitSync(source.id, checkedSourcePatch(snapshot), signal);
  } catch (error) {
    const lastError = error.name === 'AbortError' ? 'Download timed out. Try syncing again.' : error.message;
    return commitSync(source.id, { lastCheckedAt: Date.now(), lastError });
  }
}

function checkedSourcePatch(snapshot) {
  const now = Date.now();
  const patch = { lastCheckedAt: now, lastError: '', etag: snapshot.etag };
  if (!snapshot.notModified) Object.assign(patch, { rules: snapshot.rules, lastSyncedAt: now });
  return patch;
}

export function syncSource(id) {
  if (inFlight.has(id)) return inFlight.get(id).promise;
  const controller = new AbortController();
  const promise = (async () => {
    const source = (await getSources()).find(item => item.id === id);
    if (!source) throw new Error('Source not found');
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      return await downloadSource(source, controller.signal);
    } finally {
      clearTimeout(timeout);
      inFlight.delete(id);
    }
  })();
  inFlight.set(id, { controller, promise });
  // Also clean up a missing-source/storage failure before download begins.
  promise.catch(() => inFlight.delete(id));
  return promise;
}

function updateScheduleError(id, scheduleError) {
  return updateList(SOURCES_KEY, sources => {
    const source = sources.find(item => item.id === id);
    if (source) source.scheduleError = scheduleError;
    return { items: sources, result: source };
  });
}

async function scheduleSource(source) {
  const nextCheck = (source.lastCheckedAt ?? source.createdAt) + source.intervalMinutes * 60000;
  let scheduleError = '';
  try {
    await chrome.alarms.create(SOURCE_ALARM_PREFIX + source.id, {
      when: Math.max(Date.now() + 60000, nextCheck),
      periodInMinutes: source.intervalMinutes,
    });
  } catch (error) {
    scheduleError = 'Automatic updates could not be scheduled: ' + error.message;
  }
  return updateScheduleError(source.id, scheduleError);
}

async function reconcileSourceAlarms() {
  const sources = await getSources();
  const alarms = await chrome.alarms.getAll().catch(error => { logSyncError(error); return []; });
  const expected = new Map(sources.map(source => [SOURCE_ALARM_PREFIX + source.id, source]));
  for (const alarm of alarms) {
    if (alarm.name.startsWith(SOURCE_ALARM_PREFIX) && !expected.has(alarm.name)) {
      await chrome.alarms.clear(alarm.name).catch(logSyncError);
    }
  }
  for (const [name, source] of expected) {
    const alarm = alarms.find(item => item.name === name);
    if (alarm?.periodInMinutes !== source.intervalMinutes) await scheduleSource(source);
    else if (source.scheduleError) await updateScheduleError(source.id, '');
  }
  return getSources();
}

export function restoreSourceAlarms() {
  return scheduledOperation(reconcileSourceAlarms);
}

function logSyncError(error) {
  console.error('[SFV-I SW] Remote sources:', error.message);
}

export function initSourceSync(onChanged) {
  // Listeners must be present before asynchronous startup restoration.
  chrome.alarms.onAlarm.addListener(alarm => {
    if (!alarm.name.startsWith(SOURCE_ALARM_PREFIX)) return;
    syncSource(alarm.name.slice(SOURCE_ALARM_PREFIX.length)).then(onChanged).catch(logSyncError);
  });

  restoreSourceAlarms().then(async sources => {
    const due = sources.filter(source => Date.now() - (source.lastCheckedAt ?? 0) >= source.intervalMinutes * 60000);
    const results = await Promise.allSettled(due.map(source => syncSource(source.id)));
    if (results.some(result => result.status === 'fulfilled' && result.value)) await onChanged();
    for (const result of results) {
      if (result.status === 'rejected') logSyncError(result.reason);
    }
  }).catch(logSyncError);
}
