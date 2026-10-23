import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installChrome, rule, until } from './helpers/chrome.js';
import { executionRules, pageExecution, recordApplied, tabActivity, initActivity,
  invalidateExecutionSnapshot, isExecutionSnapshotCurrent } from '../sw/core/activity.js';
import { saveRule, saveRules, toggleRule } from '../sw/core/rules.js';
import { updateList, SOURCES_KEY } from '../sw/core/storage.js';
import { remoteRuleId } from '../shared/rule-schema.js';

let fixture;
beforeEach(() => {
  fixture = installChrome({ sfvi_rules: [rule()], sfvi_sources: [] });
  fixture.frames.set(1, [{ frameId: 0, parentFrameId: -1, documentId: 'cache-document' }]);
  invalidateExecutionSnapshot();
});
const sender = () => ({ id: chrome.runtime.id, tab: { id: 1 }, frameId: 0, documentId: 'cache-document' });
const notice = snapshot => ({ ruleId: 'account', pairId: 'account-pair', activity: snapshot.activity });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('unchanged notices reuse reads and hash without skipping validation or mutating shared rules', async context => {
  let reads = 0, hashes = 0;
  const read = chrome.storage.local.get.bind(chrome.storage.local);
  chrome.storage.local.get = (...args) => { reads++; return read(...args); };
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  context.mock.method(crypto.subtle, 'digest', (...args) => { hashes++; return digest(...args); });
  const snapshot = await pageExecution(1);
  assert.equal(reads, 2); assert.equal(hashes, 1);
  assert.throws(() => { snapshot.rules[0].response.body = 'corrupted'; }, TypeError);
  const results = await Promise.all(Array.from({ length: 30 }, () => recordApplied(notice(snapshot), sender())));
  assert.ok(results.every(item => item.ok));
  assert.equal(reads, 2); assert.equal(hashes, 1);
  assert.deepEqual((await tabActivity(1)).appliedRuleIds, ['account']);
  assert.equal((await recordApplied(notice(snapshot), { ...sender(), documentId: 'obsolete' })).ok, false);
});

test('body changes at the same version, lower versions, and order changes start fresh configurations', async () => {
  const first = await pageExecution(1);
  await recordApplied(notice(first), sender());
  await saveRule(rule({ response: { ...rule().response, body: 'different at same version' } }));
  const changed = await executionRules();
  assert.notEqual(changed.configRevision, first.configRevision);
  assert.equal(isExecutionSnapshotCurrent(first), false);
  assert.equal((await recordApplied(notice(first), sender())).ok, false);
  assert.deepEqual((await tabActivity(1)).appliedRuleIds, []);
  await saveRule(rule({ version: '0.9.0' }));
  const lower = await executionRules();
  assert.equal(lower.rules[0].version, '0.9.0');
  assert.notEqual(lower.configRevision, changed.configRevision);
  await saveRules([rule({ id: 'second' }), rule()]);
  const ordered = await executionRules();
  await saveRules([rule(), rule({ id: 'second' })]);
  const reordered = await executionRules();
  assert.notEqual(ordered.configRevision, reordered.configRevision);
  assert.deepEqual(reordered.rules.map(item => item.id), ['account', 'second']);
});

test('unchanged writes and a fresh worker preserve the persisted fingerprint and activity union', async () => {
  const first = await pageExecution(1);
  await recordApplied(notice(first), sender());
  await saveRule(rule());
  assert.equal((await executionRules()).configRevision, first.configRevision);
  const fresh = await import('../sw/core/activity.js?cache-wakeup=' + crypto.randomUUID());
  assert.deepEqual((await fresh.tabActivity(1)).appliedRuleIds, ['account']);
  assert.equal((await fresh.executionRules()).configRevision, first.configRevision);
});

test('a hash from before a completed write cannot populate the cache when onChanged is withheld', async context => {
  const gate = deferred(); let entered = false;
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  context.mock.method(crypto.subtle, 'digest', async (...args) => {
    if (!entered) { entered = true; await gate.promise; }
    return digest(...args);
  });
  const pending = executionRules();
  await until(() => entered);
  await saveRule(rule({ response: { ...rule().response, body: 'newest' } }));
  gate.resolve();
  const result = await pending;
  assert.equal(result.rules[0].response.body, 'newest');
  assert.equal(isExecutionSnapshotCurrent(result), true);
  assert.strictEqual((await executionRules()).rules, result.rules);
});

test('a write completing after an overlapping read invalidates that snapshot without an event', async () => {
  await executionRules();
  const gate = deferred(); let entered = false;
  const set = chrome.storage.local.set.bind(chrome.storage.local);
  chrome.storage.local.set = async values => { entered = true; await gate.promise; return set(values); };
  const saving = saveRule(rule({ version: '2' }));
  await until(() => entered);
  const during = await executionRules();
  assert.equal(during.rules[0].version, '1.0.0');
  gate.resolve(); await saving;
  assert.equal(isExecutionSnapshotCurrent(during), false);
  assert.equal((await executionRules()).rules[0].version, '2');
});

test('overlapping source and local commits never cache a partially read old configuration', async () => {
  const read = chrome.storage.local.get.bind(chrome.storage.local);
  const gate = deferred(); let held = false;
  chrome.storage.local.get = async key => {
    const value = await read(key);
    if (key === SOURCES_KEY && !held) { held = true; await gate.promise; }
    return value;
  };
  const pending = executionRules();
  await until(() => held);
  await Promise.all([
    saveRule(rule({ version: '2' })),
    updateList(SOURCES_KEY, () => ({ items: [{ id: 'team', name: 'Team', rules: [rule({ version: '3' })] }] })),
  ]);
  gate.resolve();
  const snapshot = await pending;
  assert.deepEqual(snapshot.rules.map(item => item.version), ['2', '3']);
  assert.equal(snapshot.rules[1].id, remoteRuleId('team', 'account'));
});

test('remote activation invalidates effective rules while preserving publisher content', async () => {
  await updateList(SOURCES_KEY, () => ({ items: [{ id: 'team', name: 'Team', rules: [rule()] }] }));
  const before = await executionRules();
  const published = structuredClone(fixture.data.sfvi_sources[0].rules);
  await toggleRule(remoteRuleId('team', 'account'));
  const after = await executionRules();
  assert.equal(isExecutionSnapshotCurrent(before), false);
  assert.equal(after.rules[1].enabled, false);
  assert.equal(after.rules[0].enabled, true);
  assert.deepEqual(fixture.data.sfvi_sources[0].rules, published);
});

test('external onChanged invalidates rules but unrelated settings and session changes do not', async () => {
  initActivity();
  const before = await executionRules();
  chrome.storage.onChanged.emit({ sfvi_theme: { newValue: 'light' } }, 'local');
  chrome.storage.onChanged.emit({ sfvi_rules: {} }, 'session');
  assert.equal(isExecutionSnapshotCurrent(before), true);
  await chrome.storage.local.set({ sfvi_rules: [rule({ version: '4' })] });
  chrome.storage.onChanged.emit({ sfvi_rules: { newValue: fixture.data.sfvi_rules } }, 'local');
  assert.equal(isExecutionSnapshotCurrent(before), false);
  assert.equal((await executionRules()).rules[0].version, '4');
});

test('an async frame lookup returns its captured epoch rather than relabeling old rules', async () => {
  await executionRules();
  const gate = deferred(); let entered = false;
  const frames = chrome.webNavigation.getAllFrames;
  chrome.webNavigation.getAllFrames = async args => { entered = true; await gate.promise; return frames(args); };
  const pending = pageExecution(1);
  await until(() => entered);
  await saveRule(rule({ version: '5' }));
  gate.resolve();
  const obsolete = await pending;
  assert.equal(obsolete.rules[0].version, '1.0.0');
  assert.equal(isExecutionSnapshotCurrent(obsolete), false);
  assert.equal((await executionRules()).rules[0].version, '5');
});

test('failed writes and hash failures remain visible and do not poison subsequent transactions', async context => {
  const before = await executionRules();
  const set = chrome.storage.local.set;
  chrome.storage.local.set = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(saveRule(rule({ version: '9' })), /disk unavailable/);
  chrome.storage.local.set = set;
  assert.equal(isExecutionSnapshotCurrent(before), false);
  assert.equal((await executionRules()).rules[0].version, '1.0.0');
  invalidateExecutionSnapshot();
  const digest = crypto.subtle.digest.bind(crypto.subtle); let fail = true;
  context.mock.method(crypto.subtle, 'digest', (...args) => {
    if (fail) { fail = false; return Promise.reject(new Error('digest unavailable')); }
    return digest(...args);
  });
  await assert.rejects(executionRules(), /digest unavailable/);
  assert.equal((await executionRules()).rules[0].version, '1.0.0');
});

test('a rejected obsolete hash is retried after a committed change without poisoning the new cache', async context => {
  const gate = deferred(); let entered = false;
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  context.mock.method(crypto.subtle, 'digest', async (...args) => {
    if (!entered) { entered = true; await gate.promise; }
    return digest(...args);
  });
  const pending = executionRules();
  await until(() => entered);
  await saveRule(rule({ version: '6' }));
  gate.reject(new Error('obsolete computation failed'));
  const result = await pending;
  assert.equal(result.rules[0].version, '6');
  assert.strictEqual((await executionRules()).rules, result.rules);
});

test('writes overlapping session IPC are rechecked before binding configuration state', async () => {
  await executionRules();
  const read = chrome.storage.session.get;
  const gate = deferred(); let entered = false;
  chrome.storage.session.get = async key => {
    const value = await read(key);
    if (!entered) { entered = true; await gate.promise; }
    return value;
  };
  const pending = pageExecution(1, 0, 'cache-document');
  await until(() => entered);
  await saveRule(rule({ version: '7' }));
  gate.resolve();
  const snapshot = await pending;
  assert.equal(snapshot.rules[0].version, '7');
  assert.equal(isExecutionSnapshotCurrent(snapshot), true);
});
