import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parse } from 'acorn';
import { compactJSON, compactJavaScript, compactRuleCopy, serializeRules } from '../dashboard/editor/compact.js';
import { parseRuleDocument } from '../shared/rule-document.js';
import { materializeSourceRules } from '../shared/rule-schema.js';
import { rule } from './helpers/chrome.js';

test('JSON compaction is lossless for numeric spellings, duplicate keys, strings and plain text', () => {
  const source = '{\n "huge": 9007199254740993, "exponent": 1e400, "negative": -0, "same": 1, "same": 2, "text": " space \\n \\"quote\\" \\\\ ", "02": 2, "1": 1\n}';
  const expected = '{"huge":9007199254740993,"exponent":1e400,"negative":-0,"same":1,"same":2,"text":" space \\n \\"quote\\" \\\\ ","02":2,"1":1}';
  assert.equal(compactJSON(source), expected);
  for (const text of [' plain text\n ', '{broken', '', ' \n\t']) assert.equal(compactJSON(text), text);
});

test('JavaScript minification preserves names, ASI, directives, regexes and template cooked/raw text', async () => {
  const sources = [
    'function modifyResponse(args) {\n "use strict"; const number = 9 / 3; const re = /[{};\\/]/g; return {number, regex: re.source, name: modifyResponse.name, url: "https://site.test/a//b"};\n}',
    'function modifyResponse(args) {\n return\n { changed: true };\n}',
    'function modifyResponse(args) { let count = 2; args.number\n ++count; return count; }',
    'function modifyResponse(args) { return [String.raw`first\nsecond /*literal*/`, `value: ${args.number ?? "none"}`]; }',
    'async function modifyResponse(args) { const result = await Promise.resolve(args.number); return { result }; }',
  ];
  for (const source of sources) {
    const compact = await compactJavaScript(source);
    const execute = code => new Function(code + '\nreturn modifyResponse;')()({ number: 4 });
    assert.deepEqual(await execute(compact), await execute(source));
    assert.equal(await compactJavaScript(compact), compact);
    assert.ok(compact.includes('modifyResponse'));
  }
  assert.equal(await compactJavaScript('return 3;\n'), 'return 3;');
  assert.equal(await compactJavaScript('// Comment only\n'), '');
  await assert.rejects(compactJavaScript('function broken( {', 'Rule · response.body'), /Rule · response.body: invalid JavaScript at line/);
});

test('one-line exports compact dynamic and JSON bodies without mutating remote or legacy snapshots', async () => {
  const body = 'function modifyResponse(args) {\n // Comment\n const value = args.responseJSON;\n return { ...value, changed: true };\n}';
  const local = rule({ response: { type: 'dynamic', body, customHeaders: '{\n "X-Test": "yes"\n}' } });
  const source = { id: 'source_test', name: 'Test', url: 'https://feed.test/no-suffix', rules: [local] };
  const remote = materializeSourceRules(source)[0];
  const original = structuredClone([local, remote]);
  const output = await serializeRules([local, remote]);
  assert.equal(output.includes('\n'), false);
  const parsed = parseRuleDocument(JSON.parse(output));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].response.body.includes('\n'), false);
  assert.equal(parsed[0].response.body.includes('// Comment'), false);
  assert.equal(parsed[0].response.customHeaders, '{"X-Test":"yes"}');
  assert.equal(parsed[1].readOnly, undefined);
  assert.ok(parsed[1].id.startsWith('copy:remote:'));
  assert.deepEqual([local, remote], original);
  const multilineTemplate = rule({ response: { type: 'dynamic', body: 'function modifyResponse() { return String.raw`a\nb`; }' } });
  assert.equal((await serializeRules([multilineTemplate])).includes('\n'), false, 'JSON escapes required template newlines');
});

test('compaction keeps HTML/CSS and plain text intact; invalid JS rejects the whole export', async () => {
  const request = rule({ request: { type: 'dynamic', body: 'function modifyRequest(args) {\n return args.requestJSON;\n}', customHeaders: '{\n "X-Test": "ok"\n}' } });
  const compactRequest = await compactRuleCopy(request);
  assert.equal(compactRequest.request.body, 'function modifyRequest(args){return args.requestJSON}');
  assert.equal(compactRequest.request.customHeaders, '{"X-Test":"ok"}');
  for (const resourceSubtype of ['html', 'css']) {
    const input = rule({ resourceType: 'html', resourceSubtype, response: { type: 'static', body: 'preserve  spaces\nand lines', customHeaders: '' } });
    assert.equal((await compactRuleCopy(input)).response.body, input.response.body);
  }
  const invalid = rule({ name: 'Broken', response: { type: 'dynamic', body: 'function broken( {', customHeaders: '' } });
  await assert.rejects(serializeRules([rule(), invalid]), /Broken · response.body/);
  const script = rule({ resourceType: 'html', resourceSubtype: 'js', response: { type: 'static', body: 'const number = 1;\nwindow.fixtureNumber = number;', customHeaders: '' } });
  assert.equal((await compactRuleCopy(script)).response.body, 'const number=1;window.fixtureNumber=number;');
});

test('background static module graph cannot load the dashboard minifier or formatting runtime', () => {
  const pending = [resolve('background.js')];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    assert.doesNotMatch(file.replaceAll('\\', '/'), /dashboard\/|vendor\/(?:terser|prettier)/);
    const ast = parse(readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
    for (const node of ast.body) {
      if (node.source?.value?.startsWith('.')) pending.push(resolve(dirname(file), node.source.value));
    }
  }
  assert.ok(visited.size > 10);
});
