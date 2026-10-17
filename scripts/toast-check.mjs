import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const artifacts = resolve('.artifacts/toast');
mkdirSync(artifacts, { recursive: true });
const observations = [];
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path.endsWith('.js')) {
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end('window.originalRan = true;');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><html lang="en"><head><title>Toast delivery fixture</title>' +
    (path.startsWith('/case/') ? '<script src="/early.js"></script>' +
      (path.endsWith('/all') ? '<script src="/slow.js"></script>' : '') : '') +
    '</head><body><button id="host">Host control</button></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
function executable() {
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  return readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()
    .flatMap(name => ['chrome-win64', 'chrome-win'].map(folder => join(cache, name, folder, 'chrome.exe'))).find(existsSync);
}
const context = await chromium.launchPersistentContext(mkdtempSync(join(artifacts, 'profile-')), {
  headless: !process.argv.includes('--headed'), executablePath: executable(), viewport: { width: 390, height: 844 },
  args: ['--disable-extensions-except=' + resolve('.'), '--load-extension=' + resolve('.')],
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extension = 'chrome-extension://' + new URL(worker.url()).hostname;
const control = await context.newPage();
await control.goto(extension + '/dashboard/dashboard.html');
await worker.evaluate(() => {
  const execute = chrome.scripting.executeScript.bind(chrome.scripting);
  globalThis.toastProbe = { held: 0, calls: [], release: null, gate: null };
  chrome.scripting.executeScript = options => {
    if (options.func?.name === 'notifyAssetRule') toastProbe.calls.push(options);
    if (options.files?.includes('page-hook.js') && toastProbe.gate) {
      toastProbe.held++;
      return toastProbe.gate.then(() => execute(options));
    }
    return execute(options);
  };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.stack));
worker.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
const rules = [
  { id: 'page', name: 'Page fixture', resourceType: 'html', resourceSubtype: 'html',
    pairs: [{ id: 'page-url', urlPattern: origin + '/case/', urlOperator: 'Contains' }],
    response: { type: 'dynamic', body: 'function modifyResponse() { window.pageRanAt = performance.now(); }' } },
  { id: 'early', name: 'Early JS fixture', resourceType: 'html', resourceSubtype: 'js',
    pairs: [{ id: 'early-url', urlPattern: origin + '/early.js', urlOperator: 'Equals' }],
    response: { type: 'static', body: 'window.earlyRanAt = performance.now();' } },
  { id: 'slow', name: 'Slow JS fixture', resourceType: 'html', resourceSubtype: 'js',
    pairs: [{ id: 'slow-url', urlPattern: origin + '/slow.js', urlOperator: 'Equals' }],
    response: { type: 'dynamic', body: 'async function modifyResponse() { await new Promise(resolve => setTimeout(resolve, 1800)); return "window.slowRanAt = performance.now();"; }' } },
];
async function publish(next = rules) {
  const result = await control.evaluate(async rules => {
    await chrome.storage.local.set({ sfvi_theme: 'light' });
    return chrome.runtime.sendMessage({ type: 'IMPORT_RULES', rules });
  }, next);
  assert.equal(result.error, undefined);
}
async function holdHook() {
  await worker.evaluate(() => {
    toastProbe.held = 0; toastProbe.calls = [];
    toastProbe.gate = new Promise(resolve => { toastProbe.release = resolve; });
  });
}
async function releaseHook() {
  await worker.evaluate(() => { toastProbe.release(); toastProbe.gate = null; });
}
async function earlySuccess() {
  await page.waitForFunction(() => window.pageRanAt > 0 && window.earlyRanAt > 0);
  assert.equal(await page.locator('sfvi-t').count(), 0);
  assert.ok(await worker.evaluate(() => toastProbe.held > 0));
  return page.evaluate(() => ({ pageRanAt: window.pageRanAt, earlyRanAt: window.earlyRanAt, hookReleasedAt: performance.now() }));
}
async function settleNotices(count) {
  await page.waitForFunction(count => document.querySelectorAll('sfvi-t').length === count, count, { timeout: 6000 });
}
try {
  await publish();
  await holdHook();
  await page.goto(origin + '/case/all');
  const timing = await earlySuccess();
  assert.equal(await page.evaluate(() => window.slowRanAt), undefined);
  await releaseHook();
  await settleNotices(2);
  assert.equal(await page.evaluate(() => window.slowRanAt), undefined, 'Fast successes must not wait for the slow modifier');
  assert.deepEqual((await page.locator('sfvi-t').evaluateAll(nodes => nodes.map(node => node.getAttribute('ti')))).sort(), ['Early JS fixture', 'Page fixture']);
  assert.equal(await page.evaluate(() => document.querySelector('[data-sfvi-notifications]').style.getPropertyValue('--sfvi-surface')), '#fdfdfe');
  await page.waitForFunction(() => window.slowRanAt > 0);
  await settleNotices(3);
  observations.push({ probe: 'early-patches-do-not-wait-for-hook-and-notices-follow-independently', ...timing });

  const duplicate = await worker.evaluate(async () => {
    const options = toastProbe.calls[0];
    await chrome.scripting.executeScript({ target: options.target, files: ['page-hook.js'], world: 'MAIN' });
    return chrome.scripting.executeScript(options);
  });
  assert.equal(duplicate[0].result, false);
  assert.equal(await page.locator('sfvi-t').count(), 3);
  observations.push({ probe: 'hook-reinjection-and-repeated-notification-token-do-not-duplicate' });

  await holdHook();
  await page.goto(origin + '/case/config-change');
  await earlySuccess();
  await control.evaluate(() => { window.pendingToggle = chrome.runtime.sendMessage({ type: 'TOGGLE_RULE', id: 'early' }); });
  await control.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'GET_RULES' })).rules.find(rule => rule.id === 'early').enabled === false);
  await releaseHook();
  await control.evaluate(() => window.pendingToggle);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('sfvi-t').count(), 0);
  observations.push({ probe: 'configuration-change-while-hook-is-pending-suppresses-old-notices' });

  await publish();
  await holdHook();
  await page.goto(origin + '/case/navigating-away');
  await earlySuccess();
  await page.goto(origin + '/unmatched');
  await releaseHook();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('sfvi-t').count(), 0);
  observations.push({ probe: 'success-from-the-previous-document-never-notifies-the-new-page' });

  await publish(rules.map(rule => rule.id === 'early'
    ? { ...rule, response: { type: 'dynamic', body: 'function modifyResponse() { throw Error("Expected toast probe failure"); }' } } : rule));
  await page.goto(origin + '/case/failing-modifier');
  await page.waitForFunction(() => window.pageRanAt > 0);
  await settleNotices(1);
  await page.waitForTimeout(200);
  assert.deepEqual(await page.locator('sfvi-t').evaluateAll(nodes => nodes.map(node => node.getAttribute('ti'))), ['Page fixture']);
  observations.push({ probe: 'failed-modifier-is-never-announced-as-success' });

  await page.goto(origin + '/unmatched-initialization-retry');
  await page.waitForFunction(() => Reflect.ownKeys(window).filter(key => typeof key === 'symbol').some(key => window[key]?._sfvi === 1));
  const retry = await page.evaluate(() => {
    const hook = Reflect.ownKeys(window).filter(key => typeof key === 'symbol').map(key => window[key]).find(value => value?._sfvi === 1);
    const nativeSheet = window.CSSStyleSheet;
    const notice = { id: 'retry-fixture', statusLabel: 'Preview', name: 'Initialization recovered', color: '#22d3ee' };
    window.CSSStyleSheet = function () { window.CSSStyleSheet = nativeSheet; throw Error('Expected initialization failure'); };
    try { return { first: hook.notifyAsset(notice), second: hook.notifyAsset(notice), duplicate: hook.notifyAsset(notice) }; }
    finally { window.CSSStyleSheet = nativeSheet; }
  });
  assert.deepEqual(retry, { first: false, second: true, duplicate: false });
  assert.equal(await page.locator('sfvi-t').count(), 1);
  observations.push({ probe: 'transient-initialization-failure-can-retry-without-consuming-the-notification-token' });

  writeFileSync(join(artifacts, 'delivery-results.json'), JSON.stringify({ observations }, null, 2));
  console.log('Toast delivery probes passed:', observations.length, 'scenarios.');
} catch (error) {
  writeFileSync(join(artifacts, 'delivery-failure.json'), JSON.stringify({ error: error.stack, errors, observations,
    calls: await worker.evaluate(() => toastProbe.calls.map(options => ({ target: options.target, notification: options.args?.[0] }))),
    state: await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const snapshots = [];
      for (const tab of tabs.filter(tab => tab.url?.startsWith('http://127.0.0.1:'))) {
        const frames = await chrome.webNavigation.getAllFrames({tabId:tab.id});
        snapshots.push({tabId:tab.id,frames});
      }
      return {session:await chrome.storage.session.get('sfvi_activity'),snapshots};
    }) }, null, 2));
  await page.screenshot({ path: join(artifacts, 'delivery-failure.png') });
  throw error;
} finally {
  await context.close();
  await new Promise(resolve => server.close(resolve));
}
