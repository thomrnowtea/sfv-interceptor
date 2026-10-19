import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkXhrLifecycle } from './interception-xhr.mjs';
import { checkXhrCompatibility } from './interception-compat.mjs';
import { checkSandboxMessages } from './interception-sandbox.mjs';

const artifacts = resolve(process.env.SFVI_TEST_ARTIFACTS || '.artifacts/interception');
const extensionRoot = resolve(process.env.SFVI_EXTENSION_ROOT || '.');
mkdirSync(artifacts, { recursive: true });
const results = [];
const pageErrors = [];
const runtimeErrors = [];
const runtimeDiagnostics = [];
const expectedErrorIndices = new Set();
let scenario = 'setup';
let context;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (!path.startsWith('/api/')) {
    const headers = { 'Content-Type': 'text/html' };
    if (path === '/csp') headers['Content-Security-Policy'] = "script-src 'self'";
    response.writeHead(200, headers);
    response.end('<!doctype html><title>Interception audit fixture</title><p>Local synthetic fixture</p>');
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (path.endsWith('/stream')) {
    const chunk = Buffer.alloc(16384, 120);
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': chunk.length * 4 });
    for (let index = 0; index < 4; index++) {
      if (response.destroyed) return;
      response.write(chunk);
      await new Promise((resolve) => setTimeout(resolve, 65));
    }
    response.end();
    return;
  }
  if (path === '/api/disconnect') {
    request.socket.destroy();
    return;
  }
  if (path === '/api/slow' || path.endsWith('/slow')) await new Promise((resolve) => setTimeout(resolve, 300));
  if (path === '/api/binary') {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    response.end(Buffer.from([0, 255, 128, 42]));
    return;
  }
  if (path === '/api/xml') {
    response.writeHead(200, { 'Content-Type': 'application/xml' });
    response.end('<root>original</root>');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(
    JSON.stringify({
      original: true,
      path,
      body: Buffer.concat(chunks).toString(),
      method: request.method,
      header: request.headers['x-audit'] || null,
    }),
  );
});
const corsRequests = [];
const corsServer = createServer(async (request, response) => {
  corsRequests.push({ method: request.method, path: request.url });
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', '*');
  response.setHeader('Access-Control-Max-Age', '0');
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ body: Buffer.concat(chunks).toString() }));
});
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  await new Promise((resolve, reject) => {
    corsServer.once('error', reject);
    corsServer.listen(0, '127.0.0.1', resolve);
  });
  const corsOrigin = 'http://127.0.0.1:' + corsServer.address().port;
  function executable() {
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    if (existsSync(chromium.executablePath())) return chromium.executablePath();
    const cache = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
    return readdirSync(cache)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
      .flatMap((name) => ['chrome-win64', 'chrome-win'].map((folder) => join(cache, name, folder, 'chrome.exe')))
      .find(existsSync);
  }
  context = await chromium.launchPersistentContext(mkdtempSync(join(artifacts, 'profile-')), {
    headless: true,
    executablePath: executable(),
    viewport: { width: 1280, height: 900 },
    args: ['--disable-extensions-except=' + extensionRoot, '--load-extension=' + extensionRoot],
  });
  context.on('console', (message) => {
    if (message.type() !== 'error') return;
    runtimeErrors.push(message.text());
    runtimeDiagnostics.push({
      scenario,
      source: message.page()?.url() || message.location().url,
      message: message.text(),
    });
  });
  context.on('weberror', (event) => pageErrors.push(event.error().message));
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const control = await context.newPage();
  await control.goto('chrome-extension://' + new URL(worker.url()).hostname + '/dashboard/dashboard.html');
  await context.addInitScript(() => {
    window.auditRuleIds = [];
    window.auditSandboxReplies = [];
    window.auditUserExecutions = 0;
    window.addEventListener('message', (event) => {
      if (event.source === window && event.data?.type === '__sfvi_hook_data__')
        window.auditRuleIds = event.data.apis.map((rule) => rule.ruleId);
      if (
        event.data?.type === '__sfvi_sandbox_result__' &&
        event.source === document.getElementById('__sfvi_sandbox__')?.contentWindow
      )
        window.auditSandboxReplies.push(event.data.id);
      if (event.data?.type === '__audit_user_execution__') window.auditUserExecutions++;
    });
  });
  const page = await context.newPage();
  const makeRule = (overrides = {}) => ({
    id: 'audit',
    name: 'Interception audit',
    enabled: true,
    version: '1.0.0',
    resourceType: 'rest',
    pairs: [{ id: 'pair', urlPattern: '/api/target', urlOperator: 'Contains' }],
    request: { type: 'static', body: '', customHeaders: '' },
    response: { type: 'static', body: '{"mock":true}', statusCode: '200', delay: 0, customHeaders: '' },
    ...overrides,
  });
  async function open(rule, csp = false) {
    const result = await control.evaluate(
      (rule) => chrome.runtime.sendMessage({ type: 'IMPORT_RULES', rules: [rule] }),
      rule,
    );
    assert.equal(result.error, undefined);
    await page.goto(origin + (csp ? '/csp' : '/'));
    await page.waitForFunction(() =>
      Reflect.ownKeys(window).some(
        (key) => typeof key === 'symbol' && window[key]?._sfvi === 1 && window[key].updateApis,
      ),
    );
    await page.evaluate(() => window.postMessage({ type: '__sfvi_hook_ready__' }, location.origin));
    await page.waitForFunction(() => window.auditRuleIds.includes('audit'));
  }
  async function probe(name, operation, allowedErrors = []) {
    scenario = name;
    const errorOffset = runtimeErrors.length;
    try {
      await operation();
      const errors = runtimeErrors.slice(errorOffset);
      const expected = name.includes('without replaying')
        ? '[SFV-I] ' +
          (name.includes('request modifier') ? 'Request' : 'Response') +
          ' modification failed: Expected audit EvalError'
        : name.includes('when a modifier rejects')
          ? '[SFV-I] Response modification failed: Expected audit rejection'
          : name === 'a missing CSP sandbox fails open within a bounded time'
            ? '[SFV-I] Request modification failed: Sandbox readiness timeout'
            : name === 'XHR forwards network without a false successful load'
              ? 'Failed to load resource: net::ERR_EMPTY_RESPONSE'
              : name.startsWith('fetch preserves the original when throwing')
                ? '[SFV-I] Response modification failed: ' +
                  (name.includes('throwing null') ? 'null' : 'Modifier failed')
                : null;
      const allowed = new Set([expected, ...allowedErrors]);
      for (const message of allowedErrors)
        assert.ok(errors.includes(message), 'Expected scenario diagnostic was not recorded: ' + message);
      assert.deepEqual(
        errors.filter((error) => !allowed.has(error)),
        [],
        'Unexpected interception runtime error',
      );
      for (let index = errorOffset; index < runtimeErrors.length; index++)
        if (allowed.has(runtimeErrors[index])) expectedErrorIndices.add(index);
      results.push({ name, passed: true, runtimeErrors: errors });
      console.log('PASS:', name);
    } catch (error) {
      results.push({ name, passed: false, error: error.message, runtimeErrors: runtimeErrors.slice(errorOffset) });
      console.error('FAIL:', name, error.message);
    } finally {
      scenario = 'between probes';
    }
  }
  async function request(transport, { url = '/api/target', method = 'GET', body } = {}) {
    return page.evaluate(
      async ({ transport, url, method, body }) => {
        // Leave DevTools' privileged evaluation turn before exercising page CSP.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const operation =
          transport === 'fetch'
            ? fetch(url, { method, body }).then(async (response) => ({
                status: response.status,
                text: await response.text(),
              }))
            : new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open(method, url);
                xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
                xhr.onerror = () => reject(new Error('XHR failed'));
                xhr.send(body);
              });
        let timeout;
        try {
          return await Promise.race([
            operation,
            new Promise((_, reject) => {
              timeout = setTimeout(() => reject(new Error('Interception timed out')), 8000);
            }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
      },
      { transport, url, method, body },
    );
  }

  for (const transport of ['fetch', 'xhr']) {
    for (const field of ['request', 'response']) {
      await probe(transport + ' handles a user EvalError without replaying the ' + field + ' modifier', async () => {
        const name = field === 'request' ? 'modifyRequest' : 'modifyResponse';
        const body =
          'function ' +
          name +
          '() { window.parent.postMessage({type:"__audit_user_execution__"}, "*"); throw new EvalError("Expected audit EvalError"); }';
        const overrides =
          field === 'request'
            ? { request: { type: 'dynamic', body }, response: { type: 'static', body: '' } }
            : { response: { type: 'dynamic', body } };
        await open(makeRule(overrides));
        assert.equal(JSON.parse((await request(transport, { method: 'POST', body: 'original' })).text).original, true);
        await page.waitForFunction(() => window.auditUserExecutions >= 1);
        assert.equal(await page.evaluate(() => window.auditUserExecutions), 1);
      });
    }
    await probe(transport + ' preserves distinct matching flags through live rule updates', async () => {
      const first = makeRule({
        pairs: [{ id: 'pair', urlPattern: '/api/Mixed', urlOperator: 'Contains', caseSensitive: true }],
        response: { type: 'static', body: '{"matched":"sensitive"}' },
      });
      await open(first);
      assert.equal(JSON.parse((await request(transport, { url: '/api/mixed' })).text).original, true);
      const fallback = {
        ...makeRule(),
        id: 'fallback',
        response: { type: 'static', body: '{"matched":"fallback"}' },
        pairs: [{ id: 'pair', urlPattern: '/api/Mixed', urlOperator: 'Contains', caseSensitive: false }],
      };
      const published = await control.evaluate(
        (rules) => chrome.runtime.sendMessage({ type: 'IMPORT_RULES', rules }),
        [first, fallback],
      );
      assert.equal(published.error, undefined);
      assert.equal(JSON.parse((await request(transport, { url: '/api/Mixed' })).text).matched, 'sensitive');
      assert.equal(JSON.parse((await request(transport, { url: '/api/mixed' })).text).matched, 'fallback');
    });
    for (const operator of ['Contains', 'Equals', 'Wildcard', 'Regex']) {
      await probe(transport + ' respects case-sensitive ' + operator + ' matching', async () => {
        const pattern =
          operator === 'Equals' ? origin + '/api/Mixed' : operator === 'Wildcard' ? '*/api/Mixed' : '/api/Mixed';
        await open(
          makeRule({ pairs: [{ id: 'pair', urlPattern: pattern, urlOperator: operator, caseSensitive: true }] }),
        );
        assert.equal(JSON.parse((await request(transport, { url: '/api/Mixed' })).text).mock, true);
        assert.equal(JSON.parse((await request(transport, { url: '/api/mixed' })).text).original, true);
      });
    }
    await probe(transport + ' retains case-insensitive matching by default', async () => {
      await open(makeRule({ pairs: [{ id: 'pair', urlPattern: '/api/Mixed', urlOperator: 'Contains' }] }));
      assert.equal(JSON.parse((await request(transport, { url: '/api/mixed' })).text).mock, true);
    });
    for (const csp of [false, true]) {
      await probe(transport + ' awaits async response modifier in ' + (csp ? 'CSP sandbox' : 'MAIN'), async () => {
        await open(
          makeRule({
            response: {
              type: 'dynamic',
              body: 'async function modifyResponse(args) { await Promise.resolve(); return {...args.responseJSON, asynchronous:true}; }',
            },
          }),
          csp,
        );
        assert.equal(JSON.parse((await request(transport)).text).asynchronous, true);
        if (csp)
          assert.ok(
            await page.evaluate(() => window.auditSandboxReplies.length > 0),
            'CSP response must execute through the real sandbox',
          );
      });
      await probe(transport + ' awaits async request modifier in ' + (csp ? 'CSP sandbox' : 'MAIN'), async () => {
        await open(
          makeRule({
            request: {
              type: 'dynamic',
              body: 'async function modifyRequest(args) { await Promise.resolve(); return {...args.requestJSON, asynchronous:true}; }',
            },
            response: { type: 'static', body: '' },
          }),
          csp,
        );
        const response = JSON.parse((await request(transport, { method: 'POST', body: '{"sent":true}' })).text);
        assert.deepEqual(JSON.parse(response.body), { sent: true, asynchronous: true });
        if (csp)
          assert.ok(
            await page.evaluate(() => window.auditSandboxReplies.length > 0),
            'CSP request must execute through the real sandbox',
          );
      });
      await probe(
        transport + ' preserves the original response when a modifier rejects in ' + (csp ? 'CSP sandbox' : 'MAIN'),
        async () => {
          await open(
            makeRule({
              response: {
                type: 'dynamic',
                body: 'async function modifyResponse() { throw Error("Expected audit rejection"); }',
              },
            }),
            csp,
          );
          assert.equal(JSON.parse((await request(transport)).text).original, true);
        },
      );
    }
  }
  for (const asynchronous of [false, true]) {
    await probe(
      'synchronous XHR preserves ' +
        (asynchronous ? 'the original for unsupported async modifiers' : 'synchronous response modifiers'),
      async () => {
        const prefix = asynchronous ? 'async ' : '';
        await open(
          makeRule({
            response: {
              type: 'dynamic',
              body: prefix + 'function modifyResponse(args) { return {...args.responseJSON, changed:true}; }',
            },
          }),
        );
        const text = await page.evaluate(() => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', '/api/target', false);
          xhr.send();
          return xhr.responseText;
        });
        assert.equal(JSON.parse(text).original, true);
        assert.equal(JSON.parse(text).changed, asynchronous ? undefined : true);
      },
    );
  }
  await probe('a missing CSP sandbox fails open within a bounded time', async () => {
    await open(
      makeRule({
        request: { type: 'dynamic', body: 'function modifyRequest() { return "modified"; }' },
        response: { type: 'static', body: '' },
      }),
      true,
    );
    await page.evaluate(() => document.getElementById('__sfvi_sandbox__').remove());
    const response = JSON.parse((await request('fetch', { method: 'POST', body: 'original' })).text);
    assert.equal(response.body, 'original');
  });
  await probe('XHR dispatches each completion property handler and listener once', async () => {
    await open(makeRule());
    const counts = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('XHR completion events timed out')), 8000);
          const xhr = new XMLHttpRequest();
          const counts = { load: 0, listener: 0, ready: 0, end: 0 };
          xhr.open('GET', '/api/target');
          xhr.onload = () => {
            counts.load++;
          };
          xhr.addEventListener('load', () => {
            counts.listener++;
          });
          xhr.onreadystatechange = () => {
            if (xhr.readyState === 4) counts.ready++;
          };
          xhr.onloadend = () => {
            counts.end++;
            clearTimeout(timeout);
            setTimeout(() => resolve(counts), 0);
          };
          xhr.send();
        }),
    );
    assert.deepEqual(counts, { load: 1, listener: 1, ready: 1, end: 1 });
  });
  for (const statusCode of ['204', '205', '304']) {
    await probe('fetch supports a bodyless HTTP ' + statusCode + ' mock', async () => {
      await open(makeRule({ response: { type: 'static', body: 'ignored for bodyless status', statusCode } }));
      assert.deepEqual(await request('fetch'), { status: Number(statusCode), text: '' });
    });
    await probe('XHR supports a bodyless HTTP ' + statusCode + ' mock', async () => {
      await open(makeRule({ response: { type: 'static', body: 'ignored for bodyless status', statusCode } }));
      assert.deepEqual(await request('xhr'), { status: Number(statusCode), text: '' });
    });
  }
  for (const transport of ['fetch', 'xhr'])
    for (const type of ['static', 'dynamic']) {
      await probe(transport + ' suppresses the response body for ' + type + ' HEAD mocks', async () => {
        await open(
          makeRule({
            response: { type, body: type === 'static' ? 'ignored' : 'function modifyResponse() { return "ignored"; }' },
          }),
        );
        assert.deepEqual(await request(transport, { method: 'HEAD' }), { status: 200, text: '' });
      });
    }
  await probe('fetch honors the configured response delay', async () => {
    await open(makeRule({ response: { type: 'static', body: '{"mock":true}', delay: 120 } }));
    const elapsed = await page.evaluate(async () => {
      const before = performance.now();
      await fetch('/api/target');
      return performance.now() - before;
    });
    assert.ok(elapsed >= 100, 'Expected at least 100ms for a 120ms delay, received ' + elapsed + 'ms');
  });
  await probe('fetch redirects a Request while preserving its method body and headers', async () => {
    await open(
      makeRule({
        pairs: [
          { id: 'pair', urlPattern: '/api/target', urlOperator: 'Contains', redirectUrl: origin + '/api/redirected' },
        ],
        response: { type: 'static', body: '' },
      }),
    );
    const result = await page.evaluate(async () =>
      (
        await fetch(
          new Request(location.origin + '/api/target', {
            method: 'POST',
            body: 'original',
            headers: { 'X-Audit': 'retained' },
          }),
        )
      ).json(),
    );
    assert.deepEqual(
      [result.path, result.method, result.body, result.header],
      ['/api/redirected', 'POST', 'original', 'retained'],
    );
  });
  await probe('fetch respects an explicitly empty Request body override', async () => {
    await open(
      makeRule({
        request: {
          type: 'dynamic',
          body: 'function modifyRequest(args) { return args.requestData === "" ? "empty" : "wrong"; }',
        },
        response: { type: 'static', body: '' },
      }),
    );
    const result = await page.evaluate(async () =>
      (await fetch(new Request(location.origin + '/api/target', { method: 'POST', body: 'old' }), { body: '' })).json(),
    );
    assert.equal(result.body, 'empty');
  });
  await probe('fetch exposes a DELETE Request body to modifiers', async () => {
    await open(
      makeRule({
        request: { type: 'dynamic', body: 'function modifyRequest(args) { return args.requestData + "-changed"; }' },
        response: { type: 'static', body: '' },
      }),
    );
    const result = await page.evaluate(async () =>
      (await fetch(new Request(location.origin + '/api/target', { method: 'DELETE', body: 'original' }))).json(),
    );
    assert.equal(result.body, 'original-changed');
  });
  for (const mode of ['pre-aborted', 'delayed', 'unmatched-stream']) {
    await probe('fetch respects cancellation for ' + mode, async () => {
      await open(
        makeRule({ response: { type: 'static', body: '{"mock":true}', delay: mode === 'delayed' ? 200 : 0 } }),
      );
      const result = await page.evaluate(async (mode) => {
        const controller = new AbortController();
        let applied = 0;
        window.addEventListener('__sfvi_applied__', () => applied++);
        const input =
          mode === 'unmatched-stream'
            ? new Request(location.origin + '/api/unmatched', {
                method: 'POST',
                body: new ReadableStream(),
                duplex: 'half',
                signal: controller.signal,
              })
            : '/api/target';
        if (mode !== 'delayed') controller.abort();
        const outcome = fetch(input, mode === 'unmatched-stream' ? undefined : { signal: controller.signal }).then(
          () => 'resolved',
          (error) => error.name,
        );
        if (mode === 'delayed') setTimeout(() => controller.abort(), 20);
        const value = await Promise.race([
          outcome,
          new Promise((resolve) => setTimeout(() => resolve('pending'), 500)),
        ]);
        return { value, applied };
      }, mode);
      assert.deepEqual(result, { value: 'AbortError', applied: 0 });
    });
  }
  for (const field of ['request', 'response']) {
    await probe('fetch aborts during an async ' + field + ' modifier with the original reason', async () => {
      const body =
        'async function ' +
        (field === 'request' ? 'modifyRequest' : 'modifyResponse') +
        '() { await new Promise(resolve => setTimeout(resolve, 250)); return "changed"; }';
      await open(
        makeRule(
          field === 'request'
            ? { request: { type: 'dynamic', body }, response: { type: 'static', body: '' } }
            : { response: { type: 'dynamic', body } },
        ),
      );
      const result = await page.evaluate(async () => {
        const controller = new AbortController();
        const reason = { kind: 'audit cancellation' };
        let applied = 0;
        window.addEventListener('__sfvi_applied__', () => applied++);
        const started = performance.now();
        const outcome = fetch('/api/target', { method: 'POST', body: 'original', signal: controller.signal }).then(
          () => false,
          (error) => error === reason,
        );
        setTimeout(() => controller.abort(reason), 20);
        const matchedReason = await Promise.race([
          outcome,
          new Promise((resolve) => setTimeout(() => resolve('pending'), 500)),
        ]);
        const elapsed = performance.now() - started;
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { matchedReason, elapsed, applied };
      });
      assert.equal(result.matchedReason, true);
      assert.ok(result.elapsed < 200, 'Abort must not wait for modifier completion');
      assert.equal(result.applied, 0);
    });
  }
  const gqlCases = [
    {
      name: 'explicit POST operation',
      body: { operationName: 'GetProducts', query: 'query GetProducts { products }' },
      matched: true,
    },
    { name: 'named document', body: { query: 'query GetProducts { products }' }, matched: true },
    { name: 'prefix collision', body: { query: 'query GetProductsBackup { products }' }, matched: false },
    { name: 'field collision', body: { query: 'query Other { GetProducts }' }, matched: false },
    {
      name: 'comment and string collision',
      body: { query: '# GetProducts\nquery Other { products(name: "GetProducts") }' },
      matched: false,
    },
    {
      name: 'fragment collision',
      body: { query: 'fragment GetProducts on Product { id } query Other { products { ...GetProducts } }' },
      matched: false,
    },
    {
      name: 'fragment named query',
      body: { query: 'fragment query on Product { id } query GetProducts { products { ...query } }' },
      matched: true,
    },
    {
      name: 'ambiguous document',
      body: { query: 'query Other { products } query GetProducts { products }' },
      matched: false,
    },
    {
      name: 'nested defaults and block strings',
      body: { query: 'query GetProducts($filter: Input = {name: """query Other { }"""}) { products }' },
      matched: true,
    },
    {
      name: 'GET operation parameter',
      method: 'GET',
      query: { operationName: 'GetProducts', query: 'query GetProducts { products }' },
      matched: true,
    },
    { name: 'GET document', method: 'GET', query: { query: 'query GetProducts { products }' }, matched: true },
    {
      name: 'explicit different operation',
      body: { operationName: 'Other', query: 'query GetProducts { products } query Other { products }' },
      matched: false,
    },
  ];
  for (const transport of ['fetch', 'xhr'])
    for (const fixture of gqlCases) {
      await probe(transport + ' GraphQL matches ' + fixture.name + ' exactly', async () => {
        await open(
          makeRule({
            resourceType: 'graphql',
            pairs: [{ id: 'pair', urlPattern: '/api/target', urlOperator: 'Contains', gqlOperation: 'GetProducts' }],
          }),
        );
        const query = fixture.query ? '?' + new URLSearchParams(fixture.query) : '';
        const result = await request(transport, {
          url: '/api/target' + query,
          method: fixture.method || 'POST',
          body: fixture.body ? JSON.stringify(fixture.body) : undefined,
        });
        assert.equal(JSON.parse(result.text).mock === true, fixture.matched);
      });
    }
  for (const transport of ['fetch', 'xhr'])
    for (const csp of [false, true])
      for (const thrown of ['null', '""']) {
        await probe(
          transport + ' preserves the original when throwing ' + thrown + ' in ' + (csp ? 'CSP sandbox' : 'MAIN'),
          async () => {
            await open(
              makeRule({ response: { type: 'dynamic', body: 'function modifyResponse() { throw ' + thrown + '; }' } }),
              csp,
            );
            assert.equal(JSON.parse((await request(transport)).text).original, true);
          },
        );
      }
  for (const mode of ['static', 'dynamic', 'request-only']) {
    for (const responseType of ['json', 'arraybuffer', 'blob']) {
      await probe('XHR preserves ' + responseType + ' responses for ' + mode + ' rules', async () => {
        const response =
          mode === 'static'
            ? { type: 'static', body: '{"changed":true}' }
            : {
                type: 'dynamic',
                body:
                  mode === 'dynamic'
                    ? 'function modifyResponse(args) { return {...args.responseJSON, changed:true}; }'
                    : '',
              };
        await open(makeRule({ response }));
        const result = await page.evaluate(
          ({ responseType }) =>
            new Promise((resolve, reject) => {
              const guard = setTimeout(() => reject(new Error('Typed XHR did not complete')), 1500);
              const xhr = new XMLHttpRequest();
              xhr.open('GET', '/api/target');
              xhr.responseType = responseType;
              xhr.onerror = () => {
                clearTimeout(guard);
                reject(new Error('Typed XHR failed'));
              };
              xhr.onload = async () => {
                clearTimeout(guard);
                try {
                  const value =
                    responseType === 'json'
                      ? xhr.response
                      : JSON.parse(
                          responseType === 'blob' ? await xhr.response.text() : new TextDecoder().decode(xhr.response),
                        );
                  let textError;
                  try {
                    void xhr.responseText;
                  } catch (error) {
                    textError = error.name;
                  }
                  resolve({ value, textError, kind: Object.prototype.toString.call(xhr.response) });
                } catch (error) {
                  reject(error);
                }
              };
              xhr.send();
            }),
          { responseType },
        );
        assert.equal(result.value.changed, mode === 'request-only' ? undefined : true);
        assert.equal(result.value.original, mode === 'static' ? undefined : true);
        assert.equal(result.textError, 'InvalidStateError');
        assert.equal(
          result.kind,
          { json: '[object Object]', arraybuffer: '[object ArrayBuffer]', blob: '[object Blob]' }[responseType],
        );
      });
    }
  }
  for (const failure of ['abort', 'timeout', 'network', 'abort-during-modifier']) {
    await probe('XHR forwards ' + failure + ' without a false successful load', async () => {
      const request =
        failure === 'abort-during-modifier'
          ? {
              type: 'dynamic',
              body: 'async function modifyRequest(args) { await new Promise(resolve => setTimeout(resolve, 150)); return args.requestData; }',
            }
          : undefined;
      await open(
        makeRule({
          ...(request ? { request } : {}),
          pairs: [{ id: 'pair', urlPattern: '/api/', urlOperator: 'Contains' }],
          response: { type: 'dynamic', body: 'function modifyResponse(args) { return args.response; }' },
        }),
      );
      const result = await page.evaluate(
        (failure) =>
          new Promise((resolve, reject) => {
            const guard = setTimeout(() => reject(new Error('XHR failure event did not complete')), 1500);
            const events = [];
            const xhr = new XMLHttpRequest();
            xhr.open('POST', failure === 'network' ? '/api/disconnect' : '/api/slow');
            if (failure === 'timeout') xhr.timeout = 40;
            for (const type of ['abort', 'timeout', 'error', 'load', 'loadend'])
              xhr.addEventListener(type, () => events.push(type));
            xhr.onloadend = () => {
              clearTimeout(guard);
              const status = xhr.status;
              const text = xhr.responseText;
              setTimeout(() => resolve({ events, status, text, finalState: xhr.readyState }), 400);
            };
            xhr.send('body');
            if (failure.startsWith('abort')) setTimeout(() => xhr.abort(), 10);
          }),
        failure,
      );
      const event = failure.startsWith('abort') ? 'abort' : failure === 'network' ? 'error' : 'timeout';
      assert.deepEqual(result.events, [event, 'loadend']);
      assert.equal(result.status, 0);
      assert.equal(result.text, '');
      assert.equal(result.finalState, event === 'abort' ? 0 : 4);
    });
  }
  for (const mode of ['request-only', 'failed-transform']) {
    await probe('XHR retains exact binary bytes for ' + mode, async () => {
      await open(
        makeRule({
          pairs: [{ id: 'pair', urlPattern: '/api/binary', urlOperator: 'Contains' }],
          response: {
            type: 'dynamic',
            body:
              mode === 'request-only' ? '' : 'function modifyResponse() { throw Error("Expected typed rejection"); }',
          },
        }),
      );
      const result = await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const guard = setTimeout(() => reject(new Error('Binary XHR timed out')), 1500);
            const xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/binary');
            xhr.responseType = 'arraybuffer';
            xhr.onload = () => {
              clearTimeout(guard);
              resolve([...new Uint8Array(xhr.response)]);
            };
            xhr.onerror = () => {
              clearTimeout(guard);
              reject(new Error('Binary XHR failed'));
            };
            xhr.send();
          }),
      );
      assert.deepEqual(result, [0, 255, 128, 42]);
    });
  }
  for (const mode of ['static', 'dynamic', 'request-only']) {
    await probe('XHR preserves document responses and headers for ' + mode, async () => {
      const body =
        mode === 'static'
          ? '<root>changed</root>'
          : mode === 'dynamic'
            ? 'function modifyResponse(args) { return args.response.replace("original", "changed"); }'
            : '';
      await open(
        makeRule({
          pairs: [{ id: 'pair', urlPattern: '/api/xml', urlOperator: 'Contains' }],
          response: {
            type: mode === 'static' ? 'static' : 'dynamic',
            body,
            customHeaders: '{"Content-Type":"application/xml","X-Audit":"changed"}',
          },
        }),
      );
      const result = await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const guard = setTimeout(() => reject(new Error('Document XHR timed out')), 1500);
            const xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/xml');
            xhr.responseType = 'document';
            xhr.onload = () => {
              clearTimeout(guard);
              try {
                resolve({
                  text: xhr.response?.documentElement.textContent,
                  xml: xhr.responseXML === xhr.response,
                  header: xhr.getResponseHeader('x-audit'),
                  contentType: xhr.getResponseHeader('content-type'),
                });
              } catch (error) {
                reject(error);
              }
            };
            xhr.onerror = () => {
              clearTimeout(guard);
              reject(new Error('Document XHR failed'));
            };
            xhr.send();
          }),
      );
      assert.deepEqual(result, {
        text: mode === 'request-only' ? 'original' : 'changed',
        xml: true,
        header: mode === 'request-only' ? null : 'changed',
        contentType: 'application/xml',
      });
    });
  }
  for (const pending of [false, true]) {
    await probe(
      'XHR can reopen ' + (pending ? 'during a pending modifier' : 'after a mock') + ' for unmatched traffic',
      async () => {
        await open(
          makeRule(
            pending
              ? {
                  request: {
                    type: 'dynamic',
                    body: 'async function modifyRequest(args) { await new Promise(resolve => setTimeout(resolve, 150)); return args.requestData; }',
                  },
                }
              : {},
          ),
        );
        const result = await page.evaluate(
          (pending) =>
            new Promise((resolve, reject) => {
              const guard = setTimeout(() => reject(new Error('Reopened XHR timed out')), 2000);
              const xhr = new XMLHttpRequest();
              const loads = [];
              let reopened = false;
              const reopen = () => {
                reopened = true;
                xhr.open('GET', '/api/unmatched');
                xhr.send();
              };
              xhr.onload = () => {
                loads.push({ body: JSON.parse(xhr.responseText), type: xhr.getResponseHeader('content-type') });
                if (!reopened) reopen();
                else {
                  clearTimeout(guard);
                  setTimeout(() => resolve(loads), 250);
                }
              };
              xhr.onerror = () => {
                clearTimeout(guard);
                reject(new Error('Reopened XHR failed'));
              };
              xhr.open('POST', '/api/target');
              xhr.send('body');
              if (pending) setTimeout(reopen, 10);
            }),
          pending,
        );
        assert.equal(result.length, pending ? 1 : 2);
        assert.equal(result.at(-1).body.original, true);
        assert.equal(result.at(-1).type, 'application/json');
      },
    );
  }
  for (const failure of ['abort', 'timeout']) {
    await probe('XHR ' + failure + ' cancels a delayed mock before activity is reported', async () => {
      await open(makeRule({ response: { type: 'static', body: '{"mock":true}', delay: 200 } }));
      const result = await page.evaluate(
        (failure) =>
          new Promise((resolve, reject) => {
            let applied = 0;
            const events = [];
            const xhr = new XMLHttpRequest();
            window.addEventListener('__sfvi_applied__', () => applied++);
            const guard = setTimeout(() => reject(new Error('Delayed XHR did not finish')), 1500);
            xhr.open('GET', '/api/target');
            if (failure === 'timeout') xhr.timeout = 50;
            for (const type of ['abort', 'timeout', 'load', 'loadend'])
              xhr.addEventListener(type, () => events.push(type));
            xhr.onloadend = () => {
              clearTimeout(guard);
              setTimeout(() => resolve({ events, applied }), 250);
            };
            xhr.send();
            if (failure === 'abort') setTimeout(() => xhr.abort(), 20);
          }),
        failure,
      );
      assert.deepEqual(result, { events: [failure, 'loadend'], applied: 0 });
    });
  }
  await checkXhrLifecycle({ page, open, makeRule, probe, corsOrigin, corsRequests });
  await checkXhrCompatibility({ browser: context.browser(), origin, extensionRoot, probe });
  await checkSandboxMessages({ page, open, makeRule, probe });
  await probe('XHR rejects a second send even when its body no longer matches the rule', async () => {
    await open(
      makeRule({
        resourceType: 'graphql',
        pairs: [{ id: 'pair', urlPattern: '/api/target', urlOperator: 'Contains', gqlOperation: 'GetProducts' }],
        response: { type: 'static', body: '{"mock":true}', delay: 100 },
      }),
    );
    const result = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const guard = setTimeout(() => reject(new Error('Repeated-send XHR timed out')), 1500);
          const xhr = new XMLHttpRequest();
          let errorName;
          xhr.open('POST', '/api/target');
          xhr.onload = () => {
            clearTimeout(guard);
            resolve({ errorName, body: JSON.parse(xhr.responseText) });
          };
          xhr.send('{"operationName":"GetProducts"}');
          try {
            xhr.send('{"operationName":"Other"}');
          } catch (error) {
            errorName = error.name;
          }
        }),
    );
    assert.deepEqual(result, { errorName: 'InvalidStateError', body: { mock: true } });
  });
} catch (error) {
  results.push({ name: 'runner setup or fatal failure', passed: false, error: error.stack || String(error) });
  console.error(error);
} finally {
  scenario = 'cleanup';
  try {
    await context?.close();
  } finally {
    try {
      await Promise.all([server, corsServer].map((server) => new Promise((resolve) => server.close(resolve))));
    } finally {
      writeFileSync(
        join(artifacts, 'results.json'),
        JSON.stringify(
          {
            session: 'isolated unpacked extension with local HTTP fixtures',
            extensionRoot,
            results,
            pageErrors,
            runtimeDiagnostics,
            unexpectedRuntimeErrors: runtimeDiagnostics.filter((_, index) => !expectedErrorIndices.has(index)),
          },
          null,
          2,
        ),
      );
    }
  }
}
const failures = results.filter((result) => !result.passed);
console.log('Interception probes: ' + (results.length - failures.length) + '/' + results.length + ' passed.');
if (failures.length || pageErrors.length || runtimeErrors.some((_, index) => !expectedErrorIndices.has(index)))
  process.exitCode = 1;
