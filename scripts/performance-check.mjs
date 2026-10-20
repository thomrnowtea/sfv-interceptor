// Compare real release archives with synthetic traffic in disposable profiles.
// No personal browser, rules, account, or external website is used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { unzipSync } from 'fflate';

const args = process.argv.slice(2);
const coldConfirmation = args[0] === '--confirm-cold';
const paths = coldConfirmation ? args.slice(1) : args;
assert.equal(paths.length, 2, 'Usage: node scripts/performance-check.mjs [--confirm-cold] <baseline.zip> <candidate.zip>');
const rounds = coldConfirmation ? 20 : Number(process.env.SFVI_BENCH_ROUNDS || 6);
const warmSamples = Number(process.env.SFVI_BENCH_WARM_SAMPLES || 4);
const assetLatency = Number(process.env.SFVI_BENCH_ASSET_LATENCY_MS ?? 60);
assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 30);
assert.ok(Number.isInteger(warmSamples) && warmSamples > 0 && warmSamples <= 20);
assert.ok(Number.isFinite(assetLatency) && assetLatency >= 0 && assetLatency <= 1000);
const artifacts = resolve(process.env.SFVI_TEST_ARTIFACTS || '.artifacts/performance');
mkdirSync(artifacts, { recursive: true });
const output = mkdtempSync(join(artifacts, 'run-'));
const report = { mode: coldConfirmation ? '20-pair-cold-confirmation' : 'full', rounds, warmSamples, assetLatency, harnessChecksum: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
  samples: [], failures: [], comparisons: [], startupChecks: [] };
const requests = [];
const cases = [
  { id: 'small-sync', bytes: 64 * 1024, type: 'dynamic', asynchronous: false },
  { id: 'large-sync', bytes: 4 * 1024 * 1024, type: 'dynamic', asynchronous: false },
  { id: 'large-async', bytes: 4 * 1024 * 1024, type: 'dynamic', asynchronous: true },
  { id: 'large-static', bytes: 4 * 1024 * 1024, type: 'static', asynchronous: false },
].filter(item => !coldConfirmation || item.id === 'small-sync');
const sources = new Map();
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function extractArchive(path, label) {
  const archive = readFileSync(resolve(path));
  const checksum = createHash('sha256').update(archive).digest('hex');
  const expected = readFileSync(resolve(path) + '.sha256', 'utf8').trim().split(/\s+/)[0];
  assert.equal(checksum, expected, 'Archive checksum mismatch: ' + path);
  const files = unzipSync(archive);
  const root = join(output, label);
  for (const [name, bytes] of Object.entries(files)) {
    assert.ok(!name.includes('\\') && !name.includes(':') && name.split('/').every(part => part && part !== '.' && part !== '..'));
    const destination = resolve(root, name);
    assert.ok(destination.startsWith(root + sep));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
  }
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
  return { label, root, checksum, version: manifest.version, manifest };
}

function executable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const installed = readdirSync(cache).filter(name => /^chromium-\d+$/.test(name));
  installed.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  return installed.flatMap(name => ['chrome-win64', 'chrome-win'].map(folder => join(cache, name, folder, 'chrome.exe'))).find(existsSync);
}

function bundleSource(bytes, value) {
  const worker = 'let n=0;for(let i=0;i<50000;i++)n=(n+i)%65521;postMessage(n);';
  return '"use strict";var benchmarkGlobal=41;let benchmarkLexical=1;function benchmarkSum(){return benchmarkGlobal+benchmarkLexical;}' +
    'window.benchmarkRuns=(window.benchmarkRuns||0)+1;window.benchmarkValue=' + JSON.stringify(value) + ';' +
    'window.benchmarkPatchedAt=performance.now();window.benchmarkPatchHidden=document.hidden;' +
    'const benchmarkWorker=new Worker(URL.createObjectURL(new Blob([' + JSON.stringify(worker) + '],{type:"text/javascript"})));' +
    'benchmarkWorker.onmessage=e=>{window.benchmarkWorkerResult=e.data;window.benchmarkWorkerAt=performance.now();' +
    'window.benchmarkWorkerHidden=document.hidden;benchmarkWorker.terminate();};/*' + 'x'.repeat(bytes) + '*/';
}

const monitor = `window.benchmarkVisibility=[{hidden:document.hidden,focused:document.hasFocus()}];
document.addEventListener('visibilitychange',()=>benchmarkVisibility.push({hidden:document.hidden,focused:document.hasFocus()}));
window.addEventListener('message',event=>{if(event.source===window&&event.data?.type==='__sfvi_hook_data__'&&
event.data.apis?.some(rule=>rule.ruleId==='benchmark-api')&&!window.benchmarkHookAt)window.benchmarkHookAt=performance.now();});`;

function fixture(url) {
  const asset = '/assets/probe.js?key=' + url.searchParams.get('key');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Isolated release comparison</title>' +
    '<script>' + monitor + '</script><link rel="stylesheet" href="/assets/probe.css">' +
    '<script src="' + asset + '"></script><script>window.benchmarkAtParserBoundary=window.benchmarkValue||null;</script>' +
    '</head><body><p>Disposable synthetic fixture</p></body></html>';
}

async function respond(request, response) {
  const url = new URL(request.url, 'http://fixture.test');
  requests.push({ url: request.url, destination: request.headers['sec-fetch-dest'] || '', at: Date.now() });
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/assets/probe.js') {
    await delay(assetLatency);
    response.setHeader('Content-Type', 'text/javascript');
    response.end(sources.get(url.searchParams.get('key')));
    return;
  }
  if (url.pathname === '/assets/probe.css') {
    response.setHeader('Content-Type', 'text/css'); response.end('body { color: rgb(255, 0, 0); }'); return;
  }
  if (url.pathname.startsWith('/api/')) {
    response.setHeader('Content-Type', 'application/json'); response.end('{"original":true}'); return;
  }
  response.setHeader('Content-Type', 'text/html'); response.end(fixture(url));
}

const server = createServer((request, response) => {
  respond(request, response).catch(error => { response.destroy(error); });
});

function rule(id, path, resourceType, body, extra = {}) {
  return { id, name: id, version: '1.0.0', enabled: true, resourceType,
    pairs: [{ id: id + '-pair', urlPattern: path, urlOperator: 'Contains', method: 'GET' }],
    request: { type: 'static', body: '', customHeaders: '' },
    response: { type: 'dynamic', body, statusCode: '200', delay: 0, customHeaders: '' }, ...extra };
}

function rulesFor(item) {
  const transform = (item.asynchronous ? 'async ' : '') + 'function modifyResponse(args){' +
    (item.asynchronous ? 'await Promise.resolve();' : '') +
    'return args.response.replace("original-value","patched-value");}';
  const js = rule('benchmark-js', '/assets/probe.js', 'html', transform, { resourceSubtype: 'js' });
  if (item.type === 'static') js.response = { ...js.response, type: 'static', body: bundleSource(item.bytes, 'patched-value') };
  return [js,
    rule('benchmark-css', '/assets/probe.css', 'html', '', { resourceSubtype: 'css',
      response: { type: 'static', body: 'body { color: rgb(1, 2, 3); }', statusCode: '200', delay: 0, customHeaders: '' } }),
    rule('benchmark-page', '/fixture', 'html', 'function modifyResponse(){window.benchmarkPageRuns=(window.benchmarkPageRuns||0)+1;}', { resourceSubtype: 'html' }),
    rule('benchmark-api', '/api/value', 'rest', 'function modifyResponse(args){return {...args.responseJSON,patched:true};}'),
  ];
}

async function waitForPort(child, profile) {
  const file = join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 150; attempt++) {
    assert.equal(child.exitCode, null, 'Isolated test browser exited before CDP was available');
    if (existsSync(file)) return readFileSync(file, 'utf8').trim().split(/\r?\n/);
    await delay(100);
  }
  throw Error('Isolated test browser did not expose its CDP port');
}

async function findWorker(context, extension) {
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const worker of context.serviceWorkers()) {
      if (await worker.evaluate(() => chrome.runtime.getManifest().name).catch(() => null) === extension.manifest.name) return worker;
    }
    await delay(50);
  }
  throw Error('Expected extension worker was not loaded');
}

async function startBrowser(extension) {
  const profile = mkdtempSync(join(output, 'profile-' + extension.label + '-'));
  const child = spawn(report.executable, ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, '--disable-extensions-except=' + extension.root, '--load-extension=' + extension.root,
    '--disable-component-extensions-with-background-pages', '--no-first-run', '--no-default-browser-check', 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
  try {
    const [port, endpoint] = await waitForPort(child, profile);
    const browser = await chromium.connectOverCDP('ws://127.0.0.1:' + port + endpoint, { noDefaults: true });
    const context = browser.contexts()[0];
    context.setDefaultTimeout(15000);
    const worker = await findWorker(context, extension);
    const extensionId = new URL(worker.url()).hostname;
    const control = context.pages()[0];
    // A packaged JSON document has the extension origin without running an
    // editor that would format and render our deliberately oversized rules.
    await control.goto('chrome-extension://' + extensionId + '/manifest.json');
    assert.equal(await control.evaluate(() => chrome.runtime.id), extensionId);
    await control.bringToFront();
    const session = await context.newCDPSession(control);
    const versions = new Map();
    session.on('ServiceWorker.workerVersionUpdated', ({ versions: updates }) => updates.forEach(version => versions.set(version.versionId, version)));
    await session.send('ServiceWorker.enable');
    return { child, browser, context, control, extensionId, session, versions };
  } catch (error) { child.kill(); throw error; }
}

async function stopWorker(state) {
  const worker = state.context.serviceWorkers().find(item => item.url().includes(state.extensionId));
  assert.ok(worker, 'An extension worker must be running before the cold-start probe');
  const version = [...state.versions.values()].find(item => item.scriptURL === worker.url() && item.runningStatus === 'running');
  assert.ok(version, 'CDP must identify the extension worker before stopping it');
  await state.session.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (state.versions.get(version.versionId)?.runningStatus === 'stopped') return { versionId: version.versionId, confirmedStopped: true };
    await delay(50);
  }
  report.workerStopFailure = [...state.versions.values()];
  throw Error('CDP did not confirm that the extension worker stopped');
}

async function hiddenPage(state) {
  const worker = await findWorker(state.context, { manifest: { name: 'SFV Interceptor' } });
  const incoming = state.context.waitForEvent('page');
  await worker.evaluate(() => chrome.tabs.create({ url: 'about:blank', active: false }));
  const page = await incoming;
  assert.equal(await page.evaluate(() => document.hidden), true, 'Fixture must be hidden before navigation');
  return page;
}

async function readMetrics(page) {
  await page.waitForFunction(() => window.benchmarkValue === 'patched-value' && window.benchmarkWorkerAt &&
    window.benchmarkPageRuns === 1 && window.benchmarkHookAt && getComputedStyle(document.body).color === 'rgb(1, 2, 3)',
  null, { polling: 50, timeout: 15000 });
  return page.evaluate(async () => {
    const values = { patchedAt: window.benchmarkPatchedAt, workerAt: window.benchmarkWorkerAt, hookAt: window.benchmarkHookAt,
      atParserBoundary: window.benchmarkAtParserBoundary, runs: window.benchmarkRuns, pageRuns: window.benchmarkPageRuns,
      sum: benchmarkSum(), lexical: benchmarkLexical, workerResult: window.benchmarkWorkerResult,
      patchHidden: window.benchmarkPatchHidden, workerHidden: window.benchmarkWorkerHidden, visibility: window.benchmarkVisibility };
    const startFetch = performance.now();
    for (let index = 0; index < 20; index++) {
      const response = await (await fetch('/api/value')).json();
      if (response.patched !== true) throw Error('Dynamic fetch modifier was not applied');
    }
    values.fetchBatch = performance.now() - startFetch;
    const startXhr = performance.now();
    for (let index = 0; index < 10; index++) {
      const xhr = new XMLHttpRequest(); xhr.open('GET', '/api/value', false); xhr.send();
      if (JSON.parse(xhr.responseText).patched !== true) throw Error('Synchronous XHR modifier was not applied');
    }
    values.xhrBatch = performance.now() - startXhr;
    return values;
  });
}

async function sample(state, extension, item, key, round, temperature) {
  const page = await hiddenPage(state);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const workerStopped = temperature === 'cold' ? await stopWorker(state) : null;
  const requestStart = requests.length;
  try {
    await page.goto(report.origin + '/fixture?key=' + key);
    const metrics = await readMetrics(page);
    assert.deepEqual(errors, [], 'Unexpected fixture JavaScript errors');
    assert.equal(metrics.runs, 1); assert.equal(metrics.pageRuns, 1);
    assert.equal(metrics.sum, 42); assert.equal(metrics.lexical, 1);
    assert.equal(metrics.workerResult, 30883);
    assert.equal(metrics.patchHidden, true); assert.equal(metrics.workerHidden, true);
    assert.ok(metrics.visibility.every(entry => entry.hidden && !entry.focused), 'Fixture became visible');
    const resourceRequests = requests.slice(requestStart).filter(request => request.url.includes('/assets/probe.js'));
    assert.ok(resourceRequests.every(request => request.destination !== 'script'), 'Original script was not blocked');
    const expectedFetches = temperature === 'cold' && item.type === 'dynamic' ? 1 : 0;
    const worker = await findWorker(state.context, extension);
    const workerBoot = await worker.evaluate(() => performance.timeOrigin);
    if (temperature === 'prime') state.primedWorkerBoot = workerBoot;
    if (temperature === 'warm') assert.equal(workerBoot, state.primedWorkerBoot, 'A warm sample must retain the primed worker');
    report.samples.push({ version: extension.version, label: extension.label, case: item.id, round, temperature, workerStopped,
      workerBoot, originalFetches: resourceRequests.length, ...metrics });
    if (temperature === 'followup' && item.type === 'dynamic') {
      const check = { label: extension.label, case: item.id, round, expectedFetches: 0,
        actualFetches: resourceRequests.length, passed: resourceRequests.length === 0 };
      report.startupChecks.push(check);
      assert.ok(resourceRequests.length <= 1, 'An immediate follow-up must not duplicate source downloads');
      // The published baseline has a proven startup clear-after-insertion race.
      // Keep its failed checks visible; the candidate must actually fix them.
      if (extension.label === 'candidate') assert.ok(check.passed, 'Candidate startup reconciliation erased a prepared original');
      return;
    }
    if (temperature === 'prime' && item.type === 'dynamic') {
      assert.ok(resourceRequests.length <= 1, 'Priming must not duplicate source downloads');
      return;
    }
    if (resourceRequests.length !== expectedFetches) report.cacheFailure = { label: extension.label, case: item.id, round, temperature, resourceRequests };
    assert.equal(resourceRequests.length, expectedFetches, 'Original preload cache did not behave as expected');
  } finally { await page.close(); }
}

async function runBlock(extension, round) {
  const state = await startBrowser(extension);
  try {
    report.browserVersion = await state.browser.version();
    for (const item of cases) {
      const reply = await state.control.evaluate(rules => chrome.runtime.sendMessage({ type: 'IMPORT_RULES', rules }), rulesFor(item));
      assert.equal(reply.error, undefined);
      const key = extension.label + '-' + round + '-' + item.id;
      sources.set(key, bundleSource(item.bytes, 'original-value'));
      await sample(state, extension, item, key, round, 'cold');
      if (coldConfirmation) {
        console.log(extension.label + ' confirmation pair ' + round + ': first cold navigation checked');
        continue;
      }
      await sample(state, extension, item, key, round, 'followup');
      // Priming is explicit and retained in the raw report. It does not erase
      // immediate-follow-up failures or contribute to steady-warm statistics.
      await sample(state, extension, item, key, round, 'prime');
      for (let index = 0; index < warmSamples; index++) await sample(state, extension, item, key, round, 'warm');
      console.log(extension.label + ' round ' + round + ': ' + item.id + ' checked cold, immediate follow-up, priming and ' + warmSamples + ' warm hidden navigations');
    }
  } finally {
    await state.browser.close();
    if (state.child.exitCode === null) state.child.kill();
  }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

function compare() {
  // Limits are fixed before measuring: 10% or 10ms at the median;
  // 20% or 20ms at p95. Passing is scoped equivalence, never exact equality.
  for (const item of cases) for (const temperature of (coldConfirmation ? ['cold'] : ['cold', 'followup', 'warm'])) {
    for (const metric of ['patchedAt', 'workerAt', 'hookAt', 'fetchBatch', 'xhrBatch']) {
      const selected = report.samples.filter(sample => sample.case === item.id && sample.temperature === temperature);
      const baseline = selected.filter(sample => sample.label === 'baseline').map(sample => sample[metric]);
      const candidate = selected.filter(sample => sample.label === 'candidate').map(sample => sample[metric]);
      const median = { baseline: percentile(baseline, .5), candidate: percentile(candidate, .5) };
      const p95 = { baseline: percentile(baseline, .95), candidate: percentile(candidate, .95) };
      const medianLimit = Math.max(10, median.baseline * .1);
      const p95Limit = Math.max(20, p95.baseline * .2);
      const passed = median.candidate - median.baseline <= medianLimit && p95.candidate - p95.baseline <= p95Limit;
      report.comparisons.push({ case: item.id, temperature, metric, baselineSamples: baseline.length, candidateSamples: candidate.length,
        median, p95, medianLimit, p95Limit, passed });
    }
  }
}

try {
  const extensions = [extractArchive(paths[0], 'baseline'), extractArchive(paths[1], 'candidate')];
  assert.ok(!extensions[1].manifest.permissions.includes('debugger'), 'Candidate must not request debugger');
  report.archives = extensions.map(({ label, version, checksum }) => ({ label, version, checksum }));
  report.executable = executable();
  assert.ok(report.executable, 'Install Playwright Chromium or set PLAYWRIGHT_CHROMIUM_EXECUTABLE');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  report.origin = 'http://127.0.0.1:' + server.address().port;
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 ? [...extensions].reverse() : extensions;
    for (const extension of order) await runBlock(extension, round);
  }
  compare();
  if (coldConfirmation) {
    report.pairedDifferences = Array.from({ length: rounds }, (_, round) => {
      const baseline = report.samples.find(sample => sample.round === round && sample.label === 'baseline');
      const candidate = report.samples.find(sample => sample.round === round && sample.label === 'candidate');
      return { round, order: round % 2 ? 'candidate-first' : 'baseline-first',
        patchedAt: candidate.patchedAt - baseline.patchedAt, hookAt: candidate.hookAt - baseline.hookAt };
    });
    report.primaryOutcomes = report.comparisons.filter(item => ['patchedAt', 'hookAt'].includes(item.metric));
  }
} catch (error) { report.failures.push(error.stack || String(error)); console.error(error); }
finally {
  await new Promise(resolve => server.close(resolve));
  report.complete = report.samples.length === rounds * (coldConfirmation ? 1 : warmSamples + 3) * cases.length * 2;
  report.passed = report.complete && report.failures.length === 0 && report.comparisons.every(item => item.passed);
  writeFileSync(join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log('Performance comparison: ' + report.samples.length + ' samples; ' + report.comparisons.filter(item => !item.passed).length + ' regression signals. Evidence: ' + join(output, 'results.json'));
  console.log('Startup cache refetches: baseline ' + report.startupChecks.filter(item => item.label === 'baseline' && !item.passed).length +
    '; candidate ' + report.startupChecks.filter(item => item.label === 'candidate' && !item.passed).length);
  if (!report.passed) process.exitCode = 1;
}
