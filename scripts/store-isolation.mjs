import assert from 'node:assert/strict';

// Exercise the production evaluators from the extracted release. A browser's
// window.chrome may exist on websites; check actual privileged capabilities.
const scope = `(() => {
  const api = globalThis.chrome;
  let parentDocumentAllowed = false;
  try { void parent.document.documentElement; parentDocumentAllowed = true; } catch {}
  return {
    privileged: {
      storage: typeof api?.storage?.local?.get === 'function',
      scripting: typeof api?.scripting?.executeScript === 'function',
      tabs: typeof api?.tabs?.create === 'function',
      runtimeMessaging: typeof api?.runtime?.sendMessage === 'function'
    },
    extensionId: api?.runtime?.id || null,
    isFrame: self !== top,
    parentDocumentAllowed,
    scriptUrl: document.currentScript?.src || ''
  };
})()`;

function checkScope(result, label) {
  assert.deepEqual(result.privileged, { storage: false, scripting: false, tabs: false, runtimeMessaging: false }, label);
  assert.equal(result.extensionId, null, label);
}

export async function checkStoreIsolation({ context, worker, control }) {
  const evidence = [];
  const rule = {
    id: 'store-isolation', name: 'Store isolation fixture', version: '1.0.0', enabled: true, resourceType: 'rest',
    pairs: [{ id: 'scope-api', urlPattern: '/api/isolation', urlOperator: 'Contains', method: 'POST' }],
    request: { type: 'dynamic', body: `function modifyRequest(args){return {requestScope:${scope}}}`, customHeaders: '' },
    response: { type: 'dynamic', body: `function modifyResponse(args){return {...args.responseJSON,responseScope:${scope}}}`, statusCode: '200', delay: 0, customHeaders: '' },
  };
  const pattern = 'https://isolation.sfvi.test/**';
  const routeFixture = async route => {
    const url = new URL(route.request().url());
    const headers = url.pathname === '/csp'
      ? { 'Content-Security-Policy': "script-src 'self'; frame-src chrome-extension:;" }
      : url.pathname === '/blob' ? { 'Content-Security-Policy': "script-src 'self' 'unsafe-eval' blob:;" } : {};
    if (url.pathname === '/api/isolation') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(JSON.parse(route.request().postData())) });
    }
    return route.fulfill({ headers, contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Isolation fixture</title><body><p>Packaged execution scope</p></body></html>' });
  };
  await context.route(pattern, routeFixture);
  const page = await context.newPage();
  await page.addInitScript(() => window.addEventListener('message', event => {
    if (event.source === window && event.data?.type === '__sfvi_hook_data__' && event.data.apis?.some(rule => rule.ruleId === 'store-isolation')) window.__scopeReady = true;
    if (event.data?.type === '__sfvi_sandbox_ready__' && event.source === document.getElementById('__sfvi_sandbox__')?.contentWindow) window.__scopeSandboxReady = true;
  }));
  try {
    const saved = await control.evaluate(rule => chrome.runtime.sendMessage({ type: 'SAVE_RULE', rule }), rule);
    assert.equal(saved.error, undefined);
    for (const path of ['/plain', '/csp']) {
      await page.goto('https://isolation.sfvi.test' + path);
      await page.waitForFunction(() => window.__scopeReady === true && window.__scopeSandboxReady === true);
      // Leave the DevTools evaluation task so normal page CSP governs eval.
      const result = await page.evaluate(() => new Promise((resolve, reject) => setTimeout(() => {
        fetch('/api/isolation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then(response => response.json()).then(resolve, reject);
      }, 0)));
      for (const name of ['requestScope', 'responseScope']) {
        checkScope(result[name], path + '/' + name);
        assert.equal(result[name].isFrame, path === '/csp', 'CSP uses the real sandbox');
        assert.equal(result[name].parentDocumentAllowed, path !== '/csp', 'Sandbox cannot access parent DOM');
      }
      evidence.push({ path, ...result });
    }
    const privateTypes = ['GET_RULES', 'GET_TAB_ACTIVITY', 'EXPORT_RULES', 'IMPORT_RULES', 'MERGE_RULES', 'SAVE_RULE', 'DELETE_RULE', 'TOGGLE_RULE', 'GET_SOURCES', 'ADD_SOURCE', 'UPDATE_SOURCE', 'DELETE_SOURCE', 'SYNC_SOURCE'];
    const before = await worker.evaluate(() => chrome.storage.local.get(['sfvi_rules', 'sfvi_sources']));
    const rejected = await control.evaluate(async ({ url, types }) => {
      const [tab] = await chrome.tabs.query({ url });
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', args: [types], func: async types => {
        const responses = [];
        for (const type of types) responses.push(await chrome.runtime.sendMessage({ type }));
        return responses;
      } });
      return result.result;
    }, { url: page.url(), types: privateTypes });
    assert.deepEqual(rejected, privateTypes.map(() => ({ error: 'unauthorized' })), 'Real content-script senders cannot invoke private operations');
    await page.evaluate(types => {
      for (const type of types) window.postMessage({ type, rules: [], id: 'store-isolation' }, location.origin);
      window.dispatchEvent(new CustomEvent('__sfvi_applied__', { detail: { ruleId: 'nonexistent-rule' } }));
    }, privateTypes);
    const after = await worker.evaluate(() => chrome.storage.local.get(['sfvi_rules', 'sfvi_sources']));
    assert.deepEqual(after, before, 'Forged page/private operations do not alter configuration');
    evidence.push({ privateOperationsRejected: privateTypes });

    for (const path of ['/plain', '/blob']) {
      await page.goto('https://isolation.sfvi.test' + path);
      await page.waitForFunction(() => window.__scopeReady === true && window.__scopeSandboxReady === true);
      const observations = await control.evaluate(async ({ url, scope }) => {
        const { applyPageRule, applyAssetRule } = await import(chrome.runtime.getURL('sw/handlers/execute.js'));
        const [tab] = await chrome.tabs.query({ url });
        const target = { tabId: tab.id };
        const run = async (func, payload) => {
          const [result] = await chrome.scripting.executeScript({ target, world: 'MAIN', func, args: [payload] });
          return result.result;
        };
        const page = await run(applyPageRule, { url, code: `function modifyResponse(args){window.__scopePage=${scope};return args.response}` });
        const dynamic = await run(applyAssetRule, { original: 'original', code: `function modifyResponse(args){window.__scopeTransformer=${scope};return ${JSON.stringify('window.__scopeGenerated=' + scope)}}`, url, file: 'scope.js', subtype: 'js' });
        const staticallyReplaced = await run(applyAssetRule, { staticBody: `window.__scopeStatic=${scope}`, url, file: 'static-scope.js', subtype: 'js' });
        return { page, dynamic, staticallyReplaced };
      }, { url: page.url(), scope });
      assert.deepEqual(observations, { page: { applied: true }, dynamic: { applied: true }, staticallyReplaced: { applied: true } });
      const results = await page.evaluate(() => ({ page: window.__scopePage, transformer: window.__scopeTransformer, generated: window.__scopeGenerated, static: window.__scopeStatic }));
      for (const [name, result] of Object.entries(results)) checkScope(result, path + '/' + name);
      assert.equal(results.generated.scriptUrl.startsWith('blob:'), path === '/blob', 'Generated JS exercises inline and Blob execution');
      evidence.push({ path, ...results });
    }
    return evidence;
  } finally {
    await page.close();
    await context.unroute(pattern, routeFixture);
    const deleted = await control.evaluate(() => chrome.runtime.sendMessage({ type: 'DELETE_RULE', id: 'store-isolation' }));
    assert.equal(deleted.error, undefined);
  }
}
