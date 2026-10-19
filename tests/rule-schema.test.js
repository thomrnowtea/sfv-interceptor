import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateRule, normalizeVersion, materializeSourceRules, portableRule } from '../shared/rule-schema.js';
import { parseRuleDocument, fetchRuleDocument, validateSourceUrl } from '../shared/rule-document.js';
import { rule } from './helpers/chrome.js';

test('legacy local rules gain a version without losing old per-pair response fields', () => {
  const migrated = migrateRule({ id: 'legacy', pairs: [{ urlPattern: '/legacy', responseBody: 'old body', statusCode: 201, delay: 25 }] });
  assert.equal(migrated.version, '1.0.0');
  assert.equal(migrated.response.body, 'old body');
  assert.equal(migrated.response.statusCode, '201');
  assert.equal(migrated.response.delay, 25);
});

test('versions accept numeric and dotted values and reject malformed versions', () => {
  for (const value of [1, '1', '1.2', '1.2.3', '0.0.1']) assert.equal(normalizeVersion(value), String(value));
  for (const value of ['', '-1', 'latest', '1.2.3.4', '1e2', NaN, {}, []]) assert.throws(() => normalizeVersion(value), /Version/);
});

test('JSON documents accept array and rules envelope, including empty snapshots', () => {
  assert.deepEqual(parseRuleDocument([rule()]), parseRuleDocument({ rules: [rule()] }));
  assert.deepEqual(parseRuleDocument([]), []);
  assert.deepEqual(parseRuleDocument({ rules: [] }, { requireIds: true }), []);
  assert.throws(() => parseRuleDocument({}), /JSON array/);
});

test('new local rules may have a null ID, while subscriptions require stable publisher IDs', () => {
  assert.equal(parseRuleDocument([rule({ id: null })])[0].id, null);
  for (const id of [undefined, null, '', ' ', 12]) assert.throws(() => parseRuleDocument([rule({ id })], { requireIds: true }), /stable id/);
});

test('a malformed rule rejects the complete document instead of partially syncing', () => {
  for (const invalid of [null, 'invalid', { id: 'other', pairs: {} }, rule({ version: 'broken' }), rule({ request: { body: {} } })]) {
    assert.throws(() => parseRuleDocument([rule(), invalid], { requireIds: true }));
  }
  assert.throws(() => parseRuleDocument([rule(), rule()]), /Duplicate rule IDs/);
  assert.throws(() => parseRuleDocument([rule({ pairs: [{ id: 'same' }, { id: 'same' }] })]), /Duplicate pair IDs/);
  assert.throws(() => parseRuleDocument([rule({ pairs: [{ urlOperator: 'Regex', urlPattern: '[' }] })]), SyntaxError);
});

test('source identities are namespaced across local rules and independent sources', () => {
  const input = rule({ id: 'shared:/path?x=1' });
  const a = materializeSourceRules({ id: 'one', name: 'One', url: 'https://one.test/rules.json', rules: [input] })[0];
  const b = materializeSourceRules({ id: 'two', name: 'Two', url: 'https://two.test/rules.json', rules: [input] })[0];
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, input.id);
  assert.equal(a.sourceRuleId, input.id);
  assert.equal(a.readOnly, true);
  assert.equal(a.version, input.version);
  assert.equal(portableRule(a).id, 'copy:' + a.id);
  assert.equal(portableRule(a).readOnly, undefined);
});

test('Requestly imports preserve their published version', () => {
  const parsed = parseRuleDocument([{ id: 'rq', version: 7, ruleType: 'Response', pairs: [{ source: { value: '/api', operator: 'Contains' }, response: { type: 'static', value: 'body' } }] }]);
  assert.equal(parsed[0].version, '7');
  assert.equal(parsed[0].response.body, 'body');
});

test('legacy request bodies and rule-level headers survive migration and export', () => {
  const modifier = 'function modifyRequest(args) { return args.requestJSON; }';
  for (const [pair, expected] of [
    [{ requestModifier: modifier }, { type: 'dynamic', body: modifier }],
    [{ requestBodyType: 'dynamic', requestBody: modifier }, { type: 'dynamic', body: modifier }],
    [{ requestBody: '{"legacy":true}' }, { type: 'static', body: '{"legacy":true}' }],
  ]) {
    const input = { id: 'legacy-request', requestCustomHeaders: '{"X-Request":"legacy"}', customHeaders: '{"X-Response":"legacy"}', pairs: [{ urlPattern: '/api/legacy', ...pair }] };
    const migrated = migrateRule(input);
    assert.deepEqual(migrated.request, { ...expected, customHeaders: input.requestCustomHeaders });
    assert.equal(migrated.response.customHeaders, input.customHeaders);
    assert.deepEqual(parseRuleDocument([portableRule(migrated)])[0], {
      ...migrated, pairs: [{ ...migrated.pairs[0], id: 'pair_1' }],
    });
  }
});

test('Requestly subscriptions without pair IDs keep stable identities across parses', () => {
  const input = [{ id: 'rq-stable', ruleType: 'Response', pairs: [
    { source: { value: '/api/*', operator: 'Wildcard_Matches', filters: [{ requestMethod: ['POST'] }] }, response: { value: 'body' } },
    { source: { value: '/other', operator: 'Contains' }, response: { value: 'body' } },
  ] }];
  const first = parseRuleDocument(input, { requireIds: true });
  assert.deepEqual(parseRuleDocument(input, { requireIds: true }), first);
  assert.deepEqual(first[0].pairs.map(pair => pair.id), ['pair_1', 'pair_2']);
  assert.equal(first[0].pairs[0].urlOperator, 'Wildcard');
  assert.equal(first[0].pairs[0].method, 'POST');
});

test('source URLs require HTTPS and downloads bypass cache without credentials', async () => {
  assert.equal(validateSourceUrl('https://example.test/rules.json#fragment'), 'https://example.test/rules.json');
  for (const url of ['http://example.test', 'file:///rules.json', 'https://user:password@example.test']) assert.throws(() => validateSourceUrl(url));
  let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; return new Response(JSON.stringify([rule()])); };
  const parsed = await fetchRuleDocument('https://example.test/rules.json', { requireIds: true });
  assert.equal(parsed[0].id, 'account');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.credentials, 'omit');
});
