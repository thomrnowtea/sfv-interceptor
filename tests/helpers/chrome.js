export function event() {
  const listeners = new Set();
  return {
    addListener: listener => listeners.add(listener),
    removeListener: listener => listeners.delete(listener),
    emit: (...args) => [...listeners].map(listener => listener(...args)),
  };
}

export function installChrome(initial = {}) {
  const data = structuredClone(initial);
  const sessionData = {};
  const frames = new Map();
  const icons = [];
  const alarms = new Map();
  const notifications = [];
  const scriptInjections = [];
  const dynamicRules = [];
  const storageChanges = event();
  const runtimeMessages = event();
  const alarmEvent = event();
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) { return { [key]: structuredClone(sessionData[key]) }; },
        async set(values) { Object.assign(sessionData, structuredClone(values)); },
      },
      local: {
        async get(keys, callback) {
          const result = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) result[key] = structuredClone(data[key]);
          callback?.(result);
          return result;
        },
        async set(values, callback) {
          Object.assign(data, structuredClone(values));
          callback?.();
        },
      },
      onChanged: storageChanges,
    },
    alarms: {
      async create(name, settings) { alarms.set(name, { name, ...settings }); },
      async clear(name) { return alarms.delete(name); },
      async get(name) { return structuredClone(alarms.get(name)); },
      async getAll() { return [...alarms.values()].map(alarm => structuredClone(alarm)); },
      onAlarm: alarmEvent,
    },
    runtime: {
      id: 'test-extension',
      getURL: path => 'chrome-extension://test-extension/' + path,
      sendMessage: async message => { notifications.push(message); return {}; },
      onMessage: runtimeMessages,
      onInstalled: event(),
      onStartup: event(),
    },
    tabs: { query: async () => [], get: (_id, callback) => callback?.({}), sendMessage: async () => {}, onUpdated: event(), onRemoved: event(), onReplaced: event(), onActivated: event() },
    webNavigation: { getAllFrames: async ({ tabId }) => structuredClone(frames.get(tabId) || []), onCommitted: event(), onBeforeNavigate: event() },
    scripting: { executeScript: async options => { scriptInjections.push(options); return []; } },
    action: { setIcon: async value => { icons.push(value); }, setBadgeText: async () => {} },
    declarativeNetRequest: {
      isRegexSupported: async () => ({ isSupported: true }),
      getDynamicRules: async () => structuredClone(dynamicRules),
      async updateDynamicRules({ addRules, removeRuleIds }) {
        const kept = dynamicRules.filter(rule => !removeRuleIds.includes(rule.id));
        dynamicRules.splice(0, dynamicRules.length, ...kept, ...structuredClone(addRules));
      },
    },
  };
  return { data, sessionData, frames, icons, alarms, notifications, scriptInjections, alarmEvent, runtimeMessages, dynamicRules };
}

export const extensionSender = { id: 'test-extension', url: 'chrome-extension://test-extension/dashboard/dashboard.html' };

export function rule(overrides = {}) {
  return {
    id: 'account',
    name: 'Account response',
    version: '1.0.0',
    enabled: true,
    resourceType: 'rest',
    pairs: [{ id: 'account-pair', urlPattern: '/api/account', urlOperator: 'Contains', method: 'GET' }],
    request: { type: 'static', body: '', customHeaders: '' },
    response: { type: 'static', body: '{"account":"local"}', statusCode: '200', delay: 0, customHeaders: '' },
    ...overrides,
  };
}

export function jsonFetch(document, status = 200) {
  globalThis.fetch = async () => new Response(JSON.stringify(document), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Asynchronous event did not complete');
}
