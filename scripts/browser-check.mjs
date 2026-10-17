import { chromium } from 'playwright';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';

const artifacts = resolve('.artifacts');
mkdirSync(artifacts, { recursive: true });
const accessibilityViolations = [];
const accessibilityReports = [];
const measurements = [];
async function audit(page, label) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  writeFileSync(join(artifacts, `accessibility-${label}.json`), JSON.stringify(result, null, 2));
  accessibilityReports.push({ label, timestamp: result.timestamp, violations: result.violations.length, incomplete: result.incomplete.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })) });
  if (result.violations.length) {
    const beforePath = join(artifacts, `accessibility-${label}-before.json`);
    if (!existsSync(beforePath)) writeFileSync(beforePath, JSON.stringify(result, null, 2));
    const findings = result.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
    accessibilityViolations.push({ label, findings });
    console.error('Accessibility findings:', label, JSON.stringify(findings));
  } else console.log('Accessibility passed:', label);
}

async function checkOpaqueTextContrast(page, label, selector, backgroundSelector) {
  const result = await page.evaluate(({ selector, backgroundSelector }) => {
    const foreground = getComputedStyle(document.querySelector(selector)).color;
    const background = getComputedStyle(document.querySelector(backgroundSelector)).backgroundColor;
    const rgb = color => color.match(/[\d.]+/g).map(Number);
    const luminance = values => {
      const [r, g, b] = values.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return r * .2126 + g * .7152 + b * .0722;
    };
    const fg = rgb(foreground), bg = rgb(background);
    if ((fg[3] ?? 1) !== 1 || (bg[3] ?? 1) !== 1) throw new Error('This contrast probe requires opaque colors');
    const a = luminance(fg), b = luminance(bg);
    return { foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  }, { selector, backgroundSelector });
  measurements.push({ probe: 'opaque-text-contrast', label, ...result });
  assert.ok(result.ratio >= 4.5, `${label}: ${result.ratio}:1`);
}

async function checkTouchTargets(page, label) {
  const result = await page.evaluate(() => [...document.querySelectorAll('#main button:not(:disabled), #main input:not([hidden]), #main select:not(:disabled), .sidebar-header button, #sidebar-collapse-btn')]
    .filter(element => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
    .map(element => {
      const box = element.getBoundingClientRect();
      return { id: element.id || element.className, width: box.width, height: box.height, visible: box.top >= 0 && box.bottom <= innerHeight };
    }).filter(element => element.visible));
  measurements.push({ probe: 'target-size', label, viewport: page.viewportSize(), results: result });
  const tooSmall = result.filter(element => element.width < 43.9 || element.height < 43.9);
  assert.deepEqual(tooSmall, [], JSON.stringify(tooSmall));
}
function executablePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  const cache = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(cache)) return bundled;
  const versions = readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  const candidates = versions.flatMap(version => ['chrome-win64', 'chrome-win'].map(folder => join(cache, version, folder, 'chrome.exe')));
  return candidates.find(existsSync) ?? bundled;
}

const context = await chromium.launchPersistentContext(mkdtempSync(join(artifacts, 'browser-profile-')), {
  headless: true,
  executablePath: executablePath(),
  args: [`--disable-extensions-except=${resolve('.')}`, `--load-extension=${resolve('.')}`],
  viewport: { width: 1440, height: 1000 },
});

try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => {
    if (request.url().startsWith('chrome-extension://')) errors.push(request.url() + ': ' + request.failure()?.errorText);
  });
  await page.goto(`chrome-extension://${extensionId}/dashboard/dashboard.html`);
  await page.locator('#btn-new').waitFor();
  await page.waitForTimeout(500);
  if (process.argv.includes('--baseline')) {
    await page.screenshot({ path: join(artifacts, 'dashboard-before.png') });
    await page.locator('#btn-new').click();
    await page.screenshot({ path: join(artifacts, 'editor-before.png') });
    console.log('Baseline screenshots saved.', errors);
  } else {
    assert.equal(await page.locator('html').getAttribute('data-theme'),'default');
    await audit(page, 'original-empty');
    await page.locator('#btn-theme').click();
    await page.locator('[data-theme="light"]').click();
    await page.locator('#theme-panel-close').click();
    await page.screenshot({ path: join(artifacts, 'dashboard-empty.png') });
    await audit(page, 'empty');
    assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Manrope' && font.status === 'loaded')), true);
    await page.locator('#btn-new').click();
    await page.locator('#f-name').fill('Account overview');
    await page.locator('#f-version').fill('1.2.0');
    await page.locator('.pair-url').fill('/api/account');
    await page.locator('#tpl-static').click();
    await page.locator('#btn-save').click();
    await page.waitForFunction(() => document.querySelector('#btn-delete') && document.querySelector('#btn-save').style.display === 'none');
    const local = (await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_RULES' }))).rules[0];
    assert.equal(local.version, '1.2.0');
    assert.equal(local.readOnly, undefined);
    await page.locator('#f-version').fill('1.2.1');
    await page.locator('#btn-save').waitFor({ state: 'visible' });
    await page.locator('#btn-save').click();
    await page.waitForFunction(() => document.querySelector('#btn-save').style.display === 'none');
    await page.screenshot({ path: join(artifacts, 'editor-local.png') });
    await audit(page, 'local-editor');
    await checkOpaqueTextContrast(page, 'light-line-numbers', '#static-body-field .cm-lineNumbers .cm-gutterElement:nth-child(3)', '#static-body-field .cm-gutters');
    await page.locator('.advanced-request summary').click();
    await audit(page, 'request-expanded');
    await page.locator('.advanced-request summary').click();
    const codeTop = await page.locator('#static-body-field').evaluate(element => element.getBoundingClientRect().top);
    measurements.push({ probe: 'editor-visibility', viewport: page.viewportSize(), codeTop });
    assert.ok(codeTop < 850, `Response editor starts too low: ${codeTop}px`);
    const token = await page.locator('#static-body-field .cm-line span').filter({ hasText: /^"success"$/ }).elementHandle();
    const lightToken = await token.evaluate(element => getComputedStyle(element).color);
    assert.notEqual(lightToken, await token.evaluate(element => getComputedStyle(element.closest('.cm-editor')).color));
    await page.locator('#btn-theme').click();
    await page.locator('[data-theme="default"]').click();
    await page.locator('#theme-panel-close').click();
    const darkToken = await token.evaluate(element => getComputedStyle(element).color);
    assert.notEqual(darkToken, lightToken);
    assert.equal(await token.evaluate(element => element.isConnected), true);
    await page.locator('#btn-theme').click();
    await page.locator('[data-theme="light"]').click();
    await page.locator('#theme-panel-close').click();
    assert.equal(await token.evaluate(element => getComputedStyle(element).color), lightToken);
    measurements.push({ probe: 'syntax-theme-switch', lightToken, darkToken, editorRecreated: false });

    const fixture = { ...local, name: 'Shared account response', version: '2.0.0' };
    await worker.evaluate(rule => {
      globalThis.__sfviFixture = { document: [rule], status: 200 };
      const nativeFetch = globalThis.fetch;
      globalThis.fetch = async (input, options) => {
        if (String(input) === 'https://fixtures.sfvi.test/rules.json') {
          return new Response(JSON.stringify(globalThis.__sfviFixture.document), { status: globalThis.__sfviFixture.status, headers: { 'Content-Type': 'application/json' } });
        }
        return nativeFetch(input, options);
      };
    }, fixture);
    await page.locator('#btn-sources').click();
    await page.locator('#btn-add-source').click();
    await page.locator('#source-name').fill('Team shared rules');
    await page.locator('#source-url').fill('https://fixtures.sfvi.test/rules.json');
    await page.locator('#source-interval').fill('15');
    await page.screenshot({ path: join(artifacts, 'subscription-dialog.png') });
    await audit(page, 'subscribe-dialog');
    await checkOpaqueTextContrast(page, 'subscription-description', '#source-modal-description', '#source-modal');
    await page.locator('#source-submit').click();
    await page.locator('#source-modal').waitFor({ state: 'hidden' });
    await page.locator('.source-item').waitFor();
    await page.screenshot({ path: join(artifacts, 'sources.png') });
    await audit(page, 'sources');
    let data = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_RULES' }));
    assert.equal(data.rules.length, 2);
    assert.equal(data.rules.find(rule => rule.id === local.id).version, '1.2.1');
    const remote = data.rules.find(rule => rule.readOnly);
    assert.equal(remote.version, '2.0.0');
    assert.notEqual(remote.id, local.id);
    const alarm = await worker.evaluate(async id => chrome.alarms.get('sfvi_source:' + id), remote.sourceId);
    assert.equal(alarm.periodInMinutes, 15);

    await page.locator('[data-origin="all"]').click();
    await page.locator('.nav-rule', { hasText: fixture.name }).locator('.nav-rule-open').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#f-name').getAttribute('readonly'), '');
    assert.equal(await page.locator('#f-version').inputValue(), '2.0.0');
    assert.equal(await page.locator('#f-version').evaluate(input => input.readOnly), true);
    assert.equal(await page.locator('#static-body-field .cm-content').getAttribute('contenteditable'), 'false');
    assert.equal(await page.locator('#btn-source-details').isEnabled(), true);
    for (const type of ['SAVE_RULE', 'DELETE_RULE']) {
      const result = await page.evaluate(({ type, rule }) => chrome.runtime.sendMessage({ type, id: rule.id, rule }), { type, rule: remote });
      assert.match(result.error, /read-only/);
    }
    const remoteToggle = page.locator(`.nav-rule[data-id="${remote.id}"] [data-toggle]`);
    await remoteToggle.focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(id => [...document.querySelectorAll('[data-toggle]')].some(input => input.dataset.toggle === id && !input.checked), remote.id);
    await page.waitForFunction(id => document.activeElement?.dataset.toggle === id, remote.id);
    assert.equal((await worker.evaluate(() => chrome.storage.local.get('sfvi_sources'))).sfvi_sources[0].rules[0].enabled, true);
    await page.screenshot({ path: join(artifacts, 'editor-remote.png') });
    await audit(page, 'remote-editor');
    await worker.evaluate(() => { globalThis.__sfviFixture.document[0].version = '2.0.1'; });
    await page.evaluate(id => chrome.runtime.sendMessage({ type: 'SYNC_SOURCE', id }), remote.sourceId);
    await page.waitForFunction(() => document.querySelector('#f-version')?.value === '2.0.1');
    assert.equal(await remoteToggle.isChecked(), false, 'Source update must preserve local off state');

    const popup = await context.newPage();
    popup.on('pageerror', error => errors.push(error.message));
    await popup.setViewportSize({ width: 360, height: 500 });
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.locator('.rule-item').first().waitFor();
    await popup.locator('[data-tab="all"]').click();
    const remotePopup = popup.locator('.rule-item').filter({ hasText: fixture.name });
    assert.equal(await remotePopup.locator('[data-toggle]').count(), 1);
    assert.equal(await remotePopup.locator('[data-del]').count(), 0);
    assert.equal(await popup.locator('[data-edit], [data-del]').count(), 0);
    assert.equal(await popup.locator('#new-rule').isVisible(), true);
    assert.equal(await remotePopup.locator('[data-toggle]').isChecked(), false);
    await remotePopup.locator('[data-toggle]').focus();
    await popup.keyboard.press('Space');
    await popup.waitForFunction(id => [...document.querySelectorAll('[data-toggle]')].some(input => input.dataset.toggle === id && input.checked), remote.id);
    await page.waitForFunction(id => [...document.querySelectorAll('[data-toggle]')].some(input => input.dataset.toggle === id && input.checked), remote.id);
    await popup.waitForFunction(id => document.activeElement?.dataset.toggle === id, remote.id);
    await popup.screenshot({ path: join(artifacts, 'popup.png') });
    await audit(popup, 'popup');

    await page.locator('#btn-source-details').click();
    await page.locator('[data-edit-source] input[name="intervalMinutes"]').fill('5');
    await page.locator('[data-action="save"]').click();
    await page.waitForFunction(() => document.querySelector('.source-meta').textContent.includes('Every 5 min'));
    assert.equal((await worker.evaluate(async id => chrome.alarms.get('sfvi_source:' + id), remote.sourceId)).periodInMinutes, 5);
    await worker.evaluate(() => { globalThis.__sfviFixture.document[0].version = '2.1.0'; globalThis.__sfviFixture.document[0].enabled = false; });
    await page.locator('[data-action="sync"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.nav-rule-version')].some(element => element.textContent.includes('2.1.0')));
    await worker.evaluate(() => { globalThis.__sfviFixture.status = 503; });
    await page.locator('[data-action="sync"]').click();
    await page.locator('.source-sync-error').waitFor();
    assert.match(await page.locator('.source-sync-error').textContent(), /HTTP 503.*last valid snapshot/);
    data = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_RULES' }));
    assert.equal(data.rules.find(rule => rule.readOnly).version, '2.1.0');
    assert.equal(data.rules.find(rule => rule.readOnly).enabled, true, 'Explicit local activation wins over changed publisher default');
    assert.equal(data.rules.find(rule => rule.id === local.id).version, '1.2.1');
    await page.screenshot({ path: join(artifacts, 'sources-error.png') });
    await audit(page, 'source-error');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'sync');

    const previewRules = [
      { ...local, id: 'preview-gql', name: 'Product query', resourceType: 'graphql' },
      { ...local, id: 'preview-js', name: 'Analytics script', resourceType: 'html', resourceSubtype: 'js', response: {
        ...local.response, type: 'dynamic', body: 'function modifyResponse(args) {\n  // Preserve the original source.\n  const count = 42;\n  const label = "preview";\n  const enabled = true;\n  return args.response + "\\n// " + label + count + enabled;\n}',
      } },
      { ...local, id: 'preview-css', name: 'Theme stylesheet', resourceType: 'html', resourceSubtype: 'css', enabled: false },
      { ...local, id: 'preview-html', name: 'Page customization', resourceType: 'html', resourceSubtype: 'html' },
    ];
    await page.evaluate(rules => chrome.runtime.sendMessage({ type: 'MERGE_RULES', rules }), previewRules);
    for (const rule of previewRules) {
      await page.locator(`.nav-rule[data-id="${rule.id}"] .nav-rule-open`).click();
      if (rule.id === 'preview-js') await page.locator('#dynamic-body-field .cm-content').scrollIntoViewIfNeeded();
      await audit(page, rule.id);
    }
    await popup.locator('[data-tab="all"]').click();
    await popup.locator('.rule-item[data-rule-id="preview-css"]').waitFor();
    assert.equal(await popup.locator('.rule-item[data-rule-id="preview-css"] input[type="checkbox"]').isChecked(), false);
    await audit(popup, 'inactive-popup');
    await page.locator('.nav-rule', { hasText: 'Account overview' }).locator('.nav-rule-open').click();
    await page.screenshot({ path: join(artifacts, 'workspace-light.png') });

    await page.locator('#import-all').focus();
    await page.keyboard.press('Enter');
    await page.screenshot({ path: join(artifacts, 'import.png') });
    assert.match(await page.locator('#import-description').textContent(), /one-time import/);
    await audit(page, 'import-dialog');
    await page.locator('#import-modal-close').focus();
    for (let index = 0; index < 7; index++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.getElementById('import-modal').contains(document.activeElement)), true);
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'import-all');

    const importedCopy = { ...local, id: 'imported-once', name: 'Imported local copy', version: '4.0.0' };
    await context.route('https://fixtures.sfvi.test/import.json', route => route.fulfill({ json: [importedCopy] }));
    await page.locator('#import-all').click();
    await page.locator('#import-url-input').fill('https://fixtures.sfvi.test/import.json');
    await page.locator('#import-from-url').click();
    await page.locator('#import-modal').waitFor({ state: 'hidden' });
    data = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_RULES' }));
    assert.equal(data.rules.find(rule => rule.id === importedCopy.id).readOnly, undefined);
    assert.equal(data.rules.find(rule => rule.id === importedCopy.id).version, '4.0.0');
    assert.equal(data.sources.length, 1);
    await page.locator('#import-file').setInputFiles({ name: 'rules.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([{ ...importedCopy, id: 'imported-file', name: 'File import', version: 6 }])) });
    for (let attempt = 0; attempt < 100; attempt++) {
      const imported = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_RULES' }));
      if (imported.rules.some(rule => rule.id === 'imported-file')) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    data = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_RULES' }));
    assert.equal(data.rules.find(rule => rule.id === 'imported-file').version, '6');
    await page.locator('#btn-sources').click();

    await page.locator('#btn-theme').click();
    await page.locator('[data-theme="default"]').click();
    await page.locator('#theme-panel-close').click();
    await page.screenshot({ path: join(artifacts, 'sources-dark.png') });
    await audit(page, 'dark-sources');
    await page.locator('.nav-rule', { hasText: 'Account overview' }).locator('.nav-rule-open').click();
    await audit(page, 'dark-editor');
    await page.screenshot({ path: join(artifacts, 'workspace-dark.png') });
    await page.locator('.nav-rule[data-id="preview-js"] .nav-rule-open').click();
    await page.locator('#dynamic-body-field .cm-content').scrollIntoViewIfNeeded();
    await audit(page, 'dark-javascript');
    await page.screenshot({ path: join(artifacts, 'editor-javascript-dark.png') });
    await page.locator('#dynamic-body-field .cm-content').focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.cm-editor'))), false);
    await audit(popup, 'dark-popup');
    await popup.locator('.rules-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await popup.screenshot({ path: join(artifacts, 'popup-dark-scrolled.png') });
    await checkOpaqueTextContrast(popup, 'dark-popup-metadata', '.rule-item:last-child .rule-meta', 'body');
    await checkOpaqueTextContrast(page, 'dark-line-numbers', '#dynamic-body-field .cm-lineNumbers .cm-gutterElement:nth-child(3)', '#dynamic-body-field .cm-gutters');
    await page.locator('#btn-sources').click();
    await page.locator('#btn-theme').click();
    await page.locator('[data-theme="light"]').click();
    await page.locator('#theme-panel-close').click();
    await page.setViewportSize({ width: 390, height: 844 });
    const touchSession = await context.newCDPSession(page);
    await touchSession.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    assert.equal(await page.locator('#rules-drawer').evaluate(element => element.open), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(artifacts, 'sources-mobile.png') });
    await audit(page, 'mobile-sources');
    await checkTouchTargets(page, 'mobile-sources');
    await page.locator('.sources-body').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await checkTouchTargets(page, 'mobile-source-actions');
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#sidebar-collapse-btn').click();
    await page.locator('.nav-rule', { hasText: 'Account overview' }).locator('.nav-rule-open').click();
    await audit(page, 'mobile-editor');
    await checkTouchTargets(page, 'mobile-editor');
    await page.screenshot({ path: join(artifacts, 'editor-mobile.png') });
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.editor-body').evaluate(element => element.scrollWidth <= element.clientWidth), true);
    await page.setViewportSize({ width: 720, height: 500 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok(await page.locator('#btn-close').evaluate(element => parseFloat(getComputedStyle(element).transitionDuration) < .001));
    await page.locator('#btn-close').click();
    await page.locator('#sidebar-collapse-btn').click();
    await page.locator('#btn-sources').click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await touchSession.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    for (const id of [...previewRules.map(rule => rule.id), 'imported-once', 'imported-file']) {
      await page.evaluate(id => chrome.runtime.sendMessage({ type: 'DELETE_RULE', id }), id);
    }

    await worker.evaluate(() => { globalThis.__sfviFixture = { document: [], status: 200 }; });
    await page.locator('[data-action="sync"]').click();
    await page.waitForFunction(() => document.querySelector('.source-meta').textContent.includes('0 rules'));
    data = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_RULES' }));
    assert.equal(data.rules.length, 1);
    assert.equal(data.rules[0].id, local.id);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-action="remove"]').click();
    await page.locator('.source-empty').waitFor();
    assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).filter(item => item.name.startsWith('sfvi_source:')).length, 0);

    if (errors.length) throw new Error(errors.join('\n'));
    assert.equal(accessibilityViolations.length, 0, JSON.stringify(accessibilityViolations, null, 2));
    writeFileSync(join(artifacts, 'ui-measurements.json'), JSON.stringify(measurements, null, 2));
    writeFileSync(join(artifacts, 'browser-session.json'), JSON.stringify({
      session: {
        driver: 'Playwright', browser: await page.evaluate(() => navigator.userAgent), buildMode: 'unpacked extension; no build step',
        baseUrl: `chrome-extension://${extensionId}`, routes: ['/dashboard/dashboard.html', '/popup/popup.html'],
        viewports: [{ width: 1440, height: 1000 }, { width: 360, height: 500 }, { width: 390, height: 844, touch: true }, { width: 320, height: 740, touch: true }, { width: 720, height: 500 }],
        themes: ['default (original dark)', 'light'], auth: 'none; isolated browser profile', dataFixture: 'local rules plus deterministic HTTPS feed and import fixtures',
        probesRun: ['axe-scan', 'scoped-target-size', 'dialog-and-editor-focus', 'viewport-overflow', 'failure-injection', 'light-dark-captures', 'page-errors-and-extension-request-failures', 'font-loading', 'syntax-theme-switch', 'opaque-text-contrast'],
        probesSkipped: [
          { probe: 'web-vitals-and-layout-shift', reason: 'No performance claim; scoped functional, visual and accessibility verification' },
          { probe: 'full-focus-ring-pixel-diff', reason: 'Keyboard paths and focus restoration checked; no automated pixel-diff walk of every control' },
          { probe: 'pseudo-locale-and-RTL', reason: 'English-only interface; not included in this change' },
          { probe: 'legacy-and-custom-theme-matrix', reason: 'This run covers the default light and dark presets' },
          { probe: 'physical-device-and-screen-reader', reason: 'Chromium automation only; no macOS/iOS hardware or assistive-technology session available' },
        ], artifactDir: '.artifacts',
      }, accessibilityReports, pageErrorsAndFailedExtensionRequests: errors,
    }, null, 2));
    console.log('Browser checks passed: local version editing, subscriptions, read-only enforcement, background alarms, interval settings, refresh, error recovery, empty snapshots, unsubscribe, popup, light/dark themes, and mobile overflow.');
  }
} catch (error) {
  for (const page of context.pages()) {
    if (!page.url().includes('/dashboard/dashboard.html')) continue;
    console.error('Dashboard state:', await page.locator('#toast').textContent());
    await page.screenshot({ path: join(artifacts, 'browser-failure.png') });
  }
  throw error;
} finally {
  await context.close();
}
