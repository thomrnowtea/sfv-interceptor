import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installChrome, rule, until } from './helpers/chrome.js';
import { originalCache, clearAssetCaches, getOriginalText } from '../sw/cache/assets.js';
import { publishRulesChanged } from '../sw/handlers/messaging.js';

const asset = 'https://example.test/assets/bundle.js';
let fixture;
let fetches;
beforeEach(() => {
  fixture = installChrome({ sfvi_rules: [rule({ resourceType: 'html', resourceSubtype: 'js',
    pairs: [{ id: 'bundle', urlPattern: asset, urlOperator: 'Equals', method: 'GET' }] })] });
  clearAssetCaches();
  fetches = 0;
  globalThis.fetch = async () => { fetches++; return new Response('fresh source', { headers: { 'Content-Type': 'text/javascript' } }); };
});

function deferDnr() {
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const update = chrome.declarativeNetRequest.updateDynamicRules;
  chrome.declarativeNetRequest.updateDynamicRules = async options => {
    enter();
    await gate;
    return update(options);
  };
  return { entered, release };
}

async function loadBackground() {
  await import('../background.js?cache-test=' + crypto.randomUUID());
}

for (const lifecycle of ['evaluation', 'onInstalled', 'onStartup']) {
  test(lifecycle + ' reconciliation retains a source prepared while DNR application waits', async () => {
    if (lifecycle !== 'evaluation') {
      await loadBackground();
      await until(() => fixture.notifications.some(message => message.type === 'RULES_CHANGED'));
    }
    const dnr = deferDnr();
    const pending = lifecycle === 'evaluation'
      ? loadBackground()
      : Promise.all(chrome.runtime[lifecycle].emit({ reason: 'update' }));
    await dnr.entered;
    originalCache.set(asset, 'prepared source');
    fixture.notifications.length = 0;
    dnr.release();
    await pending;
    await until(() => fixture.notifications.some(message => message.type === 'RULES_CHANGED'));
    assert.equal(await getOriginalText(asset), 'prepared source');
    assert.equal(fetches, 0, 'Reconciliation must not force a second original-resource download');
    assert.equal(fixture.dynamicRules.length, 1, 'File blocking must still be restored');
  });
}

for (const input of [undefined, { id: 'source', changed: true }]) {
  test(input ? 'source-sync callback results still invalidate cached originals' : 'ordinary rule publication still invalidates cached originals', async () => {
    const dnr = deferDnr();
    const pending = publishRulesChanged(input);
    await dnr.entered;
    originalCache.set(asset, 'old source');
    dnr.release();
    await pending;
    assert.equal(await getOriginalText(asset), 'fresh source');
    assert.equal(fetches, 1);
  });
}
