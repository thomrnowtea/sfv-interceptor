import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installChrome, rule, jsonFetch, until, extensionSender } from './helpers/chrome.js';
import { getRules, toggleRule, saveRule, deleteRule } from '../sw/core/rules.js';
import { addSource, syncSource, getSources, deleteSource } from '../sw/core/sources.js';
import { remoteRuleId, materializeSourceRules, portableRule } from '../shared/rule-schema.js';
import { getApiRules, handleMessage } from '../sw/handlers/messaging.js';
import { pageExecution, recordApplied, tabActivity, isExecutionSnapshotCurrent } from '../sw/core/activity.js';

let fixture;
beforeEach(() => { fixture = installChrome({ sfvi_rules: [rule()] }); });

async function subscribe(rules = [rule()], url = 'https://team.test/shared') {
  jsonFetch(rules);
  const source = await addSource({ url });
  await syncSource(source.id);
  return source;
}

async function effective(source, id = 'account') {
  return (await getRules()).find(rule => rule.id === remoteRuleId(source.id, id));
}

const file = (overrides = {}) => rule({ resourceType: 'html', resourceSubtype: 'js',
  pairs: [{ id: 'file', urlPattern: '/app.js', urlOperator: 'Contains' }],
  response: { type: 'static', body: 'window.fixture = true;' }, ...overrides });

test('local activation leaves published content immutable and persists through publisher state/version changes and restart', async () => {
  const source = await subscribe();
  const id = remoteRuleId(source.id, 'account');
  const original = (await getSources())[0].rules;
  await toggleRule(id);
  assert.equal((await effective(source)).enabled, false);
  assert.deepEqual((await getSources())[0].rules, original);
  jsonFetch([rule({ version: '2', enabled: false, response: { type: 'static', body: 'new published body' } })]);
  await syncSource(source.id);
  assert.equal((await effective(source)).enabled, false);
  assert.equal((await effective(source)).version, '2');
  assert.equal((await effective(source)).response.body, 'new published body');
  await toggleRule(id);
  assert.equal((await effective(source)).enabled, true);
  assert.equal((await getSources())[0].rules[0].enabled, false);
  jsonFetch([rule({ version: '3', enabled: true })]);
  await syncSource(source.id);
  const fresh = await import('../sw/core/rules.js?restart=' + crypto.randomUUID());
  assert.equal((await fresh.getRules()).find(rule => rule.id === id).enabled, true);
  await toggleRule(id);
  await toggleRule(id); // Still records explicit true, even though source default is true.
  jsonFetch([rule({ version: '4', enabled: false })]);
  await syncSource(source.id);
  assert.equal((await effective(source)).enabled, true);
  assert.equal((await getSources())[0].enabledOverrides.account, true);
  assert.throws(() => saveRule({ ...(materializeSourceRules((fixture.data.sfvi_sources)[0]))[0], readOnly: false }), /read-only/);
  assert.throws(() => deleteRule(id), /read-only/);
  assert.deepEqual(fixture.data.sfvi_rules, [rule()]);
});

test('legacy sources inherit published defaults; sources sharing IDs keep independent activation', async () => {
  fixture.data.sfvi_sources = [{ id: 'legacy', rules: [rule({ enabled: false })] }];
  assert.equal((await effective({ id: 'legacy' })).enabled, false);
  assert.equal((await toggleRule(remoteRuleId('legacy', 'account'))).enabled, true);
  const other = await subscribe([rule()], 'https://other.test/shared');
  await toggleRule(remoteRuleId(other.id, 'account'));
  assert.equal((await effective({ id: 'legacy' })).enabled, true);
  assert.equal((await effective(other)).enabled, false);
  const copy = portableRule(await effective(other));
  assert.equal(copy.enabled, false);
  assert.equal(copy.readOnly, undefined);
});

test('special publisher IDs are exact own keys and cannot spoof local or other source identities', async () => {
  const ids = ['__proto__', 'constructor', 'toString', 'a:b/%|😀'];
  const source = await subscribe(ids.map(id => rule({ id })));
  for (const id of ids) await toggleRule(remoteRuleId(source.id, id));
  const stored = (await getSources())[0];
  for (const id of ids) {
    assert.equal(Object.hasOwn(stored.enabledOverrides, id), true);
    assert.equal(stored.enabledOverrides[id], false);
    assert.equal((await effective(source, id)).enabled, false);
  }
  assert.equal(Object.getPrototypeOf(stored.enabledOverrides), Object.prototype);
  await assert.rejects(toggleRule('remote:other:' + encodeURIComponent(ids[3])), /not found/);
  assert.throws(() => toggleRule({ id: 'account' }), /id must be text/);
  assert.deepEqual(fixture.data.sfvi_rules, [rule()]);
});

test('304 and failed sync preserve preferences; valid removal/empty snapshots prune them', async () => {
  const source = await subscribe([rule(), rule({ id: 'other' })]);
  await toggleRule(remoteRuleId(source.id, 'account'));
  await toggleRule(remoteRuleId(source.id, 'other'));
  fixture.data.sfvi_sources[0].etag = '"v1"';
  globalThis.fetch = async () => new Response(null, { status: 304 });
  await syncSource(source.id);
  assert.deepEqual((await getSources())[0].enabledOverrides, { account: false, other: false });
  globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
  await syncSource(source.id);
  assert.deepEqual((await getSources())[0].enabledOverrides, { account: false, other: false });
  jsonFetch([rule({ version: '2' })]);
  await syncSource(source.id);
  assert.deepEqual((await getSources())[0].enabledOverrides, { account: false });
  jsonFetch([]);
  await syncSource(source.id);
  assert.deepEqual((await getSources())[0].enabledOverrides, {});
  jsonFetch([rule()]);
  await syncSource(source.id);
  assert.equal((await effective(source)).enabled, true);
});

test('toggle during download survives commit; concurrent toggles serialize without changing the snapshot', async () => {
  const source = await subscribe();
  const id = remoteRuleId(source.id, 'account');
  let finish;
  globalThis.fetch = async () => new Promise(resolve => { finish = resolve; });
  const syncing = syncSource(source.id);
  await until(() => finish);
  await toggleRule(id);
  finish(new Response(JSON.stringify([rule({ version: '2' })])));
  await syncing;
  assert.equal((await effective(source)).version, '2');
  assert.equal((await effective(source)).enabled, false);
  const results = await Promise.all([toggleRule(id), toggleRule(id)]);
  assert.deepEqual(results.map(rule => rule.enabled), [true, false]);
  assert.equal((await effective(source)).enabled, false);
  assert.equal((await getSources())[0].rules[0].enabled, true);
});

test('sync validation and a queued toggle apply in order against the newest content', async () => {
  const source = await subscribe([file()]);
  let release;
  chrome.declarativeNetRequest.isRegexSupported = async () => new Promise(resolve => { release = () => resolve({ isSupported: true }); });
  jsonFetch([file({ version: '2' })]);
  const syncing = syncSource(source.id);
  await until(() => release);
  const toggling = toggleRule(remoteRuleId(source.id, 'account'));
  release();
  await Promise.all([syncing, toggling]); // Disabling needs no additional DNR check.
  assert.equal((await effective(source)).version, '2');
  assert.equal((await effective(source)).enabled, false);
});

test('effective disabled file patterns may sync, but enabling an unsupported expression cannot persist', async () => {
  const source = await subscribe([file()]);
  await toggleRule(remoteRuleId(source.id, 'account'));
  chrome.declarativeNetRequest.isRegexSupported = async () => ({ isSupported: false, reason: 'syntaxError' });
  const invalid = file({ version: '2', pairs: [{ id: 'file', urlPattern: '(?=file)', urlOperator: 'Regex' }] });
  jsonFetch([invalid]);
  const synced = await syncSource(source.id);
  assert.equal(synced.source.lastError, '');
  assert.equal((await effective(source)).version, '2');
  await assert.rejects(toggleRule(remoteRuleId(source.id, 'account')), /Unsupported file URL expression/);
  assert.equal((await effective(source)).enabled, false);
  assert.equal((await getSources())[0].rules[0].enabled, true);
});

test('locally enabled publisher-disabled files validate incoming patterns atomically with ETag and preferences', async () => {
  const source = await subscribe([file({ enabled: false })]);
  await toggleRule(remoteRuleId(source.id, 'account'));
  const previous = (await getSources())[0];
  chrome.declarativeNetRequest.isRegexSupported = async () => ({ isSupported: false, reason: 'syntaxError' });
  const invalid = file({ version: '2', enabled: false, pairs: [{ id: 'file', urlPattern: '(?=file)', urlOperator: 'Regex' }] });
  globalThis.fetch = async () => new Response(JSON.stringify([invalid]), { headers: { ETag: '"invalid"' } });
  const failed = await syncSource(source.id);
  assert.match(failed.source.lastError, /Unsupported file URL expression/);
  assert.deepEqual(failed.source.rules, previous.rules);
  assert.deepEqual(failed.source.enabledOverrides, previous.enabledOverrides);
  assert.equal(failed.source.etag, previous.etag);
  assert.equal(failed.source.lastSyncedAt, previous.lastSyncedAt);
});

test('timeout while queued DNR validation prevents snapshot/validator acceptance and still records the error', async t => {
  const source = await subscribe([file()]);
  const previous = (await getSources())[0];
  let timeout, release;
  const native = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 15000) { timeout = callback; return native(() => {}, 30000); }
    return native(callback, delay, ...args);
  });
  chrome.declarativeNetRequest.isRegexSupported = async () => new Promise(resolve => { release = () => resolve({ isSupported: true }); });
  globalThis.fetch = async () => new Response(JSON.stringify([file({ version: '2' })]), { headers: { ETag: '"late"' } });
  const syncing = syncSource(source.id);
  await until(() => release);
  timeout();
  release();
  const failed = await syncing;
  assert.match(failed.source.lastError, /timed out/);
  assert.deepEqual(failed.source.rules, previous.rules);
  assert.equal(failed.source.etag, previous.etag);
});

test('unsubscribe during a download deletes preferences and cannot resurrect a remotely toggled rule', async () => {
  const source = await subscribe();
  const id = remoteRuleId(source.id, 'account');
  await toggleRule(id);
  let finish;
  globalThis.fetch = async () => new Promise(resolve => { finish = resolve; });
  const syncing = syncSource(source.id);
  await until(() => finish);
  await deleteSource(source.id);
  finish(new Response(JSON.stringify([rule({ version: '2' })])));
  assert.equal(await syncing, null);
  await assert.rejects(toggleRule(id), /not found/);
  assert.deepEqual(await getSources(), []);
});

test('remote activation publication updates interception/activity; content remains protected', async () => {
  const source = await subscribe([rule({ id: 'published' })]);
  const id = remoteRuleId(source.id, 'published');
  fixture.frames.set(1, [{ frameId: 0, parentFrameId: -1, documentId: 'page', documentLifecycle: 'active' }]);
  const snapshot = await pageExecution(1);
  const sender = { id: chrome.runtime.id, tab: { id: 1 }, frameId: 0, documentId: 'page' };
  assert.equal((await recordApplied({ ruleId: id, pairId: 'account-pair', activity: snapshot.activity }, sender)).ok, true);
  assert.deepEqual((await tabActivity(1)).appliedRuleIds, [id]);
  assert.equal((await handleMessage({ type: 'TOGGLE_RULE', id }, extensionSender)).enabled, false);
  assert.equal((await getApiRules()).some(rule => rule.ruleId === id), false);
  assert.equal(isExecutionSnapshotCurrent(snapshot), false);
  assert.deepEqual((await tabActivity(1)).appliedRuleIds, []);
  assert.equal((await handleMessage({ type: 'TOGGLE_RULE', id }, extensionSender)).enabled, true);
  assert.equal((await getApiRules()).some(rule => rule.ruleId === id), true);
  assert.deepEqual((await tabActivity(1)).appliedRuleIds, []);
  assert.equal((await getSources())[0].rules[0].enabled, true);
});

test('DNR publication failure exposes the saved activation and error instead of implying storage rollback', async () => {
  const source = await subscribe([file({ enabled: false })]);
  const id = remoteRuleId(source.id, 'account');
  chrome.declarativeNetRequest.updateDynamicRules = async () => { throw new Error('DNR publication failed'); };
  await assert.rejects(handleMessage({ type: 'TOGGLE_RULE', id }, extensionSender), /DNR publication failed/);
  assert.equal((await effective(source)).enabled, true);
  assert.equal((await getSources())[0].rules[0].enabled, false);
  assert.match(fixture.data.sfvi_apply_error, /DNR publication failed/);
});
