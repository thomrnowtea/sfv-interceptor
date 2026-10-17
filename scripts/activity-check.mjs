import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const artifacts = resolve('.artifacts/activity');
mkdirSync(artifacts, { recursive: true });
const observations = [];
let slowResponse;
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/offline') { request.socket.destroy(); return; }
  if (path === '/api/slow') { slowResponse = response; return; }
  if (path === '/boundary.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end('window.patchedAtParserBoundary = window.patchedJs === true; window.parserBoundaryAt = Date.now();');
    return;
  }
  if (path.endsWith('.js')) {
    response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end('window.originalLoaded = true;'); return;
  }
  if (path.endsWith('.css')) {
    response.writeHead(200, { 'Content-Type': 'text/css' }); response.end('body { color: black; }'); return;
  }
  if (path.startsWith('/api/') || path === '/graphql') {
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"original":true}'); return;
  }
  const headers = { 'Content-Type': 'text/html' };
  if (path === '/assets-csp') headers['Content-Security-Policy'] = "script-src 'self' blob: 'unsafe-eval'; style-src 'self' 'unsafe-inline';";
  response.writeHead(200, headers);
  response.end('<!doctype html><html lang="en"><head><title>Activity fixture</title>' +
    (path === '/assets' ? '<script src="/fixture.js"></script><script>window.patchedAtParserBoundary = window.patchedJs === true; window.parserBoundaryAt = Date.now();</script><link rel="stylesheet" href="/fixture.css">' : '') +
    (path === '/assets-csp' ? '<script src="/fixture.js"></script><script src="/boundary.js"></script><link rel="stylesheet" href="/fixture.css">' : '') +
    '</head><body><button>Host control</button><main>Activity fixture</main></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
function executable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  return readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()
    .flatMap(name => ['chrome-win64', 'chrome-win'].map(folder => join(cache, name, folder, 'chrome.exe'))).find(existsSync);
}
const context = await chromium.launchPersistentContext(mkdtempSync(join(artifacts, 'profile-')), {
  headless: true, executablePath: executable(), viewport: { width: 1280, height: 900 },
  args: ['--disable-extensions-except=' + resolve('.'), '--load-extension=' + resolve('.')],
  ignoreDefaultArgs: ['--disable-back-forward-cache'],
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extension = 'chrome-extension://' + new URL(worker.url()).hostname;
await worker.evaluate(() => {
  globalThis.activityDebug = [];
  chrome.webNavigation.onCommitted.addListener(event => activityDebug.push({ kind: 'committed', at: Date.now(), event }));
  const execute = chrome.scripting.executeScript.bind(chrome.scripting);
  chrome.scripting.executeScript = options => {
    if (options.func?.name === 'applyAssetRule') {
      activityDebug.push({ kind: 'asset-injection', at: Date.now(), url: options.args?.[0]?.url });
    }
    return execute(options);
  };
});
await context.addInitScript(() => {
  window.activityReports = [];
  window.hookUpdates = [];
  window.bfcacheRestored = false;
  window.addEventListener('pageshow', event => { window.bfcacheRestored = event.persisted; });
  window.addEventListener('__sfvi_applied__', event => window.activityReports.push(event.detail));
  window.addEventListener('message', event => {
    if (event.data?.type === '__sfvi_hook_data__') window.hookUpdates.push(event.data);
  });
});
const control = await context.newPage();
await control.goto(extension + '/dashboard/dashboard.html');
let targetTabId;
function rule(id, path, overrides = {}) {
  return { id, name: id + ' rule', version: '1.0.0', enabled: true, resourceType: 'rest',
    pairs: [{ id: id + '|pair', urlPattern: path, urlOperator: 'Contains', method: 'GET' }],
    request: { type: 'static', body: '', customHeaders: '' },
    response: { type: 'static', body: '{"mock":true}', statusCode: '200', delay: 0, customHeaders: '' }, ...overrides };
}
async function publish(rules, sources = []) {
  const response = await control.evaluate(async ({ rules, sources }) => {
    await chrome.storage.local.set({ sfvi_sources: sources });
    return chrome.runtime.sendMessage({ type: 'IMPORT_RULES', rules });
  }, { rules, sources });
  assert.equal(response.error, undefined);
}
async function activity(tabId = targetTabId) {
  return control.evaluate(tabId => chrome.runtime.sendMessage({ type: 'GET_TAB_ACTIVITY', tabId }), tabId);
}
async function expectApplied(expected, tabId = targetTabId) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const actual = await activity(tabId);
    if (JSON.stringify([...actual.appliedRuleIds].sort()) === JSON.stringify([...expected].sort())) return actual;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  writeFileSync(join(artifacts, 'failure.json'), JSON.stringify({ expected, tabId,
    pages: await Promise.all(context.pages().map(async page => ({ url: page.url(), evidence: await page.evaluate(() => ({ reports: window.activityReports, updates: window.hookUpdates, body: document.body?.innerText, fetch: String(window.fetch) })).catch(() => null) }))),
    worker: await worker.evaluate(async () => ({ events: activityDebug, session: await chrome.storage.session.get('sfvi_activity'), tabs: await chrome.tabs.query({}) })),
  }, null, 2));
  assert.deepEqual((await activity(tabId)).appliedRuleIds.sort(), [...expected].sort());
}
async function ready(page, timeout = 5000) {
  await page.waitForFunction(() => Reflect.ownKeys(window).some(key => typeof key === 'symbol' && window[key]?._sfvi === 1));
  // A nonempty mock proves that the content/MAIN handshake finished.
  const deadline = Date.now() + timeout;
  let body, attempts = 0;
  do {
    body = await page.evaluate(async () => (await (await fetch('/api/ready')).text()));
    attempts++;
    if (JSON.parse(body).mock === true) return { body, attempts };
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error('API handshake did not publish the ready mock; last response: ' + body);
}

async function clearToasts(page) {
  await page.evaluate(() => document.querySelectorAll('sfvi-t').forEach(element => element.remove()));
}

async function checkToastColor(page, expected, label) {
  const session = await context.newCDPSession(page);
  await session.send('DOM.enable');
  const tree = await session.send('DOM.getDocument', { depth: -1, pierce: true });
  const hosts = [];
  function collect(node) {
    if (node.localName === 'sfvi-t') hosts.push(node);
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) collect(child);
  }
  collect(tree.root);
  assert.equal(hosts.length, 1, label + ': one success toast, no duplicate legacy toast');
  const resolved = await session.send('DOM.resolveNode', { nodeId: hosts[0].shadowRoots[0].nodeId });
  const colors = await session.send('Runtime.callFunctionOn', { objectId: resolved.object.objectId, returnByValue: true,
    functionDeclaration: 'function(){return {marker:getComputedStyle(this.querySelector(".mark")).color,progress:getComputedStyle(this.querySelector(".progress-fill")).backgroundColor};}' });
  assert.equal(colors.result.value.marker, expected, label);
  assert.equal(colors.result.value.progress, expected, label);
  observations.push({ probe: 'real-execution-toast-color', label, ...colors.result.value });
  await session.detach();
}
async function xhr(page, url) {
  return page.evaluate(url => new Promise(resolve => {
    const request = new XMLHttpRequest(); request.open('GET', url);
    request.onload = () => resolve(request.responseText); request.send();
  }), url);
}

try {
  const rules = [rule('ready', '/api/ready'), rule('fetch|parent', '/api/first'), rule('xhr', '/api/second'),
    rule('graphql', '/graphql', { resourceType: 'graphql' }),
    rule('child', '/api/child'),
    rule('never', '/api/never'), rule('broken', '/api/broken', { response: { type: 'dynamic', body: 'function modifyResponse(){ throw new Error("Expected transform failure"); }' } }),
    rule('noop', '/api/noop', { response: { type: 'static', body: '' } }),
    rule('invalid-status', '/api/invalid', { response: { type: 'static', body: '{}', statusCode: '204' } }),
    rule('delayed', '/api/delay', { response: { type: 'static', body: '{"delayed":true}', delay: 600 } }),
    rule('network-only', '/offline', { response: { type: 'dynamic', body: '' } }),
  ];
  await publish(rules);
  const page = await context.newPage();
  await page.goto(origin + '/first'); await ready(page);
  targetTabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  await expectApplied(['ready']);
  await page.evaluate(() => {
    const previous = window.fetch;
    window.readinessCalls = 0;
    window.restoreReadiness = () => { window.fetch = previous; };
    window.fetch = (...args) => {
      if (args[0] === '/api/ready' && ++window.readinessCalls <= 2) return Promise.resolve(new Response('{"original":true}'));
      return previous(...args);
    };
  });
  const readiness = await ready(page);
  assert.ok(readiness.attempts >= 3);
  await page.evaluate(() => window.restoreReadiness());
  observations.push({ probe: 'readiness-retries-false-then-true', ...readiness });
  await page.evaluate(() => {
    const previous = window.fetch;
    window.restoreReadiness = () => { window.fetch = previous; };
    window.fetch = (...args) => args[0] === '/api/ready' ? Promise.resolve(new Response('{"original":true}')) : previous(...args);
  });
  await assert.rejects(ready(page, 80), /last response:.*original/);
  await page.evaluate(() => window.restoreReadiness());
  const contextGuard = await page.evaluate(async () => {
    const published = window.hookUpdates.at(-1);
    const hook = Reflect.ownKeys(window).filter(key => typeof key === 'symbol').map(key => window[key]).find(value => value?._sfvi === 1);
    hook.updateApis([], published.activity);
    hook.updateApis(published.apis, null);
    const withoutContext = await (await fetch('/api/ready')).text();
    hook.updateApis(published.apis, published.activity);
    const recovered = await (await fetch('/api/ready')).text();
    hook.updateApis(published.apis, null);
    const retained = await (await fetch('/api/ready')).text();
    return { withoutContext, recovered, retained };
  });
  assert.equal(JSON.parse(contextGuard.withoutContext).original, true);
  assert.equal(JSON.parse(contextGuard.recovered).mock, true);
  assert.equal(JSON.parse(contextGuard.retained).mock, true);
  observations.push({ probe: 'generated-descriptors-require-captured-context', ...contextGuard });
  const both = await Promise.all([page.evaluate(async () => (await fetch('/api/first')).text()), xhr(page, '/api/second')]);
  assert.ok(both.every(body => body.includes('mock')));
  await expectApplied(['ready', 'fetch|parent', 'xhr']);
  await clearToasts(page);
  await xhr(page, '/graphql');
  await checkToastColor(page, 'rgb(251, 113, 133)', 'GraphQL XHR');
  await clearToasts(page);
  await page.evaluate(async () => (await fetch('/graphql')).text());
  await checkToastColor(page, 'rgb(251, 113, 133)', 'GraphQL fetch');
  await clearToasts(page);
  await page.evaluate(async () => {
    await fetch('/api/broken'); await fetch('/api/noop');
    await fetch('/api/invalid').catch(() => {}); await fetch('/offline').catch(() => {});
  });
  await xhr(page, '/api/broken');
  await expectApplied(['ready', 'fetch|parent', 'xhr', 'graphql']);
  observations.push({ probe: 'fetch-xhr-success-and-failure-boundaries', ...(await activity()) });

  const pendingXhr = xhr(page, '/api/delay');
  await page.waitForTimeout(180);
  assert.ok(!(await activity()).appliedRuleIds.includes('delayed'));
  assert.match(await pendingXhr, /delayed/);
  await expectApplied(['ready', 'fetch|parent', 'xhr', 'graphql', 'delayed']);
  observations.push({ probe: 'xhr-delay-reports-at-delivery' });

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 500 });
  await popup.emulateMedia({ reducedMotion: 'reduce' });
  await page.bringToFront();
  await popup.goto(extension + '/popup/popup.html');
  await popup.locator('.rule-item.applied').first().waitFor();
  assert.equal(await popup.locator('.rule-item.applied').count(), 5);
  assert.equal(await popup.locator('[aria-label="Applied on this page"]').count(), 5);
  assert.equal(await popup.locator('[data-rule-id="never"]').evaluate(element => element.classList.contains('applied')), false);
  assert.equal(await popup.locator('[data-rule-id="never"] input').isChecked(), true);
  await popup.screenshot({ path: join(artifacts, 'popup-applied-dark.png') });
  for (const theme of ['default', 'light']) {
    await page.bringToFront();
    await worker.evaluate(theme => chrome.storage.local.set({ sfvi_theme: theme }), theme);
    await popup.waitForFunction(theme => document.documentElement.dataset.scheme === theme, theme === 'light' ? 'light' : 'dark');
    await popup.waitForFunction(() => document.querySelectorAll('.rule-item.applied').length === 5);
    // Default axe aggregation opens another tab, changing the active-tab indicator.
    // This frame-free extension view can run axe in place without that side effect.
    const scan = await new AxeBuilder({ page: popup }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    writeFileSync(join(artifacts, 'axe-' + theme + '.json'), JSON.stringify(scan, null, 2));
    assert.equal(scan.violations.length, 0, JSON.stringify(scan.violations));
    assert.equal(await popup.locator('.rule-item.applied').count(), 5);
    observations.push({ probe: 'applied-popup-accessibility', theme, violations: scan.violations.length });
  }
  await popup.screenshot({ path: join(artifacts, 'popup-applied-light.png') });
  await popup.close();
  await page.bringToFront();
  await page.evaluate(() => history.pushState(null, '', '#same-document'));
  await expectApplied(['ready', 'fetch|parent', 'xhr', 'graphql', 'delayed']);
  await page.reload(); await ready(page);
  await expectApplied(['ready']);
  observations.push({ probe: 'reload-clears-same-document-retains' });

  await page.evaluate(() => { const frame = document.createElement('iframe'); frame.src = '/child-frame'; document.body.appendChild(frame); });
  await page.waitForFunction(() => document.querySelector('iframe[src="/child-frame"]')?.contentDocument?.readyState === 'complete');
  const child = page.frames().find(frame => frame.url().endsWith('/child-frame'));
  await ready(child);
  await child.evaluate(async () => (await fetch('/api/child')).text());
  await expectApplied(['ready', 'child']);
  await child.goto(origin + '/child-next'); await ready(child);
  await expectApplied(['ready', 'child']);
  await page.reload(); await ready(page); await expectApplied(['ready']);
  observations.push({ probe: 'real-child-success-and-frame-navigation' });

  const other = await context.newPage(); await other.goto(origin + '/other'); await ready(other);
  const otherId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, other.url());
  await expectApplied(['ready'], otherId);
  await page.evaluate(async () => (await fetch('/api/first')).text());
  await expectApplied(['ready', 'fetch|parent']);
  await expectApplied(['ready'], otherId);
  await publish(rules);
  await expectApplied(['ready', 'fetch|parent']);
  await publish(rules.map(item => ({ ...item, version: '2.0.0' })));
  await expectApplied([]);
  await page.evaluate(async () => (await fetch('/api/first')).text());
  await expectApplied(['fetch|parent']);
  observations.push({ probe: 'tab-isolation-unchanged-and-changed-publication' });

  const pendingRule = rule('pending', '/api/slow', { response: { type: 'dynamic', body: 'function modifyResponse(args){return args.response;}' } });
  await publish([...rules, pendingRule]);
  await page.evaluate(() => { window.pendingResult = fetch('/api/slow').then(response => response.text()); });
  for (let attempt = 0; attempt < 100 && !slowResponse; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(slowResponse, 'Old-revision request reached the fixture server');
  await publish([...rules, { ...pendingRule, version: '3.0.0' }]);
  slowResponse.end('delayed result');
  assert.equal(await page.evaluate(() => window.pendingResult), 'delayed result');
  await expectApplied([]);
  observations.push({ probe: 'pending-old-revision-completion-is-rejected' });

  await ready(page);
  await page.evaluate(async () => (await fetch('/api/first')).text());
  const beforeBack = await expectApplied(['ready', 'fetch|parent']);
  await page.goto(origin + '/back-forward-target'); await ready(page); await expectApplied(['ready']);
  await page.goBack({ waitUntil: 'commit' }); await ready(page); await expectApplied(['ready']);
  const afterBack = await activity();
  assert.notEqual(afterBack.activity.cycleId, beforeBack.activity.cycleId);
  observations.push({ probe: 'back-forward-activation', restoredFromBFCache: await page.evaluate(() => window.bfcacheRestored), before: beforeBack.activity, after: afterBack.activity });

  const pageRules = [rule('page-success', '/assets', { resourceType: 'html', resourceSubtype: 'html', response: { type: 'dynamic', body: 'async function modifyResponse(){ await Promise.resolve(); window.pageApplied = true; }' } }),
    rule('page-failure', '/assets', { resourceType: 'html', resourceSubtype: 'html', response: { type: 'dynamic', body: 'function modifyResponse(){ throw Error("Expected page failure"); }' } }),
    rule('file-js', '/fixture.js', { resourceType: 'html', resourceSubtype: 'js', response: { type: 'static', body: "'use strict'; window.patchedJs = true; window.patchedScriptAt = Date.now();" } }),
    rule('file-css', '/fixture.css', { resourceType: 'html', resourceSubtype: 'css', response: { type: 'static', body: 'body { background: rgb(1, 2, 3); }' } }),
  ];
  await publish(pageRules);
  await page.goto(origin + '/assets');
  await page.waitForFunction(() => window.pageApplied && window.patchedJs);
  // Keep parser ordering as a measured signal: injectImmediately is best effort,
  // so an immediate inline boundary can run before the service-worker injection.
  const parserTiming = await page.evaluate(() => ({
    replacedAtParserBoundary: window.patchedAtParserBoundary,
    parserBoundaryAt: window.parserBoundaryAt,
    patchedScriptAt: window.patchedScriptAt,
  }));
  parserTiming.injectionIssuedAt = await worker.evaluate(url => activityDebug.findLast(item => item.kind === 'asset-injection' && item.url === url)?.at ?? null, origin + '/fixture.js');
  parserTiming.replacementDelayMs = parserTiming.patchedScriptAt - parserTiming.parserBoundaryAt;
  observations.push({ probe: 'asset-replacement-parser-timing', ...parserTiming });
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(1, 2, 3)');
  await expectApplied(['page-success', 'file-js', 'file-css']);
  observations.push({ probe: 'actual-page-js-css-success-and-page-failure', ...(await activity()) });
  for (const asynchronous of [false, true]) {
    const body = (asynchronous ? 'async ' : '') + 'function modifyResponse(args) {' +
      (asynchronous ? ' await Promise.resolve();' : '') +
      ' return args.response + ";window.dynamicPatched = true;"; }';
    await publish(pageRules.map(item => item.id === 'file-js'
      ? { ...item, response: { type: 'dynamic', body } } : item));
    await page.goto(origin + '/assets');
    await page.waitForFunction(() => window.originalLoaded && window.dynamicPatched);
    await expectApplied(['page-success', 'file-js', 'file-css']);
    await page.reload();
    await page.waitForFunction(() => window.originalLoaded && window.dynamicPatched);
    await expectApplied(['page-success', 'file-js', 'file-css']);
    observations.push({ probe: 'dynamic-file-replacement-through-real-script-transport', asynchronous, coldAndCachedSource: true });
  }
  await publish(pageRules);
  await page.goto(origin + '/assets-csp');
  await page.waitForFunction(() => window.pageApplied && window.patchedJs && window.parserBoundaryAt);
  const cspFallback = await page.evaluate(() => ({ patched: window.patchedJs, parserObservedPatch: window.patchedAtParserBoundary,
    replacementDelayMs: window.patchedScriptAt - window.parserBoundaryAt }));
  assert.equal(cspFallback.patched, true);
  await expectApplied(['page-success', 'file-js', 'file-css']);
  observations.push({ probe: 'inline-policy-falls-back-to-blob', ...cspFallback });
  await publish(pageRules.map(item => item.id === 'file-js' ? { ...item, response: { type: 'static', body: 'throw Error("Expected synchronous blob failure");' } } : item));
  await page.reload();
  await page.waitForFunction(() => window.pageApplied);
  await expectApplied(['page-success', 'file-css']);
  observations.push({ probe: 'synchronous-blob-error-does-not-mark-applied' });
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ observations }, null, 2));
  console.log('Activity browser probes passed:', observations.length, 'scenarios.');
} finally {
  slowResponse?.end();
  await context.close();
  await new Promise(resolve => server.close(resolve));
}
