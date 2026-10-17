import { chromium } from 'playwright';
import { format } from 'prettier';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const artifacts = resolve('.artifacts/formatter');
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
const errors = [], requests = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => errors.push(request.url() + ': ' + request.failure()?.errorText));
page.on('request', request => requests.push(request.url()));
const source = [
  'function modifyResponse(args){const response=args.response;',
  'if(typeof window === "undefined" || typeof document === "undefined"){return response;}',
  '// Preserve regex punctuation and template interpolation.',
  'const matcher=/[{};]/g;const label=`value: ${args.value ?? "none"}`;',
  'for(let i=0;i<3;i++){if(matcher.test(label)){response.push({i,label});}}',
  'function visible(el){if(!el||!el.isConnected)return false;const css=getComputedStyle(el);return css.display!=="none"&&css.visibility!=="hidden"&&el.getClientRects().length>0;}',
  'return response;}',
].join('\n');
const json = '{"big":9007199254740993,"same":1,"same":2}';
const css = '.card{color:red;padding:4px 8px}';
const html = '<main><h1>Hello</h1><script>const x={a:1};</script></main>';
const makeRule = (id, resourceType, body, type = 'static', subtype = 'html') => ({
  id, name: 'Formatter ' + id, enabled: true, version: '1.0.0', resourceType, resourceSubtype: subtype,
  pairs: [{ id: 'p-' + id, urlPattern: '/fixtures/' + id, urlOperator: 'Contains' }],
  request: { type: 'static', body: '{"request":1}' }, response: { type, body },
});
const rules = [makeRule('javascript', 'html', source, 'dynamic', 'js'), makeRule('json', 'rest', json),
  makeRule('css', 'html', css, 'static', 'css'), makeRule('html', 'html', html)];

async function value(id) { return page.locator('#' + id).inputValue(); }
async function waitValue(id, expected) {
  await page.waitForFunction(({ id, expected }) => document.getElementById(id)?.value === expected, { id, expected });
}
async function selectRule(id) { await page.locator('.nav-rule[data-id="' + id + '"] .nav-rule-open').click(); }
async function focusCode(id) {
  await page.evaluate(id => window.CM6.EditorView.findFromDOM(document.getElementById(id).previousElementSibling.querySelector('.cm-editor')).focus(), id);
}

try {
  await worker.evaluate(({ rules, remote }) => chrome.storage.local.set({ sfvi_rules: rules, sfvi_sources: [remote] }), {
    rules, remote: { id: 'source_format', name: 'Read-only formatter', url: 'https://fixtures.sfvi.test/formatter.json', intervalMinutes: 60,
      rules: [{ ...rules[0], id: 'published', name: 'Read-only formatter' }] },
  });
  await page.goto(extension + '/dashboard/dashboard.html?edit=javascript');
  await page.locator('#f-body-dynamic').waitFor({ state: 'attached' });
  const expected = await format(source, { parser: 'babel' });
  await waitValue('f-body-dynamic', expected);
  assert.equal(await page.evaluate(async () => (await import('./editor/editor.js')).getEditorValue('f-body-dynamic')), source);
  assert.equal(await page.locator('#btn-save').isVisible(), false, 'Initial presentation must not dirty the rule');
  await page.evaluate(async source => (await import('./editor/editor.js')).setEditorValue('f-body-dynamic', source), source);
  const offset = source.indexOf('response');
  await page.evaluate(({ offset }) => {
    const textarea = document.getElementById('f-body-dynamic');
    const view = window.CM6.EditorView.findFromDOM(textarea.previousElementSibling.querySelector('.cm-editor'));
    view.dispatch({ selection: { anchor: offset + 8, head: offset } });
  }, { offset });
  await page.locator('#fmt-dynamic').click();
  await waitValue('f-body-dynamic', expected);
  assert.equal(await page.locator('#btn-save').isVisible(), false, 'Presentation-only Format must not dirty the rule');
  const selection = await page.evaluate(() => {
    const view = window.CM6.EditorView.findFromDOM(document.getElementById('f-body-dynamic').previousElementSibling.querySelector('.cm-editor'));
    const { anchor, head } = view.state.selection.main;
    return { anchor, head, text: view.state.doc.sliceString(head, anchor) };
  });
  assert.ok(selection.anchor > selection.head); assert.equal(selection.text, 'response');
  await page.locator('#dynamic-body-field').screenshot({ path: join(artifacts, 'javascript.png') });
  await focusCode('f-body-dynamic');
  await page.keyboard.press('Control+z'); await waitValue('f-body-dynamic', source);
  await page.keyboard.press('Control+y'); await waitValue('f-body-dynamic', expected);
  checks.push('JavaScript presentation matches official Prettier; backing, clean state, reversed selection and visual undo/redo preserved');

  await page.evaluate(async () => {
    const editor = await import('./editor/editor.js');
    editor.setEditorValue('f-body-dynamic', 'function broken( {');
  });
  await page.locator('#fmt-dynamic').click();
  await page.locator('#toast.error').waitFor();
  assert.equal(await value('f-body-dynamic'), 'function broken( {');
  checks.push('Syntax errors preserve the exact original body');

  for (const scenario of ['typing', 'edit-back', 'selection']) {
    const result = await page.evaluate(async ({ source, scenario }) => {
      const editor = await import('./editor/editor.js'); const id = 'f-body-dynamic';
      editor.setEditorValue(id, source);
      const view = window.CM6.EditorView.findFromDOM(document.getElementById(id).previousElementSibling.querySelector('.cm-editor'));
      view.dispatch({ selection: { anchor: 10 } });
      const pending = editor.formatEditor(id);
      if (scenario === 'selection') view.dispatch({ selection: { anchor: 0 } });
      else {
        editor.setEditorValue(id, '// New user edit\n' + source);
        if (scenario === 'edit-back') editor.setEditorValue(id, source);
      }
      return { applied: await pending, body: editor.getEditorValue(id) };
    }, { source, scenario });
    assert.equal(result.applied, false);
    assert.equal(result.body, scenario === 'typing' ? '// New user edit\n' + source : source);
  }
  checks.push('Typing, edit-back and caret movement cancel stale publication');

  await page.evaluate(source => {
    document.getElementById('fmt-dynamic').click();
    document.querySelector('.subtype-btn[data-sub="css"]').click();
    document.querySelector('.subtype-btn[data-sub="js"]').click();
  }, source);
  await page.waitForFunction(() => !document.getElementById('fmt-dynamic').disabled);
  assert.equal(await value('f-body-dynamic'), source);
  checks.push('Context changes and changes back invalidate pending formatting');

  await page.evaluate(() => {
    document.getElementById('fmt-dynamic').click();
    document.querySelector('.nav-rule[data-id="json"] .nav-rule-open').click();
  });
  await waitValue('f-body-static', await format(json, { parser: 'json' }));
  await page.locator('#fmt-static').click();
  await waitValue('f-body-static', await format(json, { parser: 'json' }));
  checks.push('Switching rules discards the old result; raw JSON digits and duplicate keys survive');

  await selectRule('css'); await focusCode('f-body-static');
  await page.keyboard.press('Alt+Shift+f');
  await waitValue('f-body-static', await format(css, { parser: 'css' }));
  checks.push('Alt+Shift+F uses the current CSS parser');
  await selectRule('html'); await page.locator('#fmt-static').click();
  await waitValue('f-body-static', await format(html, { parser: 'html' }));
  checks.push('HTML formats embedded JavaScript with the packaged plugins');

  await page.locator('.nav-rule').filter({ hasText: 'Read-only formatter' }).locator('.nav-rule-open').click();
  assert.equal(await page.locator('#fmt-dynamic').isDisabled(), true);
  const readOnly = await page.evaluate(async () => (await import('./editor/editor.js')).formatEditor('f-body-dynamic'));
  await waitValue('f-body-dynamic', expected);
  assert.equal(readOnly, false); assert.equal(await value('f-body-dynamic'), expected);
  assert.equal(await page.evaluate(async () => (await import('./editor/editor.js')).getEditorValue('f-body-dynamic')), source);
  await focusCode('f-body-dynamic'); await page.keyboard.press('Alt+Shift+f');
  assert.equal(await value('f-body-dynamic'), expected);
  checks.push('Read-only automatic presentation preserves remote backing; explicit commands cannot mutate it');
  await page.evaluate(async css => {
    const editor = await import('./editor/editor.js');
    const textarea = document.createElement('textarea'); textarea.id = 'format-fallback';
    document.body.appendChild(textarea);
    const cm = window.CM6; window.CM6 = null;
    textarea.dataset.changes = '0';
    editor.mountEditor(textarea.id, css, () => { textarea.dataset.changes = String(Number(textarea.dataset.changes) + 1); }, { getLanguage: () => 'css' });
    window.CM6 = cm;
  }, css);
  await waitValue('format-fallback', await format(css, { parser: 'css' }));
  const fallback = await page.evaluate(async css => {
    const editor = await import('./editor/editor.js');
    const textarea = document.getElementById('format-fallback');
    await editor.formatEditor(textarea.id, { language: 'css' });
    const formatted = textarea.value, notifications = Number(textarea.dataset.changes);
    const backing = editor.getEditorValue(textarea.id);
    editor.setEditorValue(textarea.id, css);
    const pending = editor.formatEditor(textarea.id, { language: 'css' });
    editor.setEditorValue(textarea.id, css + ' '); editor.setEditorValue(textarea.id, css);
    const staleApplied = await pending;
    textarea.remove();
    return { formatted, backing, notifications, staleApplied };
  }, css);
  assert.equal(fallback.formatted, await format(css, { parser: 'css' }));
  assert.equal(fallback.backing, css); assert.equal(fallback.notifications, 0); assert.equal(fallback.staleApplied, false);
  checks.push('Textarea presentation preserves backing without change notifications and rejects edit-back races; native undo is outside the claim');
  assert.deepEqual(errors, []);
  assert.ok(requests.some(url => url.includes('/shared/vendor/prettier/standalone.mjs')));
  assert.ok(requests.every(url => url.startsWith(extension)));
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ checks, errors, requests }, null, 2));
  console.log('Formatter browser checks passed:', checks.length, 'scenarios; packaged Prettier under MV3 CSP.');
} catch (error) {
  await page.screenshot({ path: join(artifacts, 'failure.png') });
  writeFileSync(join(artifacts, 'failed.json'), JSON.stringify({ checks, errors, error: error.stack }, null, 2));
  throw error;
} finally { await context.close(); }
