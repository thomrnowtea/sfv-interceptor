import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { format } from 'prettier';
import { RISK_FLAGS } from '../dashboard/core/risk-catalog.js';

const artifacts = resolve('.artifacts/security');
mkdirSync(artifacts, { recursive: true });
function executable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  return readdirSync(cache).filter(name => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .flatMap(name => ['chrome-win64', 'chrome-win'].map(folder => join(cache, name, folder, 'chrome.exe'))).find(existsSync);
}
const context = await chromium.launchPersistentContext(mkdtempSync(join(artifacts, 'profile-')), {
  headless: true, executablePath: executable(), viewport: { width: 1440, height: 1000 },
  args: ['--disable-extensions-except=' + resolve('.'), '--load-extension=' + resolve('.')],
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extension = 'chrome-extension://' + new URL(worker.url()).hostname;
const page = await context.newPage();
const errors = [], observations = [], checks = [], flagMatrix = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => errors.push(request.url() + ': ' + request.failure()?.errorText));

const response = 'function modifyResponse(args){const label="😀";const cookie=document.cookie;fetch("/api/preview");fetch("/api/refresh");setTimeout("window.preview=true",25);return args.responseJSON;}';
const request = 'function modifyRequest(args){navigator.clipboard.readText();return args.requestJSON;}';
const makeRule = (id, body, type = 'dynamic', resourceType = 'rest', subtype) => ({
  id, name: 'Security example ' + id, enabled: true, version: '1.0.0', resourceType, resourceSubtype: subtype,
  pairs: [{ id: 'p-' + id, urlPattern: 'https://example.test/' + id, urlOperator: 'Contains' }],
  request: { type: 'static', body: '' }, response: { type, body },
});
const rules = [
  { ...makeRule('review', response), request: { type: 'dynamic', body: request } },
  makeRule('static-js', 'const cookie = document.cookie;', 'static', 'html', 'js'),
  makeRule('network-only', 'function modifyResponse(args){fetch("/api/preview");return args.responseJSON;}'),
];

// Expected source spans and benign neighbours are independent of the detector.
const flagCases = {
  dynamic_eval: { spans: ['eval', 'setTimeout'], negative: 'setTimeout(runTask, 100);' },
  external_code: { spans: ['import(moduleUrl)', 'document.createElement("script")'], negative: 'document.createElement("div");' },
  cookie_read: { spans: ['document.cookie'], negative: 'document.cookie = "preview=1";', negativeFlags: ['cookie_write'] },
  storage: { spans: ['localStorage.getItem', 'indexedDB.open'], negative: 'typeof localStorage; localStorage.length;' },
  navigator_sensors: { spans: ['navigator.clipboard.readText'], negative: 'navigator.clipboard.writeText("copied");' },
  input_capture: { spans: ['document.addEventListener'], negative: 'button.addEventListener("keydown", handleKey);' },
  dom_write: { spans: ['panel.innerHTML'], negative: 'panel.innerHTML = "<strong>Preview</strong>";' },
  worker: { spans: ['Worker'], negative: 'class Worker {} new Worker();' },
  extension_api: { spans: ['chrome.runtime.sendMessage'], negative: 'typeof chrome.runtime; const app = chrome.app;' },
  prototype_hook: { spans: ['Object.defineProperty'], negative: 'Object.defineProperty(settings, "visible", { value: true });' },
  network_fetch: { spans: ['fetch'], negative: 'function fetch() {} fetch("/preview");' },
  websocket: { spans: ['WebSocket'], negative: 'class WebSocket {} new WebSocket("local");' },
  cookie_write: { spans: ['document.cookie'], negative: 'const cookies = document.cookie;', negativeFlags: ['cookie_read'] },
  postmessage: { spans: ['window.parent.postMessage'], negative: 'window.parent.postMessage(message, "https://example.test");' },
  location_redirect: { spans: ['location.assign'], negative: 'location.reload(); history.replaceState({}, "", "/preview");' },
  canvas_read: { spans: ['canvas.toDataURL'], negative: 'const canvas = document.createElement("canvas"); canvas.getContext("2d");' },
};

async function waitFlags(barId, expected) {
  await page.waitForFunction(({ barId, expected }) => {
    const bar = document.getElementById(barId);
    if (!bar || bar.hidden || bar.textContent.includes('Analysis unavailable')) return false;
    const found = [...bar.querySelectorAll('[data-risk-id]')].map(button => button.dataset.riskId).sort();
    return JSON.stringify(found) === JSON.stringify(expected.slice().sort());
  }, { barId, expected });
}

async function openRule(id) {
  await page.goto(extension + '/dashboard/dashboard.html?edit=' + encodeURIComponent(id));
  await page.locator('#f-name').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

async function setCode(id, code) {
  await page.evaluate(async ({ id, code }) => (await import('./editor/editor.js')).setEditorValue(id, code), { id, code });
}

async function highlightTexts() {
  return page.evaluate(() => Object.fromEntries([...CSS.highlights].map(([name, highlight]) => [name, [...highlight].map(range => range.toString())])));
}

async function waitHighlights(name, text) {
  await page.waitForFunction(({ name, text }) => [...(CSS.highlights.get(name) || [])].some(range => range.toString() === text), { name, text });
}

async function selectedCode(id) {
  return page.evaluate(id => {
    const view = CM6.EditorView.findFromDOM(document.getElementById(id).previousElementSibling.querySelector('.cm-editor'));
    const selection = view.state.selection.main;
    return { text: view.state.doc.sliceString(selection.from, selection.to), from: selection.from };
  }, id);
}

async function audit(label) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  writeFileSync(join(artifacts, 'axe-' + label + '.json'), JSON.stringify(result, null, 2));
  const nodes = result.violations.flatMap(violation => violation.nodes.map(node => ({ id: violation.id, ...node })));
  const relevant = await page.evaluate(targets => targets.map(target => target.some(selector => document.querySelector(selector)?.closest('.risk-bar, #sfvi-allrisks-popup, #sfvi-sec-modal, .cm-editor'))), nodes.map(node => node.target));
  const scoped = nodes.filter((node, index) => relevant[index]);
  const outsideScope = nodes.filter((node, index) => !relevant[index]).map(node => ({ id: node.id, target: node.target }));
  observations.push({ probe: 'axe', label, scope: 'risk panels, reference/save dialogs and code editors', violations: scoped.length, outsideScope, incomplete: result.incomplete.map(item => item.id) });
  if (nodes.length) await page.screenshot({ path: join(artifacts, 'failure-' + label + '.png') });
  assert.equal(scoped.length, 0, JSON.stringify(scoped.map(node => ({ id: node.id, target: node.target, summary: node.failureSummary }))));
}

async function contrastProbe(label) {
  const result = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    function pixel(color) {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    }
    function background(element, overlay) {
      const ancestors = []; for (; element; element = element.parentElement) ancestors.unshift(element);
      context.clearRect(0, 0, 1, 1); context.fillStyle = 'white'; context.fillRect(0, 0, 1, 1);
      for (const ancestor of ancestors) { context.fillStyle = getComputedStyle(ancestor).backgroundColor; context.fillRect(0, 0, 1, 1); }
      if (overlay) { context.fillStyle = overlay; context.fillRect(0, 0, 1, 1); }
      return [...context.getImageData(0, 0, 1, 1).data];
    }
    function luminance(rgb) {
      const linear = rgb.slice(0, 3).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
      return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
    }
    function ratio(foreground, backdrop) {
      const a = luminance(foreground), b = luminance(backdrop);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    }
    const badges = [...document.querySelectorAll('.risk-bar:not([hidden]) .risk-flag, .risk-bar:not([hidden]) .risk-summary strong')]
      .map(element => ({ text: element.textContent.trim(), ratio: ratio(pixel(getComputedStyle(element).color), background(element)) }));
    const highlights = [];
    for (const [name, highlight] of CSS.highlights) {
      for (const range of highlight) {
        const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent.trim() || !range.intersectsNode(node)) continue;
          const element = node.parentElement, tint = getComputedStyle(element, '::highlight(' + name + ')').backgroundColor;
          highlights.push({ name, source: node.textContent, tint, ratio: ratio(pixel(getComputedStyle(element).color), background(element, tint)) });
        }
      }
    }
    return { badges, highlights };
  });
  observations.push({ probe: 'contrast', label, ...result });
  assert.ok(result.badges.every(item => item.ratio >= 4.5), JSON.stringify(result.badges));
  assert.ok(result.highlights.every(item => item.ratio >= 4.5), JSON.stringify(result.highlights));
}

async function geometry(label) {
  await page.evaluate(() => window.scrollTo(0, 1e7));
  const measured = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('.risk-bar:not([hidden])')];
    const root = document.scrollingElement;
    const app = document.querySelector('.app').getBoundingClientRect();
    const footer = document.querySelector('.statusbar').getBoundingClientRect();
    return {
      viewport: innerWidth, rootWidth: document.documentElement.scrollWidth,
      viewportHeight: innerHeight, rootHeight: root.scrollHeight, rootScrollTop: root.scrollTop,
      app: { top: app.top, bottom: app.bottom }, footer: { top: footer.top, bottom: footer.bottom },
      panels: panels.map(panel => ({ width: panel.clientWidth, scrollWidth: panel.scrollWidth })),
      targets: panels.flatMap(panel => [...panel.querySelectorAll('button')].map(button => ({ label: button.textContent, height: button.getBoundingClientRect().height }))),
    };
  });
  observations.push({ probe: 'geometry', label, ...measured });
  assert.ok(measured.rootWidth <= measured.viewport + 1, JSON.stringify(measured));
  assert.ok(measured.rootHeight <= measured.viewportHeight + 1 && measured.rootScrollTop === 0, JSON.stringify(measured));
  assert.ok(measured.app.top >= 0 && measured.app.bottom <= measured.viewportHeight + 1, JSON.stringify(measured));
  assert.ok(measured.footer.top >= 0 && Math.abs(measured.footer.bottom - measured.viewportHeight) <= 1, JSON.stringify(measured));
  assert.ok(measured.panels.every(panel => panel.scrollWidth <= panel.width + 1), JSON.stringify(measured));
  if (measured.viewport <= 760) assert.ok(measured.targets.every(target => target.height >= 44), JSON.stringify(measured));
}

async function verifyPaint() {
  const field = page.locator('#dynamic-body-field');
  await field.scrollIntoViewIfNeeded();
  await page.addStyleTag({ content: '.cm-cursor { visibility: hidden !important; }' });
  const highlighted = await field.screenshot({ path: join(artifacts, 'paint-with-highlights.png') });
  await page.evaluate(() => {
    window.__riskProbeHighlights = [...CSS.highlights];
    for (const [name] of window.__riskProbeHighlights) CSS.highlights.delete(name);
  });
  const plain = await field.screenshot({ path: join(artifacts, 'paint-without-highlights.png') });
  assert.notDeepEqual(highlighted, plain, 'Registered source ranges must actually paint a visible highlight');
  await page.evaluate(() => {
    for (const [name, highlight] of window.__riskProbeHighlights) CSS.highlights.set(name, highlight);
    delete window.__riskProbeHighlights;
  });
}

async function referenceKeyboard() {
  const trigger = page.locator('#sfvi-risk-bar .risk-reference-button');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('#sfvi-allrisks-popup');
  await dialog.waitFor();
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)));
  }
  await audit('reference-light-360');
  await dialog.screenshot({ path: join(artifacts, 'reference-light-360.png') });
  await page.keyboard.press('Escape');
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
}

async function verifyFlagMatrix() {
  assert.deepEqual(Object.keys(flagCases).sort(), RISK_FLAGS.map(flag => flag.id).sort());
  await worker.evaluate(() => chrome.storage.local.set({ sfvi_theme: 'default' }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRule('network-only');
  for (const flag of RISK_FLAGS) {
    const fixture = flagCases[flag.id];
    await setCode('f-body-dynamic', flag.example);
    await waitFlags('sfvi-risk-bar', [flag.id]);
    const severity = ['none', 'medium', 'high', 'critical'][flag.sev];
    const button = page.locator('#sfvi-risk-bar [data-risk-id="' + flag.id + '"]');
    const label = await button.getAttribute('aria-label');
    assert.ok(label.startsWith(severity[0].toUpperCase() + severity.slice(1) + ' ' + flag.label));
    assert.ok(label.includes(fixture.spans.length + ' occurrence'));
    const ranges = [];
    for (const span of fixture.spans) {
      await button.click();
      const selected = await selectedCode('f-body-dynamic');
      assert.equal(selected.text, span, flag.id);
      assert.equal(selected.from, flag.example.indexOf(span), flag.id);
      await waitHighlights('sfvi-risk-' + severity, span);
      ranges.push({ from: selected.from, to: selected.from + span.length, text: selected.text });
    }
    const paint = await page.evaluate(name => {
      const range = [...CSS.highlights.get(name)][0];
      const node = range.startContainer;
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      return { background: getComputedStyle(element, '::highlight(' + name + ')').backgroundColor, priority: CSS.highlights.get(name).priority };
    }, 'sfvi-risk-' + severity);
    assert.equal(paint.priority, flag.sev);
    assert.notEqual(paint.background, 'rgba(0, 0, 0, 0)');
    await setCode('f-body-dynamic', fixture.negative);
    await waitFlags('sfvi-risk-bar', fixture.negativeFlags || []);
    flagMatrix.push({ id: flag.id, label: flag.label, severity, positive: flag.example, detected: true, accessibleLabel: label, ranges, paint, negative: fixture.negative, negativeDetected: fixture.negativeFlags || [], passed: true });
  }
  checks.push('All 16 flags: independent exact source expectations, accessible labels, every occurrence, severity paint and nearby negative examples in the rendered editor');
}

async function referenceGeometry(label) {
  const measured = await page.locator('#sfvi-allrisks-popup').evaluate(dialog => {
    const bounds = dialog.getBoundingClientRect();
    const rect = selector => dialog.querySelector(selector).getBoundingClientRect();
    const heading = rect('h2'), close = rect('#sfvi-allrisks-close'), intro = rect('.risk-reference-intro'), card = rect('.risk-reference-item');
    const scroll = dialog.querySelector('.risk-reference-scroll');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      dialog: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
      inset: parseFloat(getComputedStyle(dialog).getPropertyValue('--risk-inset')),
      headingInset: heading.left - bounds.left, headerInset: close.top - bounds.top,
      closeInset: bounds.right - close.right, introInset: intro.left - bounds.left, cardInset: card.left - bounds.left,
      closeHeight: close.height, horizontalOverflow: dialog.scrollWidth - dialog.clientWidth,
      scrollOverflow: scroll.scrollWidth - scroll.clientWidth, outerScroll: dialog.scrollHeight - dialog.clientHeight,
      innerScroll: scroll.scrollHeight > scroll.clientHeight,
      counts: [...dialog.querySelectorAll('h3 span')].map(element => element.textContent),
    };
  });
  observations.push({ probe: 'reference-geometry', label, ...measured });
  assert.ok(measured.dialog.left >= 0 && measured.dialog.top >= 0 && measured.dialog.right <= measured.viewport.width + 1 && measured.dialog.bottom <= measured.viewport.height + 1, JSON.stringify(measured));
  for (const key of ['headingInset', 'headerInset', 'closeInset', 'introInset', 'cardInset']) assert.ok(measured[key] >= measured.inset, key + ': ' + JSON.stringify(measured));
  assert.ok(measured.closeHeight >= 44);
  assert.ok(measured.horizontalOverflow <= 1 && measured.scrollOverflow <= 1 && measured.outerScroll <= 1 && measured.innerScroll, JSON.stringify(measured));
  assert.deepEqual(measured.counts, ['1 flag', '9 flags', '6 flags']);
}

async function verifyReference(label) {
  await page.locator('#sfvi-risk-bar .risk-reference-button').click();
  await referenceGeometry(label);
  await audit('reference-' + label);
  await captureReference(label, 'top');
  await page.locator('.risk-reference-scroll').focus();
  await page.keyboard.press('End');
  await page.waitForFunction(() => { const scroll = document.querySelector('.risk-reference-scroll'); return scroll.scrollTop > 0 && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2; });
  await captureReference(label, 'bottom');
  await page.keyboard.press('Escape');
}

async function captureReference(label, position) {
  const path = join(artifacts, 'reference-' + label + '-' + position + '.png');
  if (!label.startsWith('zoom-')) {
    await page.locator('#sfvi-allrisks-popup').screenshot({ path });
    return;
  }
  // Playwright's element clip is in unzoomed pixels; capture the native viewport.
  const session = await context.newCDPSession(page);
  try {
    const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(data, 'base64'));
  } finally {
    await session.detach();
  }
}

async function verifySaveReview(label) {
  await page.locator('#btn-save').click();
  const dialog = page.locator('#sfvi-sec-modal');
  await dialog.waitFor();
  const measured = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const header = element.querySelector('h2').getBoundingClientRect();
    const actions = element.querySelector('.dialog-actions').getBoundingClientRect();
    const list = element.querySelector('.security-findings');
    return {
      headerVisible: header.top >= rect.top && header.bottom <= rect.bottom,
      actionsVisible: actions.top >= rect.top && actions.bottom <= rect.bottom,
      initialFocus: document.activeElement.id, outerScroll: element.scrollHeight - element.clientHeight,
      listScrollable: list.scrollHeight > list.clientHeight, listHeight: list.clientHeight,
      horizontalOverflow: element.scrollWidth - element.clientWidth,
    };
  });
  observations.push({ probe: 'save-review-geometry', label, ...measured });
  assert.ok(measured.headerVisible && measured.actionsVisible && measured.listScrollable && measured.listHeight >= 44, JSON.stringify(measured));
  assert.equal(measured.initialFocus, 'security-warning-title');
  assert.ok(measured.outerScroll <= 1 && measured.horizontalOverflow <= 1, JSON.stringify(measured));
  await audit('save-' + label);
  await dialog.screenshot({ path: join(artifacts, 'save-' + label + '.png') });
  await page.locator('.security-findings').focus();
  await page.keyboard.press('End');
  await page.waitForFunction(() => { const list = document.querySelector('.security-findings'); return list.scrollTop + list.clientHeight >= list.scrollHeight - 2; });
  await dialog.screenshot({ path: join(artifacts, 'save-' + label + '-bottom.png') });
  await page.locator('#sfvi-sec-cancel').click();
}

async function verifyAllFlags() {
  const allFlags = RISK_FLAGS.map(flag => flag.id);
  const source = 'function modifyResponse(args) {\n' + RISK_FLAGS.map(flag => '  ' + flag.example).join('\n') + '\n  return args.response;\n}';
  for (const theme of ['default', 'light', 'custom']) {
    await worker.evaluate(theme => chrome.storage.local.set({ sfvi_theme: theme }), theme);
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await openRule('network-only');
      await setCode('f-body-dynamic', source);
      await waitFlags('sfvi-risk-bar', allFlags);
      await page.locator('#sfvi-risk-bar').scrollIntoViewIfNeeded();
      const label = 'all-' + theme + '-' + width;
      await geometry(label);
      await contrastProbe(label);
      await audit(label);
      await page.locator('#sfvi-risk-bar').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: join(artifacts, label + '-top.png') });
      await page.locator('#sfvi-risk-bar [data-risk-id]').last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(artifacts, label + '-bottom.png') });
      await verifyReference(label);
      await verifySaveReview(label);
    }
  }
  checks.push('All 16 flags together at 1440px and 320px in default/light/custom themes; entire reference scroll, insets, singular counts, axe, contrast and targets');
}

async function verifyReferenceZoom() {
  await worker.evaluate(() => chrome.storage.local.set({ sfvi_theme: 'default' }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openRule('network-only');
  await waitFlags('sfvi-risk-bar', ['network_fetch']);
  const session = await context.newCDPSession(page);
  await session.send('Emulation.clearDeviceMetricsOverride');
  const before = await page.evaluate(() => innerWidth);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  try {
    for (const zoom of [1.5, 2]) {
      await worker.evaluate(({ tabId, zoom }) => chrome.tabs.setZoom(tabId, zoom), { tabId, zoom });
      await page.waitForFunction(width => Math.abs(innerWidth - width) <= 1, before / zoom);
      assert.equal(await worker.evaluate(tabId => chrome.tabs.getZoom(tabId), tabId), zoom);
      await geometry('zoom-' + zoom);
      await verifyReference('zoom-' + zoom);
    }
  } finally {
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 1), tabId);
    await session.detach();
  }
  checks.push('Reference at real browser zoom 150% and 200%: consistent insets, one scroll container, keyboard access to the last item and reachable close control');
}

try {
  await worker.evaluate(({ rules, remote }) => chrome.storage.local.set({ sfvi_rules: rules, sfvi_sources: [remote], sfvi_theme: 'default' }), {
    rules, remote: { id: 'source_security', name: 'Security examples', url: 'https://fixtures.example.test/rules.json', intervalMinutes: 60, rules: [{ ...rules[0], id: 'published' }] },
  });
  await openRule('review');
  const formatted = await format(response, { parser: 'babel' });
  await page.waitForFunction(formatted => document.getElementById('f-body-dynamic').value === formatted, formatted);
  await waitFlags('sfvi-risk-bar', ['dynamic_eval', 'cookie_read', 'network_fetch']);
  await waitFlags('sfvi-request-risk-bar', ['navigator_sensors']);
  await waitHighlights('sfvi-risk-critical', 'setTimeout');
  await waitHighlights('sfvi-risk-high', 'navigator.clipboard.readText');
  const marks = await highlightTexts();
  assert.equal(marks['sfvi-risk-medium'].filter(text => text === 'fetch').length, 2);
  assert.ok(marks['sfvi-risk-high'].includes('document.cookie'));
  assert.equal(await page.evaluate(async () => (await import('./editor/editor.js')).getEditorValue('f-body-dynamic')), response);
  assert.equal(await page.locator('#btn-save').isVisible(), false);
  checks.push('Automatic presentation is analyzed at displayed offsets; request/response highlights coexist without dirtying backing code');
  await geometry('request-response-initial');
  checks.push('Hidden accessible flag descriptions do not grow the document; root scroll is impossible and the footer stays at the viewport edge');

  const button = page.locator('#sfvi-risk-bar [data-risk-id="network_fetch"]');
  await button.click(); const first = await selectedCode('f-body-dynamic');
  await button.click(); const second = await selectedCode('f-body-dynamic');
  assert.equal(first.text, 'fetch'); assert.equal(second.text, 'fetch'); assert.ok(second.from > first.from);
  checks.push('Flag activation focuses the editor and cycles exact occurrences');

  await setCode('f-body-dynamic', response);
  await page.locator('#fmt-dynamic').click();
  await page.waitForFunction(formatted => document.getElementById('f-body-dynamic').value === formatted, formatted);
  await waitHighlights('sfvi-risk-critical', 'setTimeout');
  await page.evaluate(() => CM6.EditorView.findFromDOM(document.querySelector('#f-body-dynamic').previousElementSibling.querySelector('.cm-editor')).focus());
  await page.keyboard.press('Control+z');
  await page.waitForFunction(response => document.getElementById('f-body-dynamic').value === response, response);
  await waitHighlights('sfvi-risk-high', 'document.cookie');
  await page.keyboard.press('Control+y');
  await page.waitForFunction(formatted => document.getElementById('f-body-dynamic').value === formatted, formatted);
  checks.push('Formatting and undo/redo preserve highlight alignment and backing source');

  const rapid = '// 😀 a new prefix before a pending analysis\n' + formatted;
  const rapidSelection = await page.evaluate(async code => {
    (await import('./editor/editor.js')).setEditorValue('f-body-dynamic', code);
    document.querySelector('#sfvi-risk-bar [data-risk-id="cookie_read"]').click();
    const view = CM6.EditorView.findFromDOM(document.getElementById('f-body-dynamic').previousElementSibling.querySelector('.cm-editor'));
    const selection = view.state.selection.main;
    return { text: view.state.doc.sliceString(selection.from, selection.to), from: selection.from };
  }, rapid);
  assert.equal(rapidSelection.text, 'document.cookie');
  assert.equal(rapidSelection.from, rapid.indexOf('document.cookie'));
  checks.push('Badge navigation resolves current source even before debounced analysis catches up');

  await setCode('f-body-dynamic', 'function modifyResponse(args) { document.cookie += "; path=/"; return args.response; }');
  await waitFlags('sfvi-risk-bar', ['cookie_read', 'cookie_write']);
  await waitHighlights('sfvi-risk-high', 'document.cookie');
  await waitHighlights('sfvi-risk-medium', 'document.cookie');
  assert.ok(await page.evaluate(() => CSS.highlights.get('sfvi-risk-high').priority > CSS.highlights.get('sfvi-risk-medium').priority));
  checks.push('Overlapping read/write evidence retains both flags and gives the higher severity paint precedence');

  await setCode('f-body-dynamic', formatted);
  await waitHighlights('sfvi-risk-critical', 'setTimeout');
  await page.locator('#dynamic-body-field [title="Fold line"]:visible').first().click();
  await page.waitForFunction(() => !CSS.highlights.get('sfvi-risk-critical')?.size);
  await page.locator('#dynamic-body-field [title="Unfold line"]:visible').first().click();
  await waitHighlights('sfvi-risk-critical', 'setTimeout');
  checks.push('Folding removes hidden source ranges; unfolding restores correctly positioned paint');

  for (const theme of ['default', 'light', 'custom']) {
    await worker.evaluate(theme => chrome.storage.local.set({ sfvi_theme: theme, sfvi_theme_custom: { bg: '#122019', accent: '#8bc9a2', surface: '#1b3025' } }), theme);
    for (const width of [1440, 360, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await openRule('review');
      await waitFlags('sfvi-risk-bar', ['dynamic_eval', 'cookie_read', 'network_fetch']);
      await waitHighlights('sfvi-risk-critical', 'setTimeout');
      await geometry(theme + '-' + width);
      await contrastProbe(theme + '-' + width);
      await audit(theme + '-' + width);
      await page.locator('#dynamic-body-field').screenshot({ path: join(artifacts, 'flags-' + theme + '-' + width + '.png') });
      if (theme === 'default' && width === 1440) await verifyPaint();
      if (theme === 'light' && width === 360) await referenceKeyboard();
    }
  }
  checks.push('Default, light and custom themes at desktop/narrow widths: axe, overflow and touch targets; native reference keyboard trap and restoration');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRule('review');
  await setCode('f-body-dynamic', 'function unfinished(');
  await page.locator('#sfvi-risk-bar').getByText('Analysis unavailable').waitFor();
  assert.equal((await highlightTexts())['sfvi-risk-critical'].length, 0);
  await setCode('f-body-dynamic', 'function modifyResponse(args) { return args.responseJSON; }');
  await waitFlags('sfvi-risk-bar', []);
  await page.locator('#btn-save').click();
  await page.locator('#sfvi-sec-modal').waitFor();
  assert.ok((await page.locator('#sfvi-sec-modal').innerText()).includes('Request JavaScript'));
  await page.locator('#sfvi-sec-cancel').click();
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('sfvi_rules'))).sfvi_rules[0].response.body, response);
  checks.push('Syntax errors remove stale highlights; high request-only flags require review; cancelling leaves storage unchanged');

  const longSource = 'function modifyResponse(args) {\n' + Array.from({ length: 250 }, (_, index) => '  const value' + index + ' = ' + index + ';').join('\n') + '\n  fetch("/last");\n  return args.responseJSON;\n}';
  await setCode('f-body-dynamic', longSource);
  await waitFlags('sfvi-risk-bar', ['network_fetch']);
  await page.locator('#sfvi-risk-bar [data-risk-id="network_fetch"]').click();
  await waitHighlights('sfvi-risk-medium', 'fetch');
  assert.equal((await selectedCode('f-body-dynamic')).text, 'fetch');
  checks.push('Offscreen source navigation redraws highlights after virtual scrolling');

  await openRule('static-js');
  await waitFlags('sfvi-static-risk-bar', ['cookie_read']);
  assert.equal((await highlightTexts())['sfvi-risk-critical'].length, 0);
  await setCode('f-body-static', 'eval(payload);');
  await waitFlags('sfvi-static-risk-bar', ['dynamic_eval']);
  await geometry('static-js');
  await page.locator('#btn-save').click();
  await page.locator('#sfvi-sec-modal').waitFor();
  await page.locator('#sfvi-sec-cancel').click();
  checks.push('Static JavaScript replacements are analyzed and reviewed on save');

  await openRule('remote:source_security:published');
  await waitFlags('sfvi-risk-bar', ['dynamic_eval', 'cookie_read', 'network_fetch']);
  assert.equal(await page.locator('#f-body-dynamic').evaluate(element => element.readOnly), true);
  await page.locator('#sfvi-risk-bar [data-risk-id="cookie_read"]').click();
  assert.equal((await selectedCode('f-body-dynamic')).text, 'document.cookie');
  await geometry('remote-read-only');
  checks.push('Read-only remote content retains navigable flags and exact highlights');

  await openRule('network-only');
  await waitFlags('sfvi-risk-bar', ['network_fetch']);
  await page.locator('#f-description').fill('Reviewed network example');
  await page.locator('#btn-save').click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent === 'Rule saved');
  assert.equal(await page.locator('#sfvi-sec-modal').count(), 0);
  assert.deepEqual(errors, []);
  checks.push('Medium capability flags stay visible without a blocking confirmation; no page errors or failed extension requests');
  await verifyFlagMatrix();
  await verifyAllFlags();
  await verifyReferenceZoom();
  assert.deepEqual(errors, []);
  console.log('Security browser probes passed: ' + checks.length + ' scenarios.');
} finally {
  writeFileSync(join(artifacts, 'flag-matrix.json'), JSON.stringify(flagMatrix, null, 2));
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ session: { mode: 'unpacked extension', isolatedProfile: true, syntheticRules: true }, checks, observations, errors }, null, 2));
  await context.close();
}
