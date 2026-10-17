import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { bodyLanguage, formatCode, formatJS, formatSelection } from '../dashboard/editor/formatter.js';

function structuralAst(code) {
  return JSON.parse(JSON.stringify(parse(code, { ecmaVersion: 'latest', sourceType: 'module' }),
    (key, value) => ['start', 'end', 'raw'].includes(key) ? undefined : value));
}

test('Prettier formats regexes, templates and for headers without changing the JavaScript AST', async () => {
  const code = [
    'function modifyResponse(args){const response=args.response;',
    '// Keep this comment and the literal regex intact.',
    'const matcher=/[{};]+/g;const message=`value: ${args.value ?? "none"}`;',
    'for(let i=0;i<3;i++){if(matcher.test(message)){response.push({i,message});}}',
    'return response;}',
  ].join('\n');
  const formatted = await formatJS(code);
  assert.deepEqual(structuralAst(formatted), structuralAst(code));
  assert.match(formatted, /for \(let i = 0; i < 3; i\+\+\)/);
  assert.match(formatted, /\n  const response = args\.response;/);
  assert.ok(formatted.includes('// Keep this comment and the literal regex intact.'));
  assert.equal(await formatJS(formatted), formatted);
});

test('JSON is formatted from its raw source, retaining big integer digits and duplicate keys', async () => {
  const code = '{"big":9007199254740993,"same":1,"same":2,"zero":-0}';
  const { formatted } = await formatCode(code, { language: 'json' });
  assert.ok(formatted.includes('9007199254740993'));
  assert.equal((formatted.match(/"same"/g) || []).length, 2);
  assert.ok(formatted.includes('-0'));
  assert.equal((await formatCode(formatted, { language: 'json' })).formatted, formatted);
  assert.equal((await formatCode('"hello"', { language: 'json' })).formatted.trim(), '"hello"');
});

test('plain text and malformed JSON are never retried as JavaScript', async () => {
  for (const code of ['hello', '{"broken":', 'callback(value)']) {
    await assert.rejects(formatCode(code, { language: 'json' }));
  }
});

test('body parser selection follows request/response modes and the actual resource subtype', () => {
  const css = { resourceType: 'html', resourceSubtype: 'css' };
  assert.equal(bodyLanguage('f-req-body-static', css), 'json');
  assert.equal(bodyLanguage('f-req-modifier', css), 'javascript');
  assert.equal(bodyLanguage('f-body-dynamic', css), 'javascript');
  assert.equal(bodyLanguage('f-body-static', css), 'css');
  assert.equal(bodyLanguage('f-body-static', { ...css, resourceSubtype: 'html' }), 'html');
  assert.equal(bodyLanguage('f-body-static', { ...css, resourceSubtype: 'js' }), 'javascript');
  assert.equal(bodyLanguage('f-body-static', { resourceType: 'graphql' }), 'json');
  assert.equal(bodyLanguage('f-body-static', { resourceType: 'rest' }), 'json');
});

test('local HTML/CSS plugins format markup and embedded script/style content', async () => {
  const css = await formatCode('.card{color:red;padding:4px 8px}', { language: 'css' });
  assert.match(css.formatted, /\n  color: red;/);
  const html = await formatCode('<main><h1>Hello</h1><script>const x={a:1};</script><style>.card{color:red}</style></main>', { language: 'html' });
  assert.match(html.formatted, /const x = \{ a: 1 \};/);
  assert.match(html.formatted, /color: red;/);
  assert.equal((await formatCode(html.formatted, { language: 'html' })).formatted, html.formatted);
});

test('syntax errors are explicit and empty bodies keep their original whitespace', async () => {
  await assert.rejects(formatJS('function modifyResponse( {'));
  await assert.rejects(formatCode('text', { language: 'unknown' }), /Unsupported/);
  assert.deepEqual(await formatCode(' \n\t', { language: 'json', cursorOffset: 2 }), { formatted: ' \n\t', cursorOffset: 2 });
});

test('Prettier maps both endpoints of a reversed code selection', async () => {
  const code = 'function modifyResponse(args){const response=args.response;return response;}';
  const cursorOffset = code.indexOf('response');
  const result = await formatSelection(code, { language: 'javascript', cursorOffset, anchorOffset: cursorOffset + 8 });
  assert.ok(result.anchorOffset > result.cursorOffset);
  assert.equal(result.formatted.slice(result.cursorOffset, result.anchorOffset), 'response');
});
