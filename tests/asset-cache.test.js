import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getOriginalText, getScriptUrlsForPage, clearAssetCaches, clearHtmlCache } from '../sw/cache/assets.js';
import { until } from './helpers/chrome.js';

beforeEach(() => clearAssetCaches());
afterEach(() => clearAssetCaches());

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const kinds = [
  { name: 'original', load: getOriginalText, capacity: 40, fallback: null,
    url: index => `https://cache.test/assets/${index}.js`,
    body: label => `const source = ${JSON.stringify(label)};`,
    value: label => `const source = ${JSON.stringify(label)};`, contentType: 'text/javascript',
    clears: [{ name: 'all caches', clear: clearAssetCaches }] },
  { name: 'HTML', load: getScriptUrlsForPage, capacity: 60, fallback: [],
    url: index => `https://cache.test/pages/${index}`,
    body: label => `<script src="/assets/${label}.js"></script>`,
    value: label => [`https://cache.test/assets/${label}.js`], contentType: 'text/html',
    clears: [{ name: 'HTML cache', clear: clearHtmlCache }, { name: 'all caches', clear: clearAssetCaches }] },
];

function network(context, kind) {
  const requests = [];
  context.mock.method(console, 'log', () => {});
  context.mock.method(console, 'warn', () => {});
  context.mock.method(globalThis, 'fetch', (url, options) => {
    assert.equal(options.cache, 'no-store');
    const request = { url, ...deferred() };
    requests.push(request);
    return request.promise;
  });
  const response = label => new Response(kind.body(label), { headers: { 'Content-Type': kind.contentType } });
  return { requests, response, complete: (index, label) => requests[index].resolve(response(label)) };
}

for (const kind of kinds) {
  for (const count of [kind.capacity, kind.capacity + 1, 100]) {
    test(`${kind.name} shares each unfinished download with ${count} distinct URLs`, async context => {
      const net = network(context, kind);
      const jobs = Array.from({ length: count }, (_, index) => kind.load(kind.url(index)));
      jobs.push(kind.load(kind.url(0)));
      assert.equal(net.requests.length, count, 'Pending work must not be evicted by the resident-cache capacity');
      for (let index = 0; index < count; index++) net.complete(index, 'body-' + index);
      const values = await Promise.all(jobs);
      assert.deepEqual(values.at(-1), kind.value('body-0'));
      for (let index = 0; index < count; index++) assert.deepEqual(values[index], kind.value('body-' + index));
      assert.deepEqual(await kind.load(kind.url(count - 1)), kind.value('body-' + (count - 1)));
      assert.equal(net.requests.length, count, 'The newest completed body should remain cached');
      if (count > kind.capacity) {
        const evicted = kind.load(kind.url(0));
        assert.equal(net.requests.length, count + 1, 'Completed-body cache must retain its existing capacity');
        net.complete(count, 'reloaded');
        assert.deepEqual(await evicted, kind.value('reloaded'));
      }
    });
  }

  for (const failure of ['network', 'body']) {
    test(`${kind.name} shares a ${failure} failure and permits a fresh retry`, async context => {
      const net = network(context, kind);
      const jobs = [kind.load(kind.url(0)), kind.load(kind.url(0))];
      assert.equal(net.requests.length, 1);
      if (failure === 'network') net.requests[0].reject(new Error('offline'));
      else {
        const response = net.response('unused');
        response.text = async () => { throw new Error('body interrupted'); };
        net.requests[0].resolve(response);
      }
      for (const value of await Promise.all(jobs)) assert.deepEqual(value, kind.fallback);
      const retry = kind.load(kind.url(0));
      assert.equal(net.requests.length, 2);
      net.complete(1, 'retry');
      assert.deepEqual(await retry, kind.value('retry'));
    });
  }

  test(`${kind.name} clears a synchronous fetch failure rather than retaining its settled promise`, async context => {
    const net = network(context, kind);
    let attempts = 0;
    context.mock.method(globalThis, 'fetch', () => { attempts++; throw new Error('synchronous failure'); });
    const values = await Promise.all([kind.load(kind.url(0)), kind.load(kind.url(0))]);
    for (const value of values) assert.deepEqual(value, kind.fallback);
    assert.deepEqual(await kind.load(kind.url(0)), kind.fallback);
    assert.equal(attempts, 2, 'A completed failed attempt must not poison future retries');
    assert.equal(net.requests.length, 0);
  });

  for (const { name, clear } of kind.clears) {
    for (const failure of [false, true]) for (const order of ['old-first', 'new-first']) {
      test(`${kind.name} ${name}: obsolete ${failure ? 'failure' : 'success'} finishing ${order} cannot replace or delete newer work`, async context => {
        const net = network(context, kind);
        const old = kind.load(kind.url(0));
        clear();
        const fresh = kind.load(kind.url(0));
        assert.equal(net.requests.length, 2);
        const finishOld = async () => {
          if (failure) net.requests[0].reject(new Error('old request failed'));
          else net.complete(0, 'old');
          assert.deepEqual(await old, failure ? kind.fallback : kind.value('old'));
        };
        if (order === 'old-first') {
          await finishOld();
          const joined = kind.load(kind.url(0));
          assert.equal(net.requests.length, 2, 'The newer request must remain shared');
          net.complete(1, 'fresh');
          assert.deepEqual(await joined, kind.value('fresh'));
        } else {
          net.complete(1, 'fresh');
          assert.deepEqual(await fresh, kind.value('fresh'));
          await finishOld();
        }
        assert.deepEqual(await fresh, kind.value('fresh'));
        assert.deepEqual(await kind.load(kind.url(0)), kind.value('fresh'));
        assert.equal(net.requests.length, 2);
      });
    }

    test(`${kind.name} ${name}: an invalidated download cannot repopulate an empty cache`, async context => {
      const net = network(context, kind);
      const old = kind.load(kind.url(0));
      clear();
      net.complete(0, 'old');
      assert.deepEqual(await old, kind.value('old'), 'An existing caller may still finish its captured request');
      const fresh = kind.load(kind.url(0));
      assert.equal(net.requests.length, 2, 'The next caller needs a new download after invalidation');
      net.complete(1, 'fresh');
      assert.deepEqual(await fresh, kind.value('fresh'));
    });

    test(`${kind.name} ${name}: invalidation also covers a response body still being read`, async context => {
      const net = network(context, kind);
      const body = deferred(); let reading = false;
      const old = kind.load(kind.url(0));
      const response = net.response('unused');
      response.text = () => { reading = true; return body.promise; };
      net.requests[0].resolve(response);
      await until(() => reading);
      clear();
      const fresh = kind.load(kind.url(0));
      assert.equal(net.requests.length, 2);
      net.complete(1, 'fresh');
      assert.deepEqual(await fresh, kind.value('fresh'));
      body.resolve(kind.body('old'));
      assert.deepEqual(await old, kind.value('old'));
      assert.deepEqual(await kind.load(kind.url(0)), kind.value('fresh'));
    });
  }
}

test('clearing page discovery leaves an unfinished original download shared', async context => {
  const kind = kinds[0];
  const net = network(context, kind);
  const first = kind.load(kind.url(0));
  clearHtmlCache();
  const second = kind.load(kind.url(0));
  assert.equal(net.requests.length, 1);
  net.complete(0, 'shared');
  assert.deepEqual(await first, kind.value('shared'));
  assert.deepEqual(await second, kind.value('shared'));
});

test('empty originals and HTML without assets are successful cache entries', async context => {
  const kind = kinds[0];
  const net = network(context, kind);
  const original = getOriginalText(kind.url(0));
  const html = getScriptUrlsForPage(kinds[1].url(0));
  net.requests[0].resolve(new Response(''));
  net.requests[1].resolve(new Response('<html><body>No external assets</body></html>'));
  assert.equal(await original, '');
  assert.deepEqual(await html, []);
  assert.equal(await getOriginalText(kind.url(0)), '');
  assert.deepEqual(await getScriptUrlsForPage(kinds[1].url(0)), []);
  assert.equal(net.requests.length, 2);
});
