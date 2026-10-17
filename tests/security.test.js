import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectCode, analyzeCode, inspectRuleCode, executableRuleFields, riskSeverity } from '../dashboard/core/risk-analysis.js';
import { RISK_FLAGS } from '../dashboard/core/risk-catalog.js';

const ids = code => analyzeCode(code).map(risk => risk.id).sort();
const ranges = (code, id) => analyzeCode(code).find(risk => risk.id === id)?.ranges ?? [];

test('every flag documents a real trigger with a nonempty exact source range', () => {
  for (const flag of RISK_FLAGS) {
    const analysis = inspectCode(flag.example);
    assert.equal(analysis.error, null, flag.id);
    const found = analysis.risks.find(risk => risk.id === flag.id);
    assert.ok(found, flag.id);
    assert.ok(found.ranges.every(range => range.from >= 0 && range.to > range.from && range.to <= flag.example.length), flag.id);
    assert.ok(flag.trigger && flag.why && flag.example, flag.id);
  }
});

test('comments, regular expressions, inert strings and template text are not executed by analysis', () => {
  const code = [
    '// fetch(document.cookie); eval(payload);',
    '/* navigator.clipboard.readText(); */',
    'const sample = "fetch(document.cookie); new Worker(source)";',
    'const template = `eval(payload); localStorage.getItem("token")`;',
    'const expression = /fetch\\(document.cookie\\)/;',
  ].join('\n');
  assert.deepEqual(ids(code), []);
  assert.deepEqual(ids('const value = `result: ${fetch("/api")}`;'), ['network_fetch']);
  assert.deepEqual(ids('const value = `cookie: ${document.cookie}`;'), ['cookie_read']);
});

test('normal DOM, cryptography, exports and page UI do not produce security claims', () => {
  const code = `function modifyResponse(args) {
    document.querySelector("button");
    const element = document.createElement("div");
    element.textContent = "preview";
    element.innerHTML = "<strong>Preview</strong>";
    crypto.getRandomValues(new Uint8Array(16));
    crypto.subtle.digest("SHA-256", new Uint8Array());
    const url = URL.createObjectURL(new Blob([args.response]));
    const value = new Proxy(args.responseJSON, {});
    Object.defineProperty(value, "visible", {value: true});
    new MutationObserver(() => {});
    new ResizeObserver(() => {});
    history.replaceState({}, "", "/preview");
    location.reload();
    navigator.clipboard.writeText("copied");
    navigator.permissions.query({name: "clipboard-read"});
    document.execCommand("copy");
    decodeURIComponent("value"); atob("dGVzdA==");
    return {...args.responseJSON, innerHTML: "data"};
  }`;
  assert.deepEqual(ids(code), []);
});

test('global recognition respects hoisting, parameters, destructuring, imports, catches and block scopes', () => {
  for (const code of [
    'fetch("local"); function fetch() {}',
    'function run(fetch) { fetch("local"); }',
    'function run({fetch}) { fetch("local"); }',
    'function run() { fetch("local"); var fetch; }',
    '{ fetch("local"); let fetch; }',
    'try {} catch (fetch) { fetch("local"); }',
    'import {fetch} from "./local.js"; fetch("local");',
    'const run = function fetch() { fetch("local"); };',
    'class Worker {} new Worker();',
    'function run(window, document, navigator) { window.fetch(); document.cookie; navigator.clipboard.readText(); }',
  ]) assert.deepEqual(ids(code), [], code);
  assert.equal(ranges('{const fetch = () => {}; fetch();} fetch("/api");', 'network_fetch').length, 1);
  assert.deepEqual(ids('const methods = {[fetch("/api")](fetch) { fetch("local"); }};'), ['network_fetch']);
});

test('immutable aliases, computed members, optional chaining and indirect calls retain their source positions', () => {
  const code = 'const {fetch: send} = globalThis; const read = window["fe" + "tch"]; send("/a"); read?.("/b"); (0, eval)(payload);';
  assert.deepEqual(ids(code), ['dynamic_eval', 'network_fetch']);
  assert.deepEqual(ranges(code, 'network_fetch').map(range => code.slice(range.from, range.to)), ['send', 'read']);
  assert.deepEqual(ids('window?.fetch?.("/api"); globalThis["ev" + "al"](payload);'), ['dynamic_eval', 'network_fetch']);
  assert.deepEqual(ids('fetch.call(window, "/api");'), ['network_fetch']);
});

test('reassigned aliases are not treated as stable browser references', () => {
  assert.deepEqual(ids('let send = window.fetch; send = localCall; send("local");'), []);
  assert.deepEqual(ids('const send = window.fetch; send = localCall; send("local");'), []);
  assert.deepEqual(ids('const send = window.fetch; function run(send) { send("local"); } send("/api");'), ['network_fetch']);
});

test('known string timers and Function calls are detected without treating callback timers as eval', () => {
  for (const code of [
    'setTimeout("run()", 10);', 'window.setInterval(`run(${value})`, 10);',
    'const code = "run()"; setTimeout(code, 10);', 'Function("return value")();',
    'const Build = Function; new Build("return value");',
  ]) assert.deepEqual(ids(code), ['dynamic_eval'], code);
  assert.deepEqual(ids('setTimeout(() => run(), 10); setInterval(run, 10);'), []);
});

test('cookie reads and writes are separate, including destructuring and compound assignment', () => {
  assert.deepEqual(ids('document.cookie = "preview=1";'), ['cookie_write']);
  assert.deepEqual(ids('const cookie = document.cookie;'), ['cookie_read']);
  assert.deepEqual(ids('const {cookie} = document;'), ['cookie_read']);
  assert.deepEqual(ids('const {cookie = ""} = document;'), ['cookie_read']);
  const aliased = 'const {cookie: session} = document;';
  assert.equal(aliased.slice(ranges(aliased, 'cookie_read')[0].from, ranges(aliased, 'cookie_read')[0].to), 'cookie');
  assert.deepEqual(ids('document.cookie += "; path=/";'), ['cookie_read', 'cookie_write']);
  assert.deepEqual(ids('cookieStore.getAll(); cookieStore.set("preview", "1");'), ['cookie_read', 'cookie_write']);
});

test('storage flags require entry operations rather than mere availability checks', () => {
  assert.deepEqual(ids('typeof window.localStorage; localStorage.length;'), []);
  assert.deepEqual(ids('localStorage.getItem("token"); sessionStorage.preview = "1"; indexedDB.open("app");'), ['storage']);
  assert.deepEqual(ids('const storage = {getItem() {}}; storage.getItem("token");'), []);
});

test('HTML reads, plain object fields and passive literal markup do not count as HTML insertion', () => {
  for (const code of [
    'const html = panel.innerHTML;', 'panel.innerHTML = "<b>Preview</b>";',
    'panel.innerHTML = \'<div title=" onerror= example">Preview</div>\';',
    'panel.innerHTML = "<p>literal onerror= example</p>";',
    'panel.innerHTML = \'<script type="application/json">{"example":"fetch()"}</script>\';',
    'panel.innerHTML = \'<script type="text/plain">inert example</script>\';',
    'const data = {}; data.innerHTML = response;',
    'function modifyResponse(args) { args.responseJSON.innerHTML = value; return args.responseJSON; }',
  ]) assert.deepEqual(ids(code), [], code);
  for (const code of [
    'panel.innerHTML = response;', 'panel.outerHTML = `<section>${value}</section>`;',
    'panel.insertAdjacentHTML("beforeend", response);', 'document.write(response);',
    'panel.innerHTML = "<img src=x onerror=run()>";', 'panel.innerHTML = "<script src=/extra.js></script>";',
    'panel.innerHTML = \'<script type="module">run()</script>\';',
  ]) assert.ok(ids(code).includes('dom_write'), code);
});

test('native interception is distinguished from ordinary property definitions and Proxy usage', () => {
  assert.deepEqual(ids('Object.defineProperty(settings, "name", {value: "Preview"}); new Proxy(data, {});'), []);
  for (const code of [
    'window.fetch = wrap;', 'Object.defineProperty(window, "fetch", {value: wrap});',
    'XMLHttpRequest.prototype.send = wrap;', 'Object.assign(window, {fetch: wrap});',
    'target.__proto__ = other;',
  ]) assert.ok(ids(code).includes('prototype_hook'), code);
});

test('wildcard window messaging is flagged while restricted origins and worker messaging are not', () => {
  assert.deepEqual(ids('window.parent.postMessage(data, "*");'), ['postmessage']);
  assert.deepEqual(ids('window.postMessage(data, {targetOrigin: "*"});'), ['postmessage']);
  assert.deepEqual(ids('window.postMessage(data, location.origin); worker.postMessage(data);'), []);
});

test('input capture is scoped to the page and sensitive navigator APIs are scoped to operations', () => {
  assert.deepEqual(ids('document.addEventListener("keydown", handle); window.oninput = handle;'), ['input_capture']);
  assert.deepEqual(ids('button.addEventListener("keydown", handle); document.addEventListener("click", handle);'), []);
  assert.deepEqual(ids('navigator.clipboard.readText(); navigator.geolocation.getCurrentPosition(handle);'), ['navigator_sensors']);
  assert.deepEqual(ids('navigator.clipboard.writeText(text); navigator.permissions.query({name:"camera"});'), []);
});

test('canvas readback requires an identifiable rendering source, not ordinary canvas construction', () => {
  assert.deepEqual(ids('const canvas = document.createElement("canvas"); canvas.getContext("2d");'), []);
  assert.deepEqual(ids('const canvas = document.createElement("canvas"); const ctx = canvas.getContext("2d"); ctx.getImageData(0,0,1,1);'), ['canvas_read']);
  assert.deepEqual(ids('const canvas = document.createElement("canvas"); canvas.toDataURL();'), ['canvas_read']);
  assert.deepEqual(ids('const canvas = document.createElement("CANVAS"); canvas.toDataURL();'), ['canvas_read']);
});

test('namespaced script creation is recognized without treating ordinary SVG creation as code loading', () => {
  assert.deepEqual(ids('document.createElementNS("http://www.w3.org/2000/svg", "script");'), ['external_code']);
  assert.deepEqual(ids('document.createElementNS("http://www.w3.org/2000/svg", "path");'), []);
});

test('source offsets use unmodified UTF-16 text, exclusive ends and actual line/column positions', () => {
  const code = 'const label = "😀";\r\nfetch("/a");\r\nfetch("/b");';
  const found = ranges(code, 'network_fetch');
  assert.deepEqual(found.map(range => [range.from, range.to, range.line, range.column]), [
    [code.indexOf('fetch'), code.indexOf('fetch') + 5, 2, 1],
    [code.lastIndexOf('fetch'), code.lastIndexOf('fetch') + 5, 3, 1],
  ]);
});

test('syntax errors and oversized sources are unavailable rather than clean results', () => {
  assert.ok(inspectCode('function broken(').error);
  assert.ok(inspectCode('const data = "unterminated').error);
  assert.ok(inspectCode(' '.repeat(1_000_001) + 'fetch()').error);
  assert.equal(inspectCode('const value = 1;').error, null);
  assert.equal(riskSeverity(analyzeCode('fetch("/api")')), 1);
});

test('save review covers request modifiers and static JavaScript without interpreting API data as code', () => {
  const rule = { resourceType: 'rest', request: {type:'dynamic',body:'function modifyRequest(args) { return eval(args.requestData); }'}, response: {type:'static',body:'{"example":"document.cookie"}'} };
  const snapshot = structuredClone(rule);
  assert.deepEqual(inspectRuleCode(rule).map(risk => [risk.id, risk.fields]), [['dynamic_eval', ['Request JavaScript']]]);
  assert.deepEqual(executableRuleFields(rule).map(field => field.id), ['f-req-modifier']);
  assert.deepEqual(rule, snapshot);
  rule.resourceType = 'html'; rule.resourceSubtype = 'js'; rule.request.type = 'static'; rule.response.body = 'const cookie = document.cookie;';
  assert.deepEqual(inspectRuleCode(rule).map(risk => risk.id), ['cookie_read']);
  rule.resourceSubtype = 'css';
  assert.deepEqual(inspectRuleCode(rule), []);
});
