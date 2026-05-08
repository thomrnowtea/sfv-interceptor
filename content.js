// content.js — ISOLATED world, document_start
// JS file patching: handled by DNR → SW proxy (no JS involvement needed)
// API mocking (REST/GraphQL): page-hook.js injected into MAIN world

'use strict';

(async () => {
  let data;
  try { data = await chrome.runtime.sendMessage({ type: 'GET_API_RULES' }); }
  catch(e) { return; }

  if (!data?.rules?.length) return;

  const _origin = location.origin || '*';

  async function sendTheme() {
    try {
      const td = await chrome.storage.local.get('sfvi_theme_vars');
      if (td.sfvi_theme_vars) {
        window.postMessage({ type: '__sfvi_theme__', vars: td.sfvi_theme_vars }, _origin);
      }
    } catch {}
  }

  function send() {
    window.postMessage({ type: '__sfvi_hook_data__', patches: {}, scripts: [], apis: data.rules }, _origin);
  }
  createSandboxIframe();
  send();
  sendTheme();
  window.addEventListener('message', function h(ev) {
    if (ev?.data?.type === '__sfvi_hook_ready__') {
      window.removeEventListener('message', h); send(); sendTheme();
    }
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
  const _origin2 = location.origin || '*';
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.sfvi_theme_vars) {
      window.postMessage({ type: '__sfvi_theme__', vars: changes.sfvi_theme_vars.newValue }, _origin2);
    }
  });
} catch {}

function createSandboxIframe() {
  if (document.getElementById('__sfvi_sandbox__')) return;
  if (location.protocol === 'chrome-extension:') return;
  if (document.documentElement?.dataset?.sfviSandbox) return;
  const iframe = document.createElement('iframe');
  iframe.id = '__sfvi_sandbox__';
  iframe.src = chrome.runtime.getURL('sandbox/sandbox.html');
  iframe.style.display = 'none';
  if (document.documentElement) {
    document.documentElement.appendChild(iframe);
  } else {
    const tryAppend = () => {
      if (document.documentElement) document.documentElement.appendChild(iframe);
      else requestAnimationFrame(tryAppend);
    };
    requestAnimationFrame(tryAppend);
  }
}
