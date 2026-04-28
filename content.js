// content.js — ISOLATED world, document_start
// JS file patching: handled by DNR → SW proxy (no JS involvement needed)
// API mocking (REST/GraphQL): page-hook.js injected into MAIN world

'use strict';

(async () => {
  let data;
  try { data = await chrome.runtime.sendMessage({ type: 'GET_API_RULES' }); }
  catch(e) { return; }

  if (!data?.rules?.length) return;

  async function sendTheme() {
    try {
      const td = await chrome.storage.local.get('sfvi_theme_vars');
      if (td.sfvi_theme_vars) {
        window.postMessage({ type: '__sfvi_theme__', vars: td.sfvi_theme_vars }, location.origin);
      }
    } catch {}
  }

  function send() {
    window.postMessage({ type: '__sfvi_hook_data__', patches: {}, scripts: [], apis: data.rules }, location.origin);
  }
  send();
  sendTheme();
  window.addEventListener('message', function h(ev) {
    if (ev?.data?.type === '__sfvi_hook_ready__') { window.removeEventListener('message', h); send(); sendTheme(); }
  });
})();

let _lastRuleApplied = 0;
window.addEventListener('__sfvi_applied__', () => {
  const now = Date.now();
  if (now - _lastRuleApplied < 500) return;
  _lastRuleApplied = now;
  try { chrome.runtime.sendMessage({ type: 'RULE_APPLIED' }).catch(() => {}); } catch {}
});

try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === '__sfvi_push_rules__') {
      window.postMessage({ type: '__sfvi_hook_data__', patches: {}, scripts: [], apis: msg.apis }, location.origin);
    }
  });
} catch {}

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.sfvi_theme_vars) {
      window.postMessage({ type: '__sfvi_theme__', vars: changes.sfvi_theme_vars.newValue }, location.origin);
    }
  });
} catch {}
