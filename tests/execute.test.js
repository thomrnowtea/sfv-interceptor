import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { applyAssetRule } from '../sw/handlers/execute.js';

function browserFixture() {
  const inserted = [], errors = [], blobBodies = new Map();
  let fetches = 0;
  const context = createContext({
    console: { error: (...args) => errors.push(args.join(' ')) },
    setTimeout, clearTimeout,
    Blob: class { constructor(parts) { this.body = parts.join(''); } },
    URL: {
      createObjectURL(blob) { const url = 'blob:fixture/' + blobBodies.size; blobBodies.set(url, blob.body); return url; },
      revokeObjectURL() {},
    },
    fetch: async () => { fetches++; return { ok: true, text: async () => 'window.originalFetched = true;' }; },
    addEventListener() {}, removeEventListener() {},
  });
  context.window = context;
  const head = {
    appendChild(element) {
      inserted.push(element);
      if (element.tag === 'script') {
        try { runInContext(element.src ? blobBodies.get(element.src) : element.textContent, context); }
        catch (error) { errors.push(error.message); }
        element.onload?.();
      }
    },
  };
  context.document = {
    head, documentElement: head,
    createElement(tag) { return { tag, sheet: tag === 'style' ? {} : null, remove() {} }; },
  };
  const execute = runInContext('(' + applyAssetRule.toString() + ')', context);
  return { context, inserted, errors, blobBodies, fetches: () => fetches,
    apply: options => execute({ code: 'function modifyResponse(args) { return args.response; }',
      url: 'https://fixture.test/bundle.js', file: 'bundle.js', subtype: 'js', ...options }) };
}

for (const field of [{}, { staticBody: undefined }, { staticBody: null }]) {
  test('dynamic JS replacement accepts ' + (Object.hasOwn(field, 'staticBody') ? String(field.staticBody) : 'omitted') + ' static body', async () => {
    const fixture = browserFixture();
    const result = await fixture.apply({ ...field, original: 'window.replaced = true;' });
    assert.equal(result.applied, true);
    assert.equal(fixture.context.replaced, true);
    assert.equal(fixture.fetches(), 0);
    assert.equal(fixture.inserted.length, 1);
  });
}

test('empty static replacement skips both the source fetch and modifier', async () => {
  const fixture = browserFixture();
  const result = await fixture.apply({ staticBody: '', code: 'throw Error("Modifier must not run");' });
  assert.equal(result.applied, true);
  assert.equal(fixture.fetches(), 0);
  assert.equal(fixture.errors.length, 0);
});

for (const field of [{}, { original: null }]) {
  test('missing source falls back to fetching the asset: ' + JSON.stringify(field), async () => {
    const fixture = browserFixture();
    const result = await fixture.apply(field);
    assert.equal(result.applied, true);
    assert.equal(fixture.context.originalFetched, true);
    assert.equal(fixture.fetches(), 1);
  });
}

test('cached original awaits an async modifier before installing its replacement', async () => {
  const fixture = browserFixture();
  const result = await fixture.apply({ original: 'window.originalRan = true;',
    code: 'async function modifyResponse() { await Promise.resolve(); return "window.asyncPatched = true;"; }' });
  assert.equal(result.applied, true);
  assert.equal(fixture.context.asyncPatched, true);
  assert.equal(fixture.context.originalRan, undefined);
});

test('custom thenables and nullish async results keep a valid original source', async () => {
  const fixture = browserFixture();
  const result = await fixture.apply({ original: 'window.originalRan = true;',
    code: 'function modifyResponse() { return { then(resolve) { resolve(null); } }; }' });
  assert.equal(result.applied, true);
  assert.equal(fixture.context.originalRan, true);
});

test('a rejected modifier does not install or report a successful replacement', async () => {
  const fixture = browserFixture();
  const result = await fixture.apply({ original: 'window.originalRan = true;',
    code: 'async function modifyResponse() { throw Error("Expected modifier failure"); }' });
  assert.equal(result.applied, false);
  assert.equal(fixture.inserted.length, 0);
  assert.match(fixture.errors[0], /Expected modifier failure/);
});

test('unsupported transform output is rejected before inserting a script', async () => {
  const fixture = browserFixture();
  const result = await fixture.apply({ original: 'window.originalRan = true;',
    code: 'function modifyResponse() { return () => {}; }' });
  assert.equal(result.applied, false);
  assert.equal(fixture.inserted.length, 0);
  assert.match(fixture.errors[0], /must produce a string/);
});

test('a script that starts and throws is not executed again through Blob fallback', async () => {
  const fixture = browserFixture();
  const result = await fixture.apply({ staticBody: 'window.executions = (window.executions || 0) + 1; throw Error("Expected runtime failure");' });
  assert.equal(result.applied, false);
  assert.equal(fixture.context.executions, 1);
  assert.equal(fixture.blobBodies.size, 0);
});
