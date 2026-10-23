export const LOCAL_RULES_KEY = 'sfvi_rules';
export const SOURCES_KEY = 'sfvi_sources';

const queues = new Map();
let ruleRevision = 0;

export function ruleStorageRevision() { return ruleRevision; }

export async function readList(key) {
  const data = await chrome.storage.local.get(key);
  const value = data[key] ?? [];
  if (!Array.isArray(value)) throw new Error(`Corrupted storage: ${key} must be an array`);
  return value;
}

// Every read/modify/write for a storage key shares one queue. Network requests
// stay outside it, so a slow source cannot block saving a local rule.
export function updateList(key, update) {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(async () => {
    const { items, result } = await update(await readList(key));
    const affectsRules = key === LOCAL_RULES_KEY || key === SOURCES_KEY;
    // Invalidate on both sides of a write, even when onChanged is delayed.
    // A read during the write may see the old value, but cannot survive it.
    if (affectsRules) ruleRevision++;
    try { await chrome.storage.local.set({ [key]: items }); }
    finally { if (affectsRules) ruleRevision++; }
    return result;
  });
  const settled = next.catch(() => {});
  queues.set(key, settled);
  settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return next;
}
