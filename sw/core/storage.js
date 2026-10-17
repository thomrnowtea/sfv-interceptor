export const LOCAL_RULES_KEY = 'sfvi_rules';
export const SOURCES_KEY = 'sfvi_sources';

const queues = new Map();

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
    await chrome.storage.local.set({ [key]: items });
    return result;
  });
  const settled = next.catch(() => {});
  queues.set(key, settled);
  settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return next;
}
