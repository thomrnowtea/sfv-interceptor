import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installChrome, rule, extensionSender, jsonFetch, until } from './helpers/chrome.js';
import { addSource, updateSource, deleteSource, restoreSourceAlarms, syncSource, SOURCE_ALARM_PREFIX } from '../sw/core/sources.js';
import { getRules, saveRule, mergeRules } from '../sw/core/rules.js';
import { invalidateExecutionSnapshot } from '../sw/core/activity.js';
import { handleMessage, publishRulesChanged } from '../sw/handlers/messaging.js';
import { rebuildDNR } from '../sw/handlers/dnr.js';
import { selectAssetMatches } from '../sw/core/asset-matches.js';
import { fileRuleId } from '../sw/core/file-rules.js';

let fixture;
beforeEach(() => {
  invalidateExecutionSnapshot();
  fixture = installChrome({ sfvi_rules: [rule()] });
});
const config = (url = 'https://team.test/rules.json') => ({ name: 'Team', url, intervalMinutes: 15 });

test('combined exports round-trip with local and multiple sources sharing publisher IDs', async () => {
  jsonFetch([rule({ version: '3' })]);
  const a = await addSource(config());
  const b = await addSource(config('https://other.test/rules.json'));
  await Promise.all([syncSource(a.id), syncSource(b.id)]);
  const exported = (await handleMessage({ type: 'EXPORT_RULES' }, extensionSender)).rules;
  assert.equal(new Set(exported.map(item => item.id)).size, 3);
  assert.equal(exported.filter(item => item.readOnly).length, 0);
  const result = await mergeRules(exported);
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 1);
  assert.equal(fixture.data.sfvi_rules.length, 3);
  assert.equal((await getRules()).filter(item => item.readOnly).length, 2);
});

async function delayedRestore() {
  const getAll = chrome.alarms.getAll;
  let release;
  chrome.alarms.getAll = async () => {
    const snapshot = await getAll();
    return new Promise(resolve => { release = () => resolve(snapshot); });
  };
  const restoring = restoreSourceAlarms();
  await until(() => release);
  return { restoring, release, reset: () => { chrome.alarms.getAll = getAll; } };
}

test('concurrent startup restoration cannot undo a newly saved interval', async () => {
  const source = await addSource(config());
  const delayed = await delayedRestore();
  const updating = updateSource({ id: source.id, intervalMinutes: 5 });
  delayed.release();
  await Promise.all([delayed.restoring, updating]);
  delayed.reset();
  assert.equal(fixture.alarms.get(SOURCE_ALARM_PREFIX + source.id).periodInMinutes, 5);
});

test('concurrent startup restoration cannot clear a newly subscribed source alarm', async () => {
  const delayed = await delayedRestore();
  const adding = addSource(config());
  delayed.release();
  const [, source] = await Promise.all([delayed.restoring, adding]);
  delayed.reset();
  assert.equal(fixture.alarms.has(SOURCE_ALARM_PREFIX + source.id), true);
});

test('concurrent startup restoration cannot recreate an unsubscribed source alarm', async () => {
  const source = await addSource(config());
  fixture.alarms.clear();
  const delayed = await delayedRestore();
  const deleting = deleteSource(source.id);
  delayed.release();
  await Promise.all([delayed.restoring, deleting]);
  delayed.reset();
  assert.equal(fixture.alarms.has(SOURCE_ALARM_PREFIX + source.id), false);
  assert.deepEqual(fixture.data.sfvi_sources, []);
});

test('alarm failures remain visible and do not prevent restoration of other sources', async () => {
  const first = await addSource(config());
  const second = await addSource(config('https://other.test/rules.json'));
  fixture.alarms.clear();
  const create = chrome.alarms.create;
  chrome.alarms.create = async (name, settings) => {
    if (name.endsWith(first.id)) throw new Error('Alarm capacity exceeded');
    return create(name, settings);
  };
  await restoreSourceAlarms();
  assert.match(fixture.data.sfvi_sources[0].scheduleError, /capacity/);
  assert.equal(fixture.alarms.has(SOURCE_ALARM_PREFIX + second.id), true);
  chrome.alarms.create = create;
  await restoreSourceAlarms();
  assert.equal(fixture.data.sfvi_sources[0].scheduleError, '');
});

test('unsupported DNR expressions preserve the source snapshot and reject local saves', async () => {
  const source = await addSource(config());
  jsonFetch([rule()]);
  await syncSource(source.id);
  const previous = structuredClone(fixture.data.sfvi_sources[0].rules);
  chrome.declarativeNetRequest.isRegexSupported = async () => ({ isSupported: false, reason: 'syntaxError' });
  const invalid = rule({ resourceType: 'html', resourceSubtype: 'js', pairs: [{ id: 'lookahead', urlPattern: '(?=file)', urlOperator: 'Regex' }] });
  jsonFetch([invalid]);
  const result = await syncSource(source.id);
  assert.match(result.source.lastError, /Unsupported file URL expression/);
  assert.deepEqual(result.source.rules, previous);
  await assert.rejects(saveRule(invalid), /Unsupported file URL expression/);
  assert.deepEqual(fixture.data.sfvi_rules, [rule()]);
});

test('DNR failures are reported and do not keep blockers from an unsubscribed source', async () => {
  fixture.data.sfvi_rules = [rule({ resourceType: 'html', resourceSubtype: 'js' })];
  const source = await addSource(config());
  jsonFetch([rule({ resourceType: 'html', resourceSubtype: 'css' })]);
  await syncSource(source.id);
  await rebuildDNR();
  assert.equal(fixture.dynamicRules.length, 2);
  await deleteSource(source.id);
  const update = chrome.declarativeNetRequest.updateDynamicRules;
  let fail = true;
  chrome.declarativeNetRequest.updateDynamicRules = async options => {
    if (fail) { fail = false; throw new Error('Temporary DNR failure'); }
    return update(options);
  };
  await assert.rejects(publishRulesChanged(), /Temporary DNR failure/);
  assert.match(fixture.data.sfvi_apply_error, /Temporary DNR failure/);
  assert.equal(fixture.dynamicRules.length, 1);
  assert.ok(fixture.notifications.some(item => item.type === 'RULES_CHANGED'));
  await publishRulesChanged();
  assert.equal(fixture.data.sfvi_apply_error, '');
});

test('local file replacements take precedence; separate page injections still coexist', async () => {
  const local = await saveRule(rule({ resourceType: 'html', resourceSubtype: 'js', pairs: [{ id: 'bundle', urlPattern: 'bundle.js', urlOperator: 'Contains' }] }));
  const source = await addSource(config());
  jsonFetch([rule({ resourceType: 'html', resourceSubtype: 'js', pairs: [{ id: 'bundle', urlPattern: 'bundle.js', urlOperator: 'Contains' }] })]);
  await syncSource(source.id);
  await rebuildDNR();
  const url = 'https://app.test/bundle.js';
  const selected = selectAssetMatches(await getRules(), [url], 'https://app.test/', fixture.dynamicRules);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].ruleId, local.id);
  fixture.data.sfvi_rules = [];
  const remote = selectAssetMatches(await getRules(), [url], 'https://app.test/', fixture.dynamicRules);
  assert.equal(remote.length, 1);
  assert.ok(remote[0].ruleId.startsWith('remote:'));
});

test('unapplied or outdated file patterns do not run replacements on an unblocked asset', () => {
  const file = rule({ resourceType: 'html', resourceSubtype: 'js' });
  const urls = ['https://app.test/api/account.js'];
  assert.deepEqual(selectAssetMatches([file], urls, 'https://app.test/', []), []);
  const outdated = [{ id: fileRuleId(file.id, file.pairs[0].id), condition: { regexFilter: 'old.js', isUrlFilterCaseSensitive: false } }];
  assert.deepEqual(selectAssetMatches([file], urls, 'https://app.test/', outdated), []);
  const inject = rule({ resourceType: 'html', resourceSubtype: 'html', pairs: [{ id: 'page', urlPattern: 'app.test', urlOperator: 'Contains' }] });
  assert.equal(selectAssetMatches([inject, { ...inject, id: 'another' }], [], 'https://app.test/', []).length, 2);
});

test('a timed-out download retains the last successful snapshot', async context => {
  const source = await addSource(config());
  jsonFetch([rule({ version: '2' })]);
  await syncSource(source.id);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let started = false;
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    started = true;
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  const pending = syncSource(source.id);
  await until(() => started);
  context.mock.timers.tick(15000);
  const result = await pending;
  assert.match(result.source.lastError, /timed out/);
  assert.equal(result.source.rules[0].version, '2');
});
