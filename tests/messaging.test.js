import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installChrome, extensionSender, rule } from './helpers/chrome.js';
import { handleMessage, initMessaging, getApiRules } from '../sw/handlers/messaging.js';
import { rebuildDNR } from '../sw/handlers/dnr.js';

let fixture;
beforeEach(() => { fixture = installChrome({ sfvi_rules: [rule()] }); });

test('content scripts cannot read private source metadata or invoke source mutations', async () => {
  const sender = { id: 'test-extension', url: 'https://page.test/', tab: { id: 1 } };
  for (const type of ['GET_RULES', 'GET_SOURCES', 'ADD_SOURCE', 'UPDATE_SOURCE', 'DELETE_SOURCE', 'SYNC_SOURCE', 'SAVE_RULE', 'TOGGLE_RULE']) {
    await assert.rejects(handleMessage({ type }, sender), /unauthorized/);
  }
  assert.equal((await handleMessage({ type: 'GET_API_RULES' }, sender)).rules.length, 1);
  await assert.rejects(handleMessage({ type: 'GET_SOURCES' }, { id: 'other', url: extensionSender.url }), /unauthorized/);
});

test('document_start API handshake targets its sender document without waiting for frame enumeration', async () => {
  fixture.frames.delete(1);
  const response = await handleMessage({ type: 'GET_API_RULES' }, {
    id: 'test-extension', url: 'https://page.test/', tab: { id: 1 }, frameId: 0, documentId: 'early-page',
  });
  assert.equal(response.rules.length, 1);
  assert.equal(response.activity.documentId, 'early-page');
  assert.deepEqual(fixture.scriptInjections[0].target, { tabId: 1, documentIds: ['early-page'] });
  assert.equal(fixture.scriptInjections[0].injectImmediately, true);
});

test('mutations return explicit errors through the runtime listener', async () => {
  initMessaging();
  const response = new Promise(resolve => fixture.runtimeMessages.emit({ type: 'TOGGLE_RULE', id: 'remote:source:account' }, extensionSender, resolve));
  assert.match((await response).error, /Remote rule not found/);
  await assert.rejects(handleMessage({ type: '__proto__' }, extensionSender), /Unknown message/);
});

test('REST interception prioritizes local rules ahead of remote rules with matching patterns', async () => {
  fixture.data.sfvi_sources = [{ id: 'one', name: 'Team', url: 'https://team.test/rules.json', rules: [rule({ response: { type: 'static', body: 'remote' } })] }];
  const rules = await getApiRules();
  assert.equal(rules[0].responseBody, '{"account":"local"}');
  assert.equal(rules[1].responseBody, 'remote');
});

test('API descriptors retain each URL pattern case-sensitivity setting', async () => {
  fixture.data.sfvi_rules = [rule({ pairs: [
    { id: 'sensitive', urlPattern: '/api/Mixed', caseSensitive: true },
    { id: 'insensitive', urlPattern: '/api/Mixed', caseSensitive: false },
  ] })];
  assert.deepEqual((await getApiRules()).map(item => item.caseSensitive), [true, false]);
});

test('file-patching DNR IDs are positive and stable for local and namespaced remote IDs', async () => {
  fixture.data.sfvi_rules = Array.from({ length: 100 }, (_, index) => rule({ id: `file-${index}`, resourceType: 'html', resourceSubtype: 'js' }));
  fixture.data.sfvi_sources = [{ id: 'one', name: 'Team', url: 'https://team.test/rules.json', rules: [rule({ resourceType: 'html', resourceSubtype: 'css' })] }];
  await rebuildDNR();
  const ids = fixture.dynamicRules.map(item => item.id);
  assert.equal(ids.length, 101);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => Number.isInteger(id) && id > 0 && id <= 2147483647));
  await rebuildDNR();
  assert.deepEqual(fixture.dynamicRules.map(item => item.id), ids);
});
