// content.js — ISOLATED world, document_start
// JS file patching: handled by DNR → SW proxy (no JS involvement needed)
// API mocking (REST/GraphQL): page-hook.js injected into MAIN world

'use strict';

(async () => {
  let data;
  try { data = await chrome.runtime.sendMessage({ type: 'GET_API_RULES' }); }
  catch(e) { return; }

  if (!data?.rules?.length) return;

  try { await chrome.runtime.sendMessage({ type: 'INJECT_HOOK' }); } catch {}

  function send() {
    window.postMessage({ type: '__sfvi_hook_data__', patches: {}, scripts: [], apis: data.rules }, '*');
  }
  send();
  window.addEventListener('message', function h(ev) {
    if (ev?.data?.type === '__sfvi_hook_ready__') { window.removeEventListener('message', h); send(); }
  });
})();

window.addEventListener('__sfvi_applied__', () => {
  chrome.runtime.sendMessage({ type: 'RULE_APPLIED' }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === '__sfvi_push_rules__') {
    window.postMessage({ type: '__sfvi_hook_data__', patches: {}, scripts: [], apis: msg.apis }, '*');
  }
});
