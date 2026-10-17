import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { format } from 'prettier';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { compactJavaScript } from '../dashboard/editor/compact.js';
import { rule } from '../tests/helpers/chrome.js';

const artifacts = resolve('.artifacts/compact');
mkdirSync(artifacts, { recursive: true });
function executable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  return readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .flatMap(name => ['chrome-win64', 'chrome-win'].map(folder => join(cache, name, folder, 'chrome.exe'))).find(existsSync);
}
const context = await chromium.launchPersistentContext(mkdtempSync(join(artifacts, 'profile-')), {
  headless: true, executablePath: executable(), viewport: { width: 1440, height: 1000 },
  args: ['--disable-extensions-except=' + resolve('.'), '--load-extension=' + resolve('.')],
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extension = 'chrome-extension://' + new URL(worker.url()).hostname;
const page = await context.newPage();
const checks = [], colors = [], errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));
const source = 'function modifyResponse(args) {\n  // Keep readable in the editor.\n  return args.responseJSON;\n}';
const legacy = rule({ id: 'legacy', name: 'Legacy response', response: { type: 'dynamic', body: source, customHeaders: '' } });
const feedUrl = 'https://fixtures.sfvi.test/private/collection?token=fixture&download=1';
const incoming = rule({ id: 'url-import', name: 'URL import', response: { type: 'dynamic', body: source, customHeaders: '' } });
const published = rule({ id: 'legacy', name: 'Published response', version: '2', response: { type: 'dynamic', body: source, customHeaders: '' } });
const value = id => page.locator('#' + id).inputValue();
const backing = id => page.evaluate(async id => (await import('./editor/editor.js')).getEditorValue(id), id);
const setBody = code => page.evaluate(async code => (await import('./editor/editor.js')).setEditorValue('f-body-dynamic', code), code);
const waitValue = (id, expected) => page.waitForFunction(({ id, expected }) => document.getElementById(id)?.value === expected, { id, expected });
const stored = () => worker.evaluate(() => chrome.storage.local.get(['sfvi_rules', 'sfvi_sources']));
const select = id => page.locator(`.nav-rule[data-id="${id}"] .nav-rule-open`).click();

try {
  await worker.evaluate(({ legacy, published, feedUrl }) => {
    globalThis.__feed = { document: [published], etag: 'W/"v2"', unchanged: false, requests: [] };
    const native = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
      if (String(input) !== feedUrl) return native(input, options);
      const feed = globalThis.__feed;
      feed.requests.push({ url: String(input), etag: options.headers['If-None-Match'] });
      return new Response(feed.unchanged ? null : JSON.stringify(feed.document, null, 2), {
        status: feed.unchanged ? 304 : 200, headers: { ETag: feed.etag, 'Content-Type': 'text/plain' },
      });
    };
    return chrome.storage.local.set({ sfvi_rules: [legacy], sfvi_sources: [] });
  }, { legacy, published, feedUrl });
  await page.goto(extension + '/dashboard/dashboard.html?edit=legacy');
  await waitValue('f-body-dynamic', await format(source, { parser: 'babel' }));
  assert.equal(await backing('f-body-dynamic'), source);
  assert.equal(await page.locator('#btn-save').isVisible(), false);
  assert.equal((await stored()).sfvi_rules[0].response.body, source);
  assert.equal(requests.some(url => url.includes('/vendor/terser/')), false);
  checks.push('Opening a legacy rule formats its view without changing backing/storage or loading the minifier');

  const edit = 'function modifyResponse(args){return {...args.responseJSON,changed:true};}';
  await setBody(edit);
  await page.locator('#fmt-dynamic').click();
  await waitValue('f-body-dynamic', await format(edit, { parser: 'babel' }));
  assert.equal(await backing('f-body-dynamic'), edit);
  assert.equal(await page.locator('#btn-save').isVisible(), true);
  await page.evaluate(() => window.CM6.EditorView.findFromDOM(document.querySelector('#dynamic-body-field .cm-editor')).focus());
  await page.keyboard.press('Control+z');
  await waitValue('f-body-dynamic', edit);
  assert.equal(await backing('f-body-dynamic'), edit);
  await page.keyboard.press('Control+z');
  await waitValue('f-body-dynamic', await format(source, { parser: 'babel' }));
  assert.equal(await backing('f-body-dynamic'), source);
  assert.equal(await page.locator('#btn-save').isVisible(), false);
  checks.push('Undo crosses manual presentation and actual edits, restoring the original clean backing');

  const pasted = await format(edit, { parser: 'babel' });
  await setBody(pasted);
  await page.locator('#btn-save').click();
  await page.waitForFunction(() => document.querySelector('#btn-save')?.style.display === 'none');
  assert.equal((await stored()).sfvi_rules[0].response.body, await compactJavaScript(pasted));
  await waitValue('f-body-dynamic', await format(await compactJavaScript(pasted), { parser: 'babel' }));
  const saved = structuredClone((await stored()).sfvi_rules);
  await setBody('function broken( {');
  await page.locator('#btn-save').click();
  await page.locator('#toast.error').waitFor();
  assert.equal(await value('f-body-dynamic'), 'function broken( {');
  assert.deepEqual((await stored()).sfvi_rules, saved);
  checks.push('Pasted pretty code saves compactly; invalid JavaScript preserves editor content and stored rules');

  const fileRule = { ...incoming, id: 'file-import', name: 'File import' };
  await page.locator('#import-file').setInputFiles({ name: 'pretty-rules.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([fileRule], null, 2)) });
  await page.locator('.nav-rule[data-id="file-import"]').waitFor();
  assert.equal((await stored()).sfvi_rules.find(rule => rule.id === 'file-import').response.body, await compactJavaScript(source));
  await context.route(feedUrl, route => route.fulfill({ body: JSON.stringify({ rules: [incoming] }), contentType: 'text/plain' }));
  await page.locator('#import-all').click();
  await page.locator('#import-url-input').fill(feedUrl);
  await page.locator('#import-from-url').click();
  await page.locator('#import-modal').waitFor({ state: 'hidden' });
  assert.equal((await stored()).sfvi_rules.find(rule => rule.id === 'url-import').response.body, await compactJavaScript(source));
  checks.push('Pretty file and suffix-free URL imports use the same compact local-copy path');

  await page.locator('#btn-sources').click();
  await page.locator('#btn-add-source').click();
  await page.locator('#source-name').fill('Shared collection');
  await page.locator('#source-url').fill(feedUrl);
  await page.locator('#source-interval').fill('5');
  await page.locator('#source-submit').click();
  await page.locator('#source-modal').waitFor({ state: 'hidden' });
  await page.locator('.source-item').waitFor();
  let state = await stored();
  const first = structuredClone(state.sfvi_sources[0]);
  assert.equal(first.etag, 'W/"v2"');
  assert.equal(first.rules[0].response.body, source);
  await worker.evaluate(() => { globalThis.__feed.unchanged = true; });
  await page.locator('[data-action="sync"]').click();
  await page.waitForFunction(() => document.querySelector('[data-action="sync"]')?.disabled === false);
  state = await stored();
  assert.equal(state.sfvi_sources[0].lastSyncedAt, first.lastSyncedAt);
  assert.deepEqual(state.sfvi_sources[0].rules, first.rules);
  const feedRequests = await worker.evaluate(() => globalThis.__feed.requests);
  assert.deepEqual(feedRequests, [{ url: feedUrl, etag: undefined }, { url: feedUrl, etag: 'W/"v2"' }]);
  const effective = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_RULES' }));
  const remote = effective.rules.find(rule => rule.readOnly);
  await select(remote.id);
  await waitValue('f-body-dynamic', await format(source, { parser: 'babel' }));
  assert.equal(await backing('f-body-dynamic'), source);
  assert.equal(await page.locator('#f-version').inputValue(), '2');
  assert.equal(await page.locator('#f-version').evaluate(input => input.readOnly), true);
  checks.push('Universal source GET -> ETag -> 304 preserves the read-only source snapshot and version');

  const popup = await context.newPage();
  popup.on('pageerror', error => errors.push(error.message));
  await popup.setViewportSize({ width: 360, height: 500 });
  await popup.goto(extension + '/popup/popup.html');
  await popup.locator('[data-tab="all"]').click();
  const popupToggle = popup.locator(`[data-toggle="${remote.id}"]`);
  await popupToggle.uncheck();
  await page.waitForFunction(id => [...document.querySelectorAll('[data-toggle]')].some(input => input.dataset.toggle === id && !input.checked), remote.id);
  await page.evaluate(id => chrome.runtime.sendMessage({ type: 'SYNC_SOURCE', id }), remote.sourceId);
  assert.equal((await stored()).sfvi_sources[0].enabledOverrides.legacy, false);
  assert.deepEqual((await stored()).sfvi_sources[0].rules, first.rules);
  await popup.reload();
  await popup.locator('[data-tab="all"]').click();
  assert.equal(await popupToggle.isChecked(), false);
  checks.push('Remote switches in both views persist across 304 sync and popup reopening without changing published content');

  await worker.evaluate(() => {
    const native = chrome.declarativeNetRequest.updateDynamicRules.bind(chrome.declarativeNetRequest);
    globalThis.__restoreDNR = () => { chrome.declarativeNetRequest.updateDynamicRules = native; };
    chrome.declarativeNetRequest.updateDynamicRules = async () => { throw new Error('Fixture DNR publication failure'); };
  });
  await popupToggle.check();
  await popup.locator('#popup-error').filter({ hasText: 'Fixture DNR publication failure' }).waitFor();
  assert.equal(await popupToggle.isChecked(), true, 'Refresh must show saved activation even when publication reports an error');
  await page.locator(`[data-toggle="${remote.id}"]`).uncheck();
  await page.locator('#toast.error').filter({ hasText: 'Fixture DNR publication failure' }).waitFor();
  assert.equal(await page.locator(`[data-toggle="${remote.id}"]`).isChecked(), false);
  assert.equal((await stored()).sfvi_sources[0].enabledOverrides.legacy, false);
  await worker.evaluate(() => globalThis.__restoreDNR());
  await popupToggle.check();
  await page.waitForFunction(id => [...document.querySelectorAll('[data-toggle]')].some(input => input.dataset.toggle === id && input.checked), remote.id);
  checks.push('Popup and dashboard reconcile authoritative activation after a post-storage publication failure');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('#sidebar-collapse-btn').click();
  const drawerToggle = page.locator(`#rules-drawer [data-toggle="${remote.id}"]`);
  await drawerToggle.uncheck();
  await page.waitForFunction(id => [...document.querySelectorAll('#rules-drawer [data-toggle]')].some(input => input.dataset.toggle === id && !input.checked), remote.id);
  await drawerToggle.check();
  await page.locator('#rules-drawer-close').click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => document.getElementById('apply-error').hidden);
  checks.push('Remote activation remains reachable inside the narrow rules drawer');

  const beforeExport = await stored();
  await page.locator('#btn-select-rules').click();
  await page.locator('.nav-checkbox[data-id="legacy"]').check();
  await page.locator(`.nav-checkbox[data-id="${remote.id}"]`).check();
  const selectedDownload = page.waitForEvent('download');
  await page.locator('#export-selected').click();
  await (await selectedDownload).saveAs(join(artifacts, 'selected.json'));
  const selectedJSON = readFileSync(join(artifacts, 'selected.json'), 'utf8');
  assert.equal(selectedJSON.includes('\n'), false);
  assert.equal(JSON.parse(selectedJSON).length, 2);
  assert.ok(JSON.parse(selectedJSON).every(rule => !rule.response.body.includes('\n') && !rule.readOnly));
  const allDownload = page.waitForEvent('download');
  await page.goto(extension + '/dashboard/dashboard.html?action=export');
  await (await allDownload).saveAs(join(artifacts, 'all.json'));
  const allJSON = readFileSync(join(artifacts, 'all.json'), 'utf8');
  assert.equal(allJSON.includes('\n'), false);
  assert.equal(JSON.parse(allJSON).length, 4);
  assert.ok(JSON.parse(allJSON).every(rule => !rule.response.body.includes('\n') && !rule.readOnly));
  assert.deepEqual(await stored(), beforeExport);
  checks.push('Actual selected and full downloads are one-line JSON with compact dynamic bodies; storage remains unchanged');

  await page.locator('#btn-new').click();
  await page.locator('.type-btn[data-type="html"]').click();
  for (const theme of ['default', 'light']) {
    await page.locator('#btn-theme').click();
    await page.locator(`.theme-swatch[data-theme="${theme}"]`).click();
    await page.locator('#theme-panel-close').click();
    for (const subtype of ['html', 'css', 'js']) {
      await page.locator(`.subtype-btn[data-sub="${subtype}"]`).click();
      await page.waitForTimeout(180); // Wait for the 140 ms color transition.
      const color = await page.locator(`.subtype-btn[data-sub="${subtype}"]`).evaluate((button, subtype) => {
        const style = getComputedStyle(button), probe = document.createElement('span');
        probe.style.color = `var(--t-${subtype}-c)`; document.body.appendChild(probe);
        const expected = getComputedStyle(probe).color; probe.remove();
        const rgb = color => color.match(/[\d.]+/g).map(Number);
        const fg = rgb(style.color), tint = rgb(style.backgroundColor), base = rgb(getComputedStyle(document.querySelector('#main')).backgroundColor);
        const alpha = tint[3] ?? 1;
        const bg = tint.slice(0, 3).map((value, index) => value * alpha + base[index] * (1 - alpha));
        const luminance = rgb => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
          .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        const a = luminance(fg), b = luminance(bg);
        return { color: style.color, expected, background: style.backgroundColor, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), pressed: button.getAttribute('aria-pressed') };
      }, subtype);
      assert.equal(color.color, color.expected); assert.equal(color.pressed, 'true'); assert.ok(color.contrast >= 4.5);
      colors.push({ theme, subtype, ...color });
      await page.locator('#subtype-selector').screenshot({ path: join(artifacts, `${theme}-${subtype}.png`) });
    }
    const scan = await new AxeBuilder({ page }).analyze();
    assert.equal(scan.violations.length, 0, JSON.stringify(scan.violations));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: join(artifacts, `${theme}-narrow.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const narrowScan = await new AxeBuilder({ page }).analyze();
    assert.equal(narrowScan.violations.length, 0, JSON.stringify(narrowScan.violations));
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  checks.push('HTML/CSS/JS selectors follow both themes with >=4.5:1 text contrast, pressed semantics, no axe violations or narrow overflow');
  assert.deepEqual(errors, []);
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ checks, colors, errors }, null, 2));
  console.log('Compact/universal feed browser checks passed:', checks.length, 'scenarios;', colors.length, 'type/theme contrast checks.');
} catch (error) {
  await page.screenshot({ path: join(artifacts, 'failure.png') });
  writeFileSync(join(artifacts, 'failure.json'), JSON.stringify({ checks, colors, errors, error: error.stack }, null, 2));
  throw error;
} finally { await context.close(); }
