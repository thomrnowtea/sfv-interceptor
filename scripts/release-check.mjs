// Load the extracted release, never the repository, into an isolated browser.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { unzipSync } from 'fflate';
import { projectRoot, releaseFileNames } from './package-release.mjs';
import { checkStoreIsolation } from './store-isolation.mjs';

const artifacts = resolve(projectRoot, '.artifacts/release');
mkdirSync(artifacts, { recursive: true });
const { version } = JSON.parse(readFileSync(join(projectRoot, 'manifest.json')));
const zipName = `sfv-interceptor-v${version}.zip`;
const zipPath = join(projectRoot, 'dist', zipName);
assert.ok(existsSync(zipPath), 'Run npm run package before npm run test:release.');
const archive = readFileSync(zipPath);
const checksum = createHash('sha256').update(archive).digest('hex');
assert.equal(readFileSync(zipPath + '.sha256', 'utf8'), `${checksum}  ${zipName}\n`);
const files = unzipSync(archive);
assert.deepEqual(Object.keys(files).sort(), releaseFileNames());
const unpacked = mkdtempSync(join(artifacts, 'unpacked-'));
for (const [name, bytes] of Object.entries(files)) {
  assert.ok(Buffer.from(bytes).equals(readFileSync(join(projectRoot, name))), `Stale release file: ${name}`);
  const destination = join(unpacked, name); // All names were validated by releaseFileNames.
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}

function executable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  return readdirSync(cache).filter(name => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .flatMap(name => ['chrome-win64', 'chrome-win'].map(folder => join(cache, name, folder, 'chrome.exe'))).find(existsSync);
}

const errors = [];
const observedAssets = new Set();
let isolationEvidence;
const context = await chromium.launchPersistentContext(mkdtempSync(join(artifacts, 'profile-')), {
  headless: true, executablePath: executable(), viewport: { width: 1280, height: 900 },
  args: ['--disable-extensions-except=' + unpacked, '--load-extension=' + unpacked],
});
context.on('page', page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => {
    if (request.url().startsWith('chrome-extension://')) errors.push(request.url() + ': ' + request.failure()?.errorText);
  });
  page.on('response', response => {
    if (response.url().startsWith('chrome-extension://')) observedAssets.add(new URL(response.url()).pathname.slice(1));
  });
});

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
  const extension = 'chrome-extension://' + new URL(worker.url()).hostname;
  const dashboard = await context.newPage();
  await dashboard.goto(extension + '/dashboard/dashboard.html');
  await dashboard.locator('#btn-new').waitFor();
  const storeIcon = await dashboard.evaluate(async () => {
    const image = new Image();
    image.src = chrome.runtime.getURL(chrome.runtime.getManifest().icons['128']);
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const drawing = canvas.getContext('2d');
    drawing.drawImage(image, 0, 0);
    const { data } = drawing.getImageData(0, 0, image.width, image.height);
    let left = image.width, top = image.height, right = -1, bottom = -1;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (!data[(y * image.width + x) * 4 + 3]) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    return { width: image.width, height: image.height, left, top, right, bottom };
  });
  assert.deepEqual(storeIcon, { width: 128, height: 128, left: 16, top: 16, right: 111, bottom: 111 }, 'Packaged store icon has 96px artwork and transparent padding');
  const initial = await dashboard.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_RULES' }));
  assert.deepEqual(initial.rules, [], 'Release starts without bundled rules or user settings');
  assert.equal(await dashboard.locator('.logo [data-extension-version]').innerText(), 'v' + version);
  const emptyPopup = await context.newPage();
  await emptyPopup.setViewportSize({ width: 360, height: 500 });
  await emptyPopup.goto(extension + '/popup/popup.html');
  await emptyPopup.locator('.empty').waitFor();
  assert.equal(await emptyPopup.locator('[data-extension-version]').innerText(), 'v' + version);
  assert.equal(await emptyPopup.locator('#new-rule').isVisible(), true);
  await emptyPopup.close();
  for (const theme of ['default', 'light']) {
    await worker.evaluate(theme => chrome.storage.local.set({ sfvi_theme: theme }), theme);
    await dashboard.goto(extension + '/dashboard/dashboard.html');
    await dashboard.locator('.empty-main').waitFor();
    for (const width of [1280, 360]) {
      await dashboard.setViewportSize({ width, height: 900 });
      await dashboard.evaluate(() => document.fonts.ready);
      assert.equal(await dashboard.locator('.logo [data-extension-version]').innerText(), 'v' + version);
      assert.equal(await dashboard.locator('#btn-setup, #btn-engine-status').count(), 0);
      assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true);
      const accessibility = await new AxeBuilder({ page: dashboard }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(accessibility.violations, [], `Dashboard accessibility: ${theme}/${width}`);
      await dashboard.locator('#btn-theme').click();
      await dashboard.locator('#theme-panel').waitFor({ state: 'visible' });
      await dashboard.keyboard.press('Escape');
      assert.equal(await dashboard.locator('#btn-theme').evaluate(element => element === document.activeElement), true);
      await dashboard.screenshot({ path: join(artifacts, `dashboard-empty-${theme}-${width}.png`) });
    }
  }
  await dashboard.setViewportSize({ width: 1280, height: 900 });
  const rule = {
    id: 'release-smoke', name: 'Release smoke rule', version: '1.0.0', enabled: true, resourceType: 'rest',
    pairs: [{ id: 'release-pair', urlPattern: '/api/release', urlOperator: 'Contains', method: 'GET' }],
    request: { type: 'static', body: '', customHeaders: '' },
    response: { type: 'dynamic', body: 'function modifyResponse(args){return {...args.responseJSON,packaged:true}}', statusCode: '200', delay: 0, customHeaders: '' },
  };
  const saved = await dashboard.evaluate(rule => chrome.runtime.sendMessage({ type: 'SAVE_RULE', rule }), rule);
  assert.equal(saved.error, undefined);
  await dashboard.locator('[data-id="release-smoke"] .nav-rule-open').click();
  await dashboard.locator('#dynamic-body-field .cm-content').waitFor();
  assert.equal(await dashboard.locator('.logo [data-extension-version]').innerText(), 'v' + version);
  const formatted = await dashboard.evaluate(async rule => {
    const { formatJS } = await import(chrome.runtime.getURL('dashboard/editor/formatter.js'));
    const { serializeRules } = await import(chrome.runtime.getURL('dashboard/editor/compact.js'));
    return { pretty: await formatJS(rule.response.body), compact: await serializeRules([rule]) };
  }, rule);
  assert.ok(formatted.pretty.includes('\n'));
  assert.equal(formatted.compact.includes('\n'), false);
  assert.equal(JSON.parse(formatted.compact)[0].response.body.includes('\n'), false);
  const reviewSource = 'function modifyResponse(args) { const cookie = document.cookie; fetch("/preview"); return args.response; }';
  await dashboard.evaluate(async code => {
    const { setEditorValue } = await import(chrome.runtime.getURL('dashboard/editor/editor.js'));
    setEditorValue('f-body-dynamic', code);
  }, reviewSource);
  await dashboard.locator('#sfvi-risk-bar [data-risk-id="cookie_read"]').click();
  await dashboard.waitForFunction(() => [...(CSS.highlights.get('sfvi-risk-high') || [])].some(range => range.toString() === 'document.cookie'));
  assert.equal(await dashboard.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1), true);
  const unchanged = await dashboard.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_RULES' }));
  assert.equal(unchanged.rules[0].response.body, rule.response.body, 'Flag inspection must not change the saved executable rule');
  await dashboard.evaluate(() => document.fonts.ready);
  assert.equal(await dashboard.evaluate(() => document.fonts.check('600 13px Manrope')), true);
  await dashboard.screenshot({ path: join(artifacts, 'dashboard.png') });
  isolationEvidence = await checkStoreIsolation({ context, worker, control: dashboard });

  await context.route('https://release.sfvi.test/**', route => route.fulfill({
    contentType: route.request().url().includes('/api/') ? 'application/json' : 'text/html',
    body: route.request().url().includes('/api/') ? '{"origin":"fixture"}' : '<!doctype html><title>Release fixture</title><p>Packaged extension interception</p>',
  }));
  const host = await context.newPage();
  await host.goto('https://release.sfvi.test/');
  await host.waitForFunction(async () => (await (await fetch('/api/release')).json()).packaged === true, null, { timeout: 10000, polling: 100 });
  // Headless focus may stay on another tab; inspect the actual fixture tab and
  // wait for the asynchronous success notification to reach the worker.
  await dashboard.waitForFunction(async id => {
    const [tab] = await chrome.tabs.query({ url: 'https://release.sfvi.test/*' });
    if (!tab) return false;
    const activity = await chrome.runtime.sendMessage({ type: 'GET_TAB_ACTIVITY', tabId: tab.id });
    return activity.appliedRuleIds.includes(id);
  }, rule.id);

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 500 });
  await popup.goto(extension + '/popup/popup.html');
  await popup.locator('[data-toggle="release-smoke"]').waitFor();
  assert.equal(await popup.locator('[data-extension-version]').innerText(), 'v' + version);
  assert.equal(await popup.locator('#new-rule').isVisible(), true);
  assert.equal(await popup.locator('[data-edit], [data-del]').count(), 0);
  for (const theme of ['default', 'light']) {
    await worker.evaluate(theme => chrome.storage.local.set({ sfvi_theme: theme }), theme);
    await popup.waitForFunction(scheme => document.documentElement.dataset.scheme === scheme, theme === 'light' ? 'light' : 'dark');
    assert.equal(await popup.evaluate(() => document.body.scrollHeight <= document.body.clientHeight + 1), true);
    await popup.screenshot({ path: join(artifacts, `popup-${theme}.png`) });
  }
  await popup.locator('[data-toggle="release-smoke"]').uncheck();
  await popup.locator('.empty').waitFor();
  const stored = await dashboard.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_RULES' }));
  assert.equal(stored.rules[0].enabled, false);
  const [opened] = await Promise.all([context.waitForEvent('page'), popup.locator('#open-dashboard').click()]);
  await opened.waitForURL(extension + '/dashboard/dashboard.html');
  await opened.locator('#btn-new').waitFor();
  for (const required of ['dashboard/editor/codemirror-bundle.js', 'dashboard/core/risk-analysis.js', 'dashboard/core/risk-catalog.js', 'dashboard/core/risk-syntax.js', 'dashboard/editor/risk-highlights.js', 'shared/fonts/manrope-latin-wght-normal.woff2', 'shared/vendor/prettier/standalone.mjs', 'shared/vendor/terser/terser.mjs', 'sandbox/sandbox.js']) {
    assert.ok(observedAssets.has(required), `Packaged runtime asset was not exercised: ${required}`);
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({
    version, zipName, bytes: archive.length, checksum, fileCount: Object.keys(files).length,
    session: { browser: await dashboard.evaluate(() => navigator.userAgent), extensionRoot: unpacked, repositoryLoaded: false },
    checks: ['checksum and exact contents', 'isolated empty profile', 'worker messaging', 'visible extension versions', 'no redundant setup', 'dashboard light/dark accessibility and narrow layouts', 'dashboard editor and CodeMirror', 'Prettier and Terser', 'code review flags and source highlights', 'no accidental document scroll', 'bundled Manrope', 'dynamic API interception and activity', 'popup light/dark and activation', 'dashboard action', 'no runtime asset failures'],
    isolationEvidence, observedAssets: [...observedAssets].sort(), errors,
  }, null, 2));
  console.log(`Release smoke passed: ${zipName}, ${Object.keys(files).length} files, ${archive.length} bytes; extracted ZIP works without repository files.`);
} finally {
  await context.close();
}
