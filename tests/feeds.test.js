import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installChrome, rule } from './helpers/chrome.js';
import { fetchRuleDocument, fetchRuleSnapshot } from '../shared/rule-document.js';
import { addSource, syncSource, getSources } from '../sw/core/sources.js';

let fixture;
const url = 'https://feeds.test/private/collection?token=a%2Bb&download=1';
beforeEach(() => { fixture = installChrome({ sfvi_rules: [rule()] }); });

function respond(document, etag, status = 200) {
  const headers = etag ? { ETag: etag } : {};
  return new Response(status === 304 ? null : JSON.stringify(document), { status, headers });
}

test('any HTTPS path, query and response MIME works when its response is rule JSON', async () => {
  for (const indentation of [undefined, 2]) {
    const requests = [];
    globalThis.fetch = async (input, options) => {
      requests.push({ input, options });
      return new Response(JSON.stringify({ rules: [rule()] }, null, indentation), { headers: { 'Content-Type': 'text/plain' } });
    };
    assert.equal((await fetchRuleDocument(url + '#browser-only', { requireIds: true }))[0].id, 'account');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].input, url);
    assert.equal(requests[0].options.headers.Accept, 'application/json');
    assert.equal(requests[0].options.credentials, 'omit');
    assert.equal(requests[0].options.referrerPolicy, 'no-referrer');
  }
});

test('conditional checks preserve exact weak ETags and never parse a 304 body', async () => {
  let request;
  globalThis.fetch = async (_input, options) => { request = options; return respond(null, undefined, 304); };
  const snapshot = await fetchRuleSnapshot(url, { etag: 'W/"opaque-version"', requireIds: true });
  assert.deepEqual(snapshot, { notModified: true, etag: 'W/"opaque-version"' });
  assert.equal(request.headers['If-None-Match'], 'W/"opaque-version"');
  assert.equal(request.cache, 'no-store');
});

test('polling commits validators with valid snapshots and preserves locals, versions and last good data', async () => {
  const source = await addSource({ url, intervalMinutes: 5 });
  const local = structuredClone(fixture.data.sfvi_rules);
  const checks = [];
  let response = () => respond([rule({ version: '2', response: { type: 'dynamic', body: 'function modifyResponse(args) {\n  return args.response;\n}' } })], '"v2"');
  globalThis.fetch = async (_input, options) => { checks.push(options.headers['If-None-Match']); return response(); };
  const first = await syncSource(source.id);
  assert.equal(first.source.etag, '"v2"');
  assert.ok(first.source.rules[0].response.body.includes('\n'), 'Polling mirrors source code without formatting it');
  response = () => respond(null, undefined, 304);
  const checked = await syncSource(source.id);
  assert.equal(checked.changed, false);
  assert.deepEqual(checked.source.rules, first.source.rules);
  assert.equal(checked.source.lastSyncedAt, first.source.lastSyncedAt);
  assert.ok(checked.source.lastCheckedAt >= first.source.lastCheckedAt);
  response = () => respond([rule({ version: 'bad' })], '"invalid"');
  const failed = await syncSource(source.id);
  assert.ok(failed.source.lastError);
  assert.equal(failed.source.etag, '"v2"');
  assert.deepEqual(failed.source.rules, first.source.rules);
  response = () => respond([rule({ version: '1', enabled: false }), rule({ id: 'new' })]);
  const changed = await syncSource(source.id);
  assert.equal(changed.changed, true);
  assert.equal(changed.source.etag, '');
  assert.equal(changed.source.rules[0].version, '1');
  assert.equal(changed.source.rules[0].enabled, false);
  response = () => respond([], '"empty"');
  await syncSource(source.id);
  response = () => respond(null, undefined, 304);
  const empty = await syncSource(source.id);
  assert.deepEqual(empty.source.rules, []);
  assert.equal(empty.source.etag, '"empty"');
  assert.deepEqual(checks, [undefined, '"v2"', '"v2"', '"v2"', undefined, '"empty"']);
  assert.deepEqual(fixture.data.sfvi_rules, local);
});

test('initial/import unsolicited 304 and malformed validators cannot create a snapshot', async () => {
  globalThis.fetch = async () => respond(null, '"server-tag"', 304);
  await assert.rejects(fetchRuleDocument(url), /304 without a saved snapshot/);
  const source = await addSource({ url });
  const result = await syncSource(source.id);
  assert.equal(result.source.lastSyncedAt, null);
  assert.equal(result.source.etag, '');
  assert.deepEqual(result.source.rules, []);
  for (const etag of ['invalid', '"tag"\r\nX-Injected: yes', '"' + 'x'.repeat(1100) + '"']) {
    let options;
    // Only the saved request validator is malformed; the response is well formed.
    globalThis.fetch = async (_url, input) => { options = input; return respond([], 'invalid'); };
    const snapshot = await fetchRuleSnapshot(url, { etag });
    assert.equal(options.headers['If-None-Match'], undefined);
    assert.equal(snapshot.etag, '');
  }
});

test('HTML, encrypted binary and HTTP failures make no extra requests and retain the snapshot and ETag', async () => {
  const source = await addSource({ url });
  globalThis.fetch = async () => respond([rule()], '"good"');
  await syncSource(source.id);
  const previous = (await getSources())[0];
  for (const response of [new Response('<html><script>fetch("other-url")</script></html>'), new Response(new Uint8Array([76, 81, 80, 70, 3])), new Response('Unavailable', { status: 503 })]) {
    let count = 0;
    globalThis.fetch = async () => { count++; return response; };
    const failed = await syncSource(source.id);
    assert.equal(count, 1);
    assert.ok(failed.source.lastError);
    assert.deepEqual(failed.source.rules, previous.rules);
    assert.equal(failed.source.etag, previous.etag);
    assert.equal(failed.source.lastSyncedAt, previous.lastSyncedAt);
  }
});

test('storage quota failure cannot commit a new validator over the last good snapshot', async () => {
  const source = await addSource({ url });
  globalThis.fetch = async () => respond([rule()], '"good"');
  await syncSource(source.id);
  const previous = (await getSources())[0];
  const set = chrome.storage.local.set;
  chrome.storage.local.set = async values => {
    if (values.sfvi_sources?.[0]?.etag === '"too-big"') throw new Error('QUOTA_BYTES quota exceeded');
    return set(values);
  };
  globalThis.fetch = async () => respond([rule({ version: '2' })], '"too-big"');
  const failed = await syncSource(source.id);
  assert.match(failed.source.lastError, /quota/i);
  assert.equal(failed.source.etag, previous.etag);
  assert.deepEqual(failed.source.rules, previous.rules);
});
