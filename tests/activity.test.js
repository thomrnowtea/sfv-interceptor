import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installChrome, rule, extensionSender } from './helpers/chrome.js';
import { saveRule } from '../sw/core/rules.js';
import { isExecutionSnapshotCurrent, pageExecution, recordApplied, tabActivity, commitPage, executionRules, initActivity, invalidateExecutionSnapshot } from '../sw/core/activity.js';
import { handleMessage, getApiRules, publishRulesChanged } from '../sw/handlers/messaging.js';

let fixture;
const sender = (tabId = 1, documentId = 'page-a', frameId = 0) => ({ id: chrome.runtime.id, tab: { id: tabId }, documentId, frameId });
const report = (activity, ruleId = 'account', pairId = 'account-pair') => ({ ruleId, pairId, activity });
function frames(tabId, documentId, children = []) {
  fixture.frames.set(tabId, [{ frameId: 0, parentFrameId: -1, documentId, documentLifecycle: 'active' }, ...children]);
}
beforeEach(() => {
  invalidateExecutionSnapshot();
  fixture = installChrome({ sfvi_rules: [rule(), rule({ id: 'other' })] });
  frames(1, 'page-a'); frames(2, 'page-b');
});

test('fast concurrent successes form a per-tab union; duplicates are idempotent', async () => {
  const { activity } = await pageExecution(1);
  const results = await Promise.all([
    recordApplied(report(activity), sender()), recordApplied(report(activity, 'other'), sender()), recordApplied(report(activity), sender()),
  ]);
  assert.ok(results.every(result => result.ok));
  assert.deepEqual((await tabActivity(1)).appliedRuleIds, ['account', 'other']);
  assert.deepEqual((await tabActivity(2)).appliedRuleIds, []);
  assert.ok(fixture.icons.some(icon => icon.tabId === 1 && icon.path[16].endsWith('16g.png')));
});

test('document_start binds its browser document before getAllFrames lists it', async () => {
  fixture.frames.delete(1);
  const early = await pageExecution(1, 0, 'document-start');
  assert.equal(early.frameDocumentId, 'document-start');
  assert.equal(early.activity.documentId, 'document-start');

  frames(1, 'document-start');
  await commitPage({ tabId: 1, frameId: 0, documentId: 'document-start', timeStamp: 1 });
  const committed = await pageExecution(1, 0, 'document-start');
  assert.equal(committed.activity.cycleId, early.activity.cycleId);
});

test('document_start injects the page hook before waiting on activity storage', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const readSession = chrome.storage.session.get;
  chrome.storage.session.get = async (...args) => { await gate; return readSession(...args); };

  const pending = handleMessage({ type: 'GET_API_RULES' }, sender(1, 'hook-handshake'));
  assert.equal(fixture.scriptInjections.length, 1);
  assert.deepEqual(fixture.scriptInjections[0].files, ['page-hook.js']);

  release();
  await pending;
});

test('session state survives a fresh worker module and unchanged publication', async () => {
  const { activity } = await pageExecution(1);
  await recordApplied(report(activity), sender());
  await publishRulesChanged();
  const fresh = await import('../sw/core/activity.js?wakeup=' + crypto.randomUUID());
  assert.deepEqual((await fresh.tabActivity(1)).appliedRuleIds, ['account']);
  assert.equal((await fresh.executionRules()).configRevision, activity.configRevision);
});

test('reload and BFCache activation clear the union and reject old completions', async () => {
  const first = await pageExecution(1);
  await commitPage({ tabId: 1, frameId: 0, documentId: 'page-a', timeStamp: 1 });
  await recordApplied(report(first.activity), sender());
  frames(1, 'page-reload');
  await commitPage({ tabId: 1, frameId: 0, documentId: 'page-reload', timeStamp: 2 });
  assert.deepEqual((await tabActivity(1)).appliedRuleIds, []);
  assert.equal((await recordApplied(report(first.activity), sender())).ok, false);
  const reload = await pageExecution(1);
  await recordApplied(report(reload.activity), sender(1, 'page-reload'));
  frames(1, 'page-a');
  await commitPage({ tabId: 1, frameId: 0, documentId: 'page-a', timeStamp: 3 });
  assert.notEqual((await tabActivity(1)).activity.cycleId, first.activity.cycleId);
  assert.deepEqual((await tabActivity(1)).appliedRuleIds, []);
  assert.equal((await recordApplied(report(first.activity), sender())).ok, false);
});

test('same-document and aborted navigation retain state; duplicate commit is harmless', async () => {
  await commitPage({ tabId: 1, frameId: 0, documentId: 'page-a', timeStamp: 1 });
  const { activity } = await pageExecution(1);
  await recordApplied(report(activity), sender());
  initActivity();
  chrome.tabs.onUpdated.emit(1, { status: 'loading' });
  chrome.webNavigation.onBeforeNavigate.emit({ tabId: 1, frameId: 0, url: 'https://cancelled.test/' });
  await commitPage({ tabId: 1, frameId: 0, documentId: 'page-a', timeStamp: 1 });
  assert.deepEqual((await pageExecution(1)).activity, activity);
  assert.deepEqual((await tabActivity(1)).appliedRuleIds, ['account']);
});

test('active iframe successes contribute; replaced or orphan frames are rejected', async () => {
  frames(1, 'page-a', [{ frameId: 3, parentFrameId: 0, documentId: 'child-a' }]);
  const { activity } = await pageExecution(1, 3, 'child-a');
  assert.equal((await recordApplied(report(activity), sender(1, 'child-a', 3))).ok, true);
  frames(1, 'page-a', [{ frameId: 3, parentFrameId: 0, documentId: 'child-b' }]);
  await commitPage({ tabId: 1, frameId: 3, documentId: 'child-b', timeStamp: 2 });
  assert.deepEqual((await tabActivity(1)).appliedRuleIds, ['account']);
  assert.equal((await recordApplied(report(activity, 'other'), sender(1, 'child-a', 3))).ok, false);
  frames(1, 'page-a', [{ frameId: 3, parentFrameId: 9, documentId: 'orphan' }]);
  assert.equal((await recordApplied(report(activity, 'other'), sender(1, 'orphan', 3))).ok, false);
});

test('configuration changes clear state before publication and reject stale descriptors', async () => {
  const { activity } = await pageExecution(1);
  const snapshot = await pageExecution(1);
  await recordApplied(report(activity), sender());
  await saveRule(rule({ version: '2.0.0' }));
  const changed = await executionRules();
  assert.notEqual(changed.configRevision, activity.configRevision);
  assert.equal(isExecutionSnapshotCurrent(snapshot), false);
  assert.deepEqual((await tabActivity(1)).appliedRuleIds, []);
  assert.equal((await recordApplied(report(activity), sender())).ok, false);
  assert.ok(fixture.icons.at(-1).path[16].endsWith('16.png'));
});

test('parent/pair identities containing delimiters and remote namespaces remain exact', async () => {
  fixture.data.sfvi_rules = [rule({ id: 'parent|part', pairs: [{ id: 'pair|part', urlPattern: '/api' }] })];
  fixture.data.sfvi_sources = [{ id: 'team', name: 'Team', rules: [rule({ id: 'published|id' })] }];
  const snapshot = await pageExecution(1);
  const apis = await getApiRules(snapshot);
  assert.equal(apis[0].ruleId, 'parent|part'); assert.equal(apis[0].pairId, 'pair|part');
  await recordApplied(report(snapshot.activity, apis[0].ruleId, apis[0].pairId), sender());
  await recordApplied(report(snapshot.activity, apis[1].ruleId, apis[1].pairId), sender());
  assert.deepEqual((await tabActivity(1)).appliedRuleIds, apis.map(api => api.ruleId));
  assert.equal((await recordApplied(report(snapshot.activity, 'parent', 'part|pair|part'), sender())).ok, false);
});

test('activity reads are private and lifecycle cleanup forgets removed/replaced tabs', async () => {
  await assert.rejects(handleMessage({ type: 'GET_TAB_ACTIVITY', tabId: 1 }, sender()), /unauthorized/);
  assert.deepEqual((await handleMessage({ type: 'GET_TAB_ACTIVITY', tabId: 1 }, extensionSender)).appliedRuleIds, []);
  initActivity();
  await pageExecution(2);
  await Promise.all(chrome.tabs.onRemoved.emit(1));
  await executionRules();
  assert.equal(fixture.sessionData.sfvi_activity.tabs[1], undefined);
  await Promise.all(chrome.tabs.onReplaced.emit(3, 2));
  await executionRules();
  assert.equal(fixture.sessionData.sfvi_activity.tabs[2], undefined);
});
