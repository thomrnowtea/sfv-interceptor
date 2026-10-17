import { chromium } from 'playwright';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const artifacts = resolve('.artifacts/native-popup');
mkdirSync(artifacts, { recursive: true });
const observations = [];
function executable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  return readdirSync(cache).filter(name => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .flatMap(name => ['chrome-win64', 'chrome-win'].map(folder => join(cache, name, folder, 'chrome.exe'))).find(existsSync);
}

// Headful + viewport:null is essential: Chrome, not Playwright, must size the panel.
const context = await chromium.launchPersistentContext(mkdtempSync(join(artifacts, 'profile-')), {
  headless: false, executablePath: executable(), viewport: null,
  args: ['--disable-extensions-except=' + resolve('.'), '--load-extension=' + resolve('.'), '--window-size=1280,900'],
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const page = context.pages()[0];
const client = await context.newCDPSession(page);

async function waitForTarget(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const targets = (await client.send('Target.getTargets')).targetInfos;
    if (predicate(targets)) return targets;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Native popup target did not reach the expected state');
}

async function attach(targetId) {
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: false });
  const pending = new Map();
  let sequence = 0;
  const receive = event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    clearTimeout(task.timer);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  };
  client.on('Target.receivedMessageFromTarget', receive);
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Popup CDP timeout: ' + method)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      client.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(error => {
        clearTimeout(timer); pending.delete(id); reject(error);
      });
    });
  }
  async function evaluate(fn, argument) {
    const response = await send('Runtime.evaluate', {
      expression: '(' + fn.toString() + ')(' + JSON.stringify(argument ?? null) + ')', awaitPromise: true, returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  }
  return { send, evaluate, dispose: () => client.off('Target.receivedMessageFromTarget', receive) };
}

async function openAndCheck(label, expectedCount, applied = []) {
  await worker.evaluate(() => chrome.action.openPopup());
  const targets = await waitForTarget(items => items.some(target => target.url.endsWith('/popup/popup.html')));
  const target = targets.find(item => item.url.endsWith('/popup/popup.html'));
  const popup = await attach(target.targetId);
  const geometry = await popup.evaluate(async expected => {
    await document.fonts.ready;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (document.querySelectorAll('.rule-item').length === expected && document.querySelector('.rule-item, .empty')) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const list = document.getElementById('rules-list');
    const footer = document.querySelector('footer').getBoundingClientRect();
    return {
      native: chrome.extension.getViews({ type: 'popup' }).includes(window),
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      body: { width: document.body.clientWidth, height: document.body.clientHeight, scrollHeight: document.body.scrollHeight },
      list: { height: list.clientHeight, scrollHeight: list.scrollHeight },
      footer: { top: footer.top, bottom: footer.bottom },
      count: document.querySelectorAll('.rule-item').length,
      applied: [...document.querySelectorAll('.rule-item.applied')].map(element => element.dataset.ruleId),
      font: document.fonts.check('600 13px Manrope'), error: !document.getElementById('popup-error').hidden,
      ruleControls: [...document.querySelectorAll('.rule-item')].map(row => ({
        toggles: row.querySelectorAll('[data-toggle]').length, buttons: row.querySelectorAll('button').length,
      })),
      newRule: document.getElementById('new-rule')?.checkVisibility() ?? false,
      activationColumns: [...document.querySelectorAll('[data-toggle]')].map(input => input.getBoundingClientRect().left),
    };
  }, expectedCount);
  observations.push({ label, ...geometry });
  assert.equal(geometry.native, true, 'Must be a Chrome toolbar popup, not a tab or popup window');
  assert.equal(geometry.width, 360); assert.equal(geometry.height, 500);
  assert.equal(geometry.count, expectedCount); assert.equal(geometry.font, true);
  for (const controls of geometry.ruleControls) assert.deepEqual(controls, { toggles: 1, buttons: 0 });
  assert.equal(geometry.newRule, true, 'New rule remains available in the popup header');
  if (geometry.activationColumns.length) assert.ok(Math.max(...geometry.activationColumns) - Math.min(...geometry.activationColumns) <= 0.5, 'Local and remote switches must share a column');
  assert.deepEqual(geometry.applied, applied);
  assert.ok(geometry.body.scrollHeight <= geometry.body.height + 1);
  assert.ok(geometry.list.height > 40 && geometry.footer.bottom <= geometry.height + 1);
  if (expectedCount > 7) assert.ok(geometry.list.scrollHeight > geometry.list.height);
  if (!applied.length) await popup.evaluate(() => { const list = document.getElementById('rules-list'); list.scrollTop = list.scrollHeight; });
  const screenshot = await popup.send('Page.captureScreenshot');
  writeFileSync(join(artifacts, label + '.png'), Buffer.from(screenshot.data, 'base64'));
  console.log('Native popup passed:', label, geometry.width + 'x' + geometry.height);
  return {
    ...popup,
    close: async () => {
      await popup.evaluate(() => { setTimeout(() => window.close(), 0); });
      await waitForTarget(items => !items.some(item => item.targetId === target.targetId));
      popup.dispose();
    },
  };
}

try {
  await page.goto('about:blank');
  const empty = await openAndCheck('empty', 0); await empty.close();
  const rules = Array.from({ length: 24 }, (_, index) => ({
    id: 'native-' + index, name: 'Native popup rule ' + (index + 1), resourceType: 'rest', enabled: true,
    version: '1.0.0', urlPattern: '/api/native/' + index, responseBody: '{}',
  }));
  const source = { id: 'source_native', name: 'Read-only shared rules', url: 'https://fixtures.sfvi.test/native.json', intervalMinutes: 60,
    rules: [{ ...rules[0], id: 'published', name: 'Published remote response', version: '2.5.0' }] };
  await worker.evaluate(({ rules, source }) => chrome.storage.local.set({ sfvi_rules: rules, sfvi_sources: [source], sfvi_theme: 'default' }), { rules, source });
  const dark = await openAndCheck('dark-many', 25);
  await dark.evaluate(async () => {
    document.querySelector('[data-toggle="remote:source_native:published"]').click();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (document.querySelectorAll('.rule-item').length === 24) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Remote off switch did not update native popup filtering');
  });
  await dark.close();
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('sfvi_sources'))).sfvi_sources[0].rules[0].enabled, true);
  const remoteOff = await openAndCheck('remote-off', 24);
  await remoteOff.evaluate(async () => {
    document.querySelector('[data-tab="all"]').click();
    document.querySelector('[data-toggle="remote:source_native:published"]').click();
    for (let attempt = 0; attempt < 100; attempt++) {
      const data = await chrome.storage.local.get('sfvi_sources');
      if (data.sfvi_sources[0].enabledOverrides.published === true) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Remote on switch did not persist in native popup');
  });
  await remoteOff.close();
  await context.route('https://native.sfvi.test/**', route => route.fulfill({
    contentType: route.request().url().includes('/api/') ? 'application/json' : 'text/html',
    body: route.request().url().includes('/api/') ? '{"original":true}' : '<!doctype html><title>Native activity</title><p>Popup activity fixture</p>',
  }));
  await page.goto('https://native.sfvi.test/');
  let mocked = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    mocked = await page.evaluate(async () => (await (await fetch('/api/native/0')).text()) === '{}');
    if (mocked) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(mocked, true);
  const appliedDark = await openAndCheck('applied-dark', 25, ['native-0']); await appliedDark.close();
  await worker.evaluate(() => chrome.storage.local.set({ sfvi_theme: 'light' }));
  const light = await openAndCheck('light-many', 25, ['native-0']); await light.close();
  await worker.evaluate(() => chrome.storage.local.set({ sfvi_apply_error: 'Could not apply file rules. Last valid rules remain available.' }));
  const error = await openAndCheck('error', 25, ['native-0']);
  assert.equal(observations.at(-1).error, true);
  await error.evaluate(() => { setTimeout(() => document.getElementById('open-dashboard').click(), 0); });
  await worker.evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await chrome.tabs.query({})).some(tab => tab.url?.includes('/dashboard/dashboard.html'))) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Native popup dashboard action failed');
  });
  error.dispose();
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({
    session: { browser: 'headful isolated Chromium', surface: 'chrome.action.openPopup', viewportOverride: false, nativeZoom: 'not exercised' }, observations,
  }, null, 2));
  console.log('Native action popup checks passed: cold open, reopen, empty, many local/remote rules, themes, error, and dashboard action.');
} finally { await context.close(); }
