// content.js — ISOLATED world, document_start
// JS file patching: handled by DNR → SW proxy (no JS involvement needed)
// API mocking (REST/GraphQL): page-hook.js injected into MAIN world

'use strict';

(async () => {
  const origin = location.origin && location.origin !== 'null' ? location.origin : '*';
  const themes = import(chrome.runtime.getURL('shared/themes.js'));
  const font = fetch(chrome.runtime.getURL('shared/fonts/manrope-latin-wght-normal.woff2')).then(response => {
    if (!response.ok) throw new Error('Font unavailable');
    return response.arrayBuffer();
  }).catch(() => null);
  async function sendPresentation() {
    try {
      const [themeModule, stored] = await Promise.all([themes, chrome.storage.local.get(['sfvi_theme','sfvi_theme_vars','sfvi_theme_custom'])]);
      window.postMessage({type:'__sfvi_theme__',vars:themeModule.resolveTheme(stored)},origin);
    } catch {}
    try { const bytes=await font; if (bytes) window.postMessage({type:'__sfvi_font__',bytes},origin); } catch {}
  }
  window.addEventListener('message', event => {
    if (event.source === window && event.data?.type === '__sfvi_hook_ready__') sendPresentation();
  });
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area === 'local' && (changes.sfvi_theme || changes.sfvi_theme_vars || changes.sfvi_theme_custom)) sendPresentation();
  });
  sendPresentation();
  let data, handshake = 0;
  const send = () => {
    if (data) window.postMessage({type:'__sfvi_hook_data__',apis:data.rules,activity:data.activity},origin);
  };
  async function refreshRules() {
    const request = ++handshake;
    try {
      const next = await chrome.runtime.sendMessage({type:'GET_API_RULES'});
      if (request !== handshake || !next?.rules) return;
      data = next;
      if (data.rules.length) createSandboxIframe();
      send();
    } catch {}
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'ACTIVITY_CYCLE_CHANGED') refreshRules();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) refreshRules(); });
  window.addEventListener('message',event => {
    if (event.source === window && event.data?.type === '__sfvi_hook_ready__') send();
  });
  refreshRules();
})();

window.addEventListener('__sfvi_applied__', event => {
  const detail = event.detail;
  if (!detail || typeof detail.ruleId !== 'string') return;
  try { chrome.runtime.sendMessage({ type: 'RULE_APPLIED', ruleId: detail.ruleId, pairId: detail.pairId, activity: detail.activity }).catch(() => {}); } catch {}
});

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
