import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installChrome, rule, jsonFetch, until } from './helpers/chrome.js';
import { getRules, saveRule, saveRules, mergeRules, deleteRule, toggleRule } from '../sw/core/rules.js';
import { addSource, updateSource, deleteSource, syncSource, getSources, restoreSourceAlarms, initSourceSync, SOURCE_ALARM_PREFIX } from '../sw/core/sources.js';

let fixture;
beforeEach(() => { fixture = installChrome({ sfvi_rules: [rule()] }); });
const config = (overrides = {}) => ({ name: 'Team', url: 'https://team.test/rules.json', intervalMinutes: 15, ...overrides });

test('sync isolates same-ID remote rules from locals and multiple sources', async () => {
  const original = structuredClone(fixture.data.sfvi_rules);
  jsonFetch([rule({ name: 'Remote', version: '2.0.0' })]);
  const a = await addSource(config());
  const b = await addSource(config({ url: 'https://other.test/rules.json' }));
  await Promise.all([syncSource(a.id), syncSource(b.id)]);
  const rules = await getRules();
  assert.equal(rules.length, 3);
  assert.equal(rules[0].id, 'account');
  assert.equal(new Set(rules.map(item => item.id)).size, 3);
  assert.deepEqual(fixture.data.sfvi_rules, original);
  assert.equal(rules.filter(item => item.readOnly).length, 2);
});

test('every snapshot reflects additions, modifications, deletions, and lower source versions', async () => {
  const source = await addSource(config());
  jsonFetch([rule({ version: '5.0.0' }), rule({ id: 'removed' })]);
  await syncSource(source.id);
  jsonFetch({ rules: [rule({ version: '2.0.0', enabled: false, response: { type: 'static', body: 'changed' } }), rule({ id: 'added' })] });
  await syncSource(source.id);
  const remote = (await getRules()).filter(item => item.readOnly);
  assert.deepEqual(remote.map(item => item.sourceRuleId), ['account', 'added']);
  assert.equal(remote[0].version, '2.0.0');
  assert.equal(remote[0].enabled, false);
  assert.equal(remote[0].response.body, 'changed');
  jsonFetch([]);
  await syncSource(source.id);
  assert.equal((await getRules()).length, 1);
});

test('HTTP, invalid JSON, and invalid schema preserve the last valid snapshot', async () => {
  const source = await addSource(config());
  jsonFetch([rule({ version: '3.1' })]);
  await syncSource(source.id);
  const previous = (await getSources())[0];
  for (const failedFetch of [
    async () => new Response('Unavailable', { status: 503 }),
    async () => new Response('{'),
    async () => new Response(JSON.stringify([{ id: 'broken', version: 'invalid' }])),
  ]) {
    globalThis.fetch = failedFetch;
    const result = await syncSource(source.id);
    assert.ok(result.source.lastError);
    assert.deepEqual(result.source.rules, previous.rules);
    assert.equal(result.source.lastSyncedAt, previous.lastSyncedAt);
    assert.ok(result.source.lastCheckedAt >= previous.lastCheckedAt);
  }
  jsonFetch([rule({ version: '4' })]);
  const recovered = await syncSource(source.id);
  assert.equal(recovered.source.lastError, '');
  assert.equal(recovered.source.rules[0].version, '4');
});

test('remote content remains read-only while local activation is editable', async () => {
  const source = await addSource(config());
  jsonFetch([rule()]);
  await syncSource(source.id);
  const remote = (await getRules()).find(item => item.readOnly);
  assert.throws(() => saveRule({ ...remote, readOnly: false }), /read-only/);
  assert.throws(() => deleteRule(remote.id), /read-only/);
  assert.equal((await toggleRule(remote.id)).enabled, false);
  assert.equal((await getRules()).find(item => item.id === remote.id).enabled, false);
  assert.equal((await getSources())[0].rules[0].enabled, true);
  assert.deepEqual(fixture.data.sfvi_rules, [rule()]);
});

test('ordinary imports, full local replacement, and local version editing retain source snapshots', async () => {
  const source = await addSource(config());
  jsonFetch([rule({ version: '9.0.0' })]);
  await syncSource(source.id);
  await saveRule(rule({ version: '1.2.3' }));
  await mergeRules([rule({ version: '2.0.0' })], 'overwrite');
  assert.equal((await getRules())[0].version, '2.0.0');
  assert.equal((await getRules()).find(item => item.readOnly).version, '9.0.0');
  await saveRules([]);
  assert.equal((await getRules()).length, 1);
  assert.equal((await getRules())[0].readOnly, true);
});

test('concurrent local saves and source syncs do not lose other mutations', async () => {
  const a = await addSource(config());
  const b = await addSource(config({ url: 'https://other.test/rules.json' }));
  jsonFetch([rule({ version: '2' })]);
  await Promise.all([saveRule(rule({ id: 'new-a' })), saveRule(rule({ id: 'new-b' })), syncSource(a.id), syncSource(b.id)]);
  assert.equal(fixture.data.sfvi_rules.length, 3);
  assert.equal((await getRules()).length, 5);
});

test('overlapping sync requests reuse a single download', async () => {
  const source = await addSource(config());
  let finish;
  let downloads = 0;
  globalThis.fetch = async () => { downloads++; return new Promise(resolve => { finish = resolve; }); };
  const one = syncSource(source.id);
  const two = syncSource(source.id);
  assert.equal(one, two);
  await until(() => finish);
  finish(new Response(JSON.stringify([rule()])));
  await Promise.all([one, two]);
  assert.equal(downloads, 1);
});

test('unsubscribing during a download cannot resurrect a source or its rules', async () => {
  const source = await addSource(config());
  let finish;
  globalThis.fetch = async () => new Promise(resolve => { finish = resolve; });
  const pending = syncSource(source.id);
  await until(() => finish);
  await deleteSource(source.id);
  finish(new Response(JSON.stringify([rule()])));
  assert.equal(await pending, null);
  assert.deepEqual(await getSources(), []);
  assert.equal((await getRules()).length, 1);
  assert.equal(fixture.alarms.size, 0);
});

test('source config validates URL/interval and rejects duplicate subscriptions atomically', async () => {
  for (const intervalMinutes of [0, -1, 1.5, 10081, 'bad']) await assert.rejects(addSource(config({ intervalMinutes })), /interval/);
  await assert.rejects(addSource(config({ url: 'http://team.test' })), /HTTPS/);
  await Promise.allSettled([addSource(config()), addSource(config())]);
  assert.equal((await getSources()).length, 1);
  const source = (await getSources())[0];
  await updateSource({ id: source.id, name: 'Renamed', intervalMinutes: 5 });
  assert.equal((await getSources())[0].name, 'Renamed');
  assert.equal(fixture.alarms.get(SOURCE_ALARM_PREFIX + source.id).periodInMinutes, 5);
});

test('startup restores missing alarms, corrects intervals, and clears only orphan source alarms', async () => {
  const source = await addSource(config());
  fixture.alarms.clear();
  fixture.alarms.set('unrelated', { name: 'unrelated', periodInMinutes: 3 });
  fixture.alarms.set(SOURCE_ALARM_PREFIX + 'gone', { name: SOURCE_ALARM_PREFIX + 'gone' });
  await restoreSourceAlarms();
  assert.equal(fixture.alarms.get(SOURCE_ALARM_PREFIX + source.id).periodInMinutes, 15);
  assert.equal(fixture.alarms.has(SOURCE_ALARM_PREFIX + 'gone'), false);
  assert.equal(fixture.alarms.has('unrelated'), true);
});

test('alarm listener synchronizes without an open dashboard', async () => {
  const source = await addSource(config());
  jsonFetch([rule({ version: '2' })]);
  await syncSource(source.id);
  let notifications = 0;
  initSourceSync(async () => { notifications++; });
  jsonFetch([rule({ version: '3' })]);
  fixture.alarmEvent.emit({ name: SOURCE_ALARM_PREFIX + source.id });
  await until(() => notifications === 1);
  assert.equal((await getSources())[0].rules[0].version, '3');
});
