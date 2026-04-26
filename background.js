// background.js — SFV-Interceptor v8.0
// Multi-pair rules: each rule has pairs[], each pair has its own urlPattern + responseBody.
// Backwards compatible: old single-pattern rules are auto-migrated to pairs[] on load.

'use strict';

const STORAGE_KEY = 'sfvi_rules';

// ── LRU-capped Map ────────────────────────────────────────────────────────────
class LRUMap {
  constructor(max) { this._max = max; this._map = new Map(); }
  has(k) { return this._map.has(k); }
  get(k) {
    if (!this._map.has(k)) return undefined;
    const v = this._map.get(k); this._map.delete(k); this._map.set(k, v); return v;
  }
  set(k, v) {
    if (this._map.has(k)) this._map.delete(k);
    else if (this._map.size >= this._max) this._map.delete(this._map.keys().next().value);
    this._map.set(k, v);
  }
  delete(k) { return this._map.delete(k); }
  clear()   { this._map.clear(); }
}

const originalCache   = new LRUMap(40);
const htmlCache       = new LRUMap(60);
const pendingHtml     = new LRUMap(60);
const pendingOriginal = new LRUMap(40);

// ── Storage ───────────────────────────────────────────────────────────────────

function migrateRule(rule) {
  // Add resourceSubtype default for existing html rules
  if (rule.resourceType === 'html' && !rule.resourceSubtype) {
    rule = { ...rule, resourceSubtype: 'html' };
  }
  if (Array.isArray(rule.pairs) && rule.pairs.length) return rule;
  // Old format: flat fields → wrap in pairs[]
  return {
    id:           rule.id,
    name:         rule.name,
    enabled:      rule.enabled,
    resourceType: rule.resourceType || 'rest',
    pairs: [{
      id:           'pair_' + (rule.id || 'migrated'),
      urlPattern:   rule.urlPattern   || '',
      urlOperator:  rule.urlOperator  || 'Contains',
      method:       rule.method       || '',
      responseType: rule.responseType || 'static',
      responseBody: rule.responseBody || '',
      statusCode:   rule.statusCode   || '',
      delay:        parseInt(rule.delay) || 0,
    }],
  };
}

let _rulesCache = null;

async function getRules() {
  if (_rulesCache) return _rulesCache;
  return new Promise(r =>
    chrome.storage.local.get([STORAGE_KEY], d => {
      const raw = d[STORAGE_KEY] || [];
      _rulesCache = raw.map(migrateRule);
      r(_rulesCache);
    })
  );
}
async function saveRules(rules) {
  _rulesCache = null;
  return new Promise(r => chrome.storage.local.set({ [STORAGE_KEY]: rules }, r));
}
function generateId() {
  return 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}
function generatePairId() {
  return 'pair_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// ── URL matching (per pair) ───────────────────────────────────────────────────

function urlMatchesPair(url, pair) {
  const pat = pair.urlPattern || '', op = pair.urlOperator || 'Contains';
  const cs  = pair.caseSensitive || false;
  if (!pat) return false;
  const u = cs ? url : url.toLowerCase();
  const p = cs ? pat : pat.toLowerCase();
  if (op === 'Equals')   return u === p;
  if (op === 'Contains') return u.includes(p);
  if (op === 'Regex')    { try { return new RegExp(pat, cs ? '' : 'i').test(url); } catch { return false; } }
  const re = '^' + p.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*') + '$';
  try { return new RegExp(re).test(u); } catch { return false; }
}

function pairToRegexFilter(pair) {
  const pat = pair.urlPattern || '', op = pair.urlOperator || 'Contains';
  const cs  = pair.caseSensitive || false;
  if (!pat) return null;
  if (op === 'Regex')    return pat;
  const escapeNoStar = s => s.replace(/[-/\^$+?.()|[\]{}]/g, '\\$&');
  if (op === 'Equals')   return '^' + escapeNoStar(pat) + '$';
  if (op === 'Wildcard') return escapeNoStar(pat).replace(/\*/g, '.*');
  return escapeNoStar(pat); // Contains — match anywhere
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const ICON_BLUE  = { 16:'icons/icon16.png',  48:'icons/icon48.png',  128:'icons/icon128.png'  };
const ICON_GREEN = { 16:'icons/icon16g.png', 48:'icons/icon48g.png', 128:'icons/icon128g.png' };
function setIcon(tabId, green) {
  chrome.tabs.get(tabId, () => {
    if (chrome.runtime.lastError) return;
    chrome.action.setIcon({ tabId, path: green ? ICON_GREEN : ICON_BLUE }).catch(() => {});
  });
}
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') setIcon(tabId, false);
});

// ── DNR: block matching scripts (one entry per pair) ──────────────────────────

// stableId: synchronous, collision-resistant DNR ID from (ruleId, pairId).
// Uses two independent 32-bit hashes (FNV-1a + djb2) XOR'd together, mapped to
// [1, 2147483647]. The birthday collision probability at 10,000 rules is ~1 in
// 2 billion — negligible. Sync avoids the race conditions and storage latency
// of the async counter approach.
function stableId(ruleId, pairId) {
  const str = ruleId + '\x00' + pairId;
  // FNV-1a 32-bit
  let h1 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h1 ^= str.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  // djb2 variant
  let h2 = 5381;
  for (let i = 0; i < str.length; i++) {
    h2 = (Math.imul(h2, 33) ^ str.charCodeAt(i)) >>> 0;
  }
  return ((h1 ^ h2) % 2147483646) + 1;
}

async function rebuildDNR() {
  const rules = await getRules();
  const toAdd = [];
  for (const rule of rules) {
    if (rule.enabled === false || rule.resourceType !== 'html') continue;
    const sub = rule.resourceSubtype || 'js';
    // html subtype = page-inject, no DNR block needed
    if (sub === 'html') continue;
    const dnrTypes = sub === 'css' ? ['stylesheet'] : ['script'];
    for (const pair of (rule.pairs || [])) {
      const pat = pair.urlPattern || '';
      if (!pat) continue;
      const regexFilter = pairToRegexFilter(pair);
      if (!regexFilter) continue;
      toAdd.push({
        id:       stableId(rule.id, pair.id),
        priority: 1,
        action:   { type: 'block' },
        condition: {
          regexFilter,
          resourceTypes: dnrTypes,
          isUrlFilterCaseSensitive: pair.caseSensitive || false,
        },
      });
    }
  }
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map(r => r.id),
      addRules:      toAdd,
    });
    console.log('[SFV-I SW] DNR:', toAdd.length, 'block rule(s)');
    originalCache.clear(); htmlCache.clear(); pendingHtml.clear(); pendingOriginal.clear();
  } catch(e) { console.error('[SFV-I SW] DNR failed:', e.message); }
}

// ── Script URL discovery ──────────────────────────────────────────────────────

async function getScriptUrlsForPage(pageUrl) {
  let cacheKey;
  try { const u = new URL(pageUrl); cacheKey = u.origin + u.pathname; } catch { return []; }
  if (htmlCache.has(cacheKey)) return htmlCache.get(cacheKey);
  if (pendingHtml.has(cacheKey)) return pendingHtml.get(cacheKey);
  const promise = (async () => {
    let html = '';
    try { const res = await fetch(pageUrl, { cache:'no-store' }); html = await res.text(); }
    catch(e) { pendingHtml.delete(cacheKey); return []; }
    const urls = [];
    // Scripts
    const reScript = /<script[^>]+src\s*=\s*["']([^"']+)["'][^>]*/gi; let m;
    while ((m = reScript.exec(html)) !== null) { try { urls.push(new URL(m[1], pageUrl).href); } catch {} }
    // Stylesheets
    const reStyle = /<link[^>]+rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*/gi;
    while ((m = reStyle.exec(html)) !== null) { try { urls.push(new URL(m[1], pageUrl).href); } catch {} }
    const reStyle2 = /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["'][^>]*/gi;
    while ((m = reStyle2.exec(html)) !== null) { try { const u = new URL(m[1], pageUrl).href; if (!urls.includes(u)) urls.push(u); } catch {} }
    htmlCache.set(cacheKey, urls); pendingHtml.delete(cacheKey); return urls;
  })();
  pendingHtml.set(cacheKey, promise); return promise;
}

async function getOriginalText(assetUrl, referer) {
  if (originalCache.has(assetUrl)) return originalCache.get(assetUrl);
  if (pendingOriginal.has(assetUrl)) return pendingOriginal.get(assetUrl);
  const promise = (async () => {
    try {
      const headers = { 'Cache-Control': 'no-store' };
      if (referer) headers['Referer'] = referer;
      const r = await fetch(assetUrl, { cache:'no-store', headers });
      const ct = r.headers.get('content-type') || '';
      const text = await r.text();
      const first = text.trimStart()[0];
      console.log('[SFV-I SW] fetch', assetUrl.split('/').pop().split('?')[0],
        '→ status:', r.status, '| ct:', ct, '| size:', (text.length/1024).toFixed(0)+'KB', '| first char:', JSON.stringify(first));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (first === '<') throw new Error('got HTML instead of JS');
      originalCache.set(assetUrl, text); pendingOriginal.delete(assetUrl);
      return text;
    } catch(e) {
      console.warn('[SFV-I SW] getOriginalText failed for', assetUrl.split('/').pop().split('?')[0], ':', e.message);
      pendingOriginal.delete(assetUrl); return null;
    }
  })();
  pendingOriginal.set(assetUrl, promise); return promise;
}

// ── onBeforeNavigate: warm caches ─────────────────────────────────────────────

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const pageUrl = details.url;
  if (!pageUrl || /^(chrome|about|devtools|chrome-extension):/.test(pageUrl)) return;

  // Clear asset cache on each navigation so stale/failed fetches are retried
  originalCache.clear();
  pendingOriginal.clear();

  const [rules, scriptUrls] = await Promise.all([getRules(), getScriptUrlsForPage(pageUrl)]);
  const htmlRules = rules.filter(r => r.enabled !== false && r.resourceType === 'html');
  if (!htmlRules.length) return;

  for (const rule of htmlRules) {
    const sub = rule.resourceSubtype || 'js';
    if (sub === 'html') continue;
    const extFilter = sub === 'css'
      ? u => /\.css(\?|$)/i.test(u)
      : u => /\.js(\?|$)/i.test(u);
    for (const pair of (rule.pairs || [])) {
      for (const url of scriptUrls.filter(u => extFilter(u) && urlMatchesPair(u, pair))) {
        getOriginalText(url, pageUrl);
      }
    }
  }
});

// ── onCommitted: inject ───────────────────────────────────────────────────────

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const pageUrl = details.url;
  if (!pageUrl || /^(chrome|about|devtools|chrome-extension):/.test(pageUrl)) return;

  const tabId = details.tabId;
  const [rules, scriptUrls] = await Promise.all([getRules(), getScriptUrlsForPage(pageUrl)]);
  const htmlRules = rules.filter(r => r.enabled !== false && r.resourceType === 'html');
  if (!htmlRules.length) return;

  // Build matches: one entry per (rule, pair, assetUrl)
  const matches = [];
  for (const rule of htmlRules) {
    const sub = rule.resourceSubtype || 'js';
    for (const pair of (rule.pairs || [])) {
      if (sub === 'html') {
        // Page-inject: fires on the page URL itself, not on asset URLs
        if (urlMatchesPair(pageUrl, pair)) {
          matches.push({ assetUrl: pageUrl, ruleId: rule.id, pairId: pair.id, isPageInject: true });
        }
      } else {
        // JS or CSS: match asset URLs filtered by extension
        const extFilter = sub === 'css'
          ? u => /\.css(\?|$)/i.test(u)
          : u => /\.js(\?|$)/i.test(u);
        for (const url of scriptUrls.filter(u => extFilter(u) && urlMatchesPair(u, pair))) {
          matches.push({ assetUrl: url, ruleId: rule.id, pairId: pair.id, isPageInject: false });
        }
      }
    }
  }
  if (!matches.length) return;

  await Promise.all([
    chrome.scripting.executeScript({ target: { tabId, allFrames: false }, world: 'MAIN', injectImmediately: true, files: ['page-hook.js'] }).catch(() => {}),
    ...matches.filter(m => !m.isPageInject).map(m => getOriginalText(m.assetUrl, pageUrl)),
  ]);

  await Promise.all(matches.map(async ({ assetUrl, ruleId, pairId, isPageInject }) => {
    const rule = rules.find(r => r.id === ruleId && r.enabled !== false);
    if (!rule) return;
    const pair = (rule.pairs || []).find(p => p.id === pairId);
    if (!pair) return;

    const file = isPageInject
      ? new URL(assetUrl).pathname.split('/').filter(Boolean).pop() || 'page'
      : assetUrl.split('/').pop().split('?')[0];

    if (isPageInject) {
      const modifyCode = pair.responseBody || '';
      if (!modifyCode) return;
      try {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: false }, world: 'MAIN', injectImmediately: true,
          args: [modifyCode, assetUrl, file, rule.name],
          func: function(modifyCode, pageUrl, file, ruleName) {
            function _t(i,sl,a,b,c){const s=Reflect.ownKeys(window).reduce((f,k)=>{if(f)return f;try{return(typeof k==='symbol'&&window[k]?._sfvi===1)?window[k]:null}catch{return null}},null);if(s?.toast)s.toast(i,sl,a,b,c);}
            try {
              const fn = new Function(modifyCode + '\nreturn modifyResponse(arguments[0]);');
              fn({ method:'GET', url:pageUrl, response:'', responseType:'text/html', requestHeaders:{}, requestData:null, responseJSON:null });
              _t('⚡', 'Page Injected', ruleName, file + ' · html', '#60a5fa');
            } catch(e) { console.error('[SFV-Interceptor] page inject error:', e.message); }
          },
        });
        setIcon(tabId, true);
      } catch(e) { console.error('[SFV-I SW] page inject failed:', e.message); }
      return;
    }

    const original = await getOriginalText(assetUrl, pageUrl);

    // ── Fallback: SW can't fetch the asset (server requires browser cookies/headers).
    // Inject into the page context which has full cookie jar + correct origin headers.
    if (original === null) {
      const modifyCode = pair.responseType === 'static' ? null : (pair.responseBody || '');
      const staticBody = pair.responseType === 'static' ? (pair.responseBody || '') : null;
      if (!modifyCode && staticBody === null) return;
      try {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: false }, world: 'MAIN', injectImmediately: true,
          args: [modifyCode, staticBody, assetUrl, file, rule.name],
          func: async function(modifyCode, staticBody, assetUrl, file, ruleName) {
            function _t(i,sl,a,b,c){const s=Reflect.ownKeys(window).reduce((f,k)=>{if(f)return f;try{return(typeof k==='symbol'&&window[k]?._sfvi===1)?window[k]:null}catch{return null}},null);if(s?.toast)s.toast(i,sl,a,b,c);}
            function execViaBlob(code, label) {
              const src  = code + '\n//# sourceURL=sfvi-patched/' + label;
              const blob = new Blob([src], { type: 'text/javascript' });
              const url  = URL.createObjectURL(blob);
              const s    = document.createElement('script');
              s.src = url;
              s.onload  = () => { URL.revokeObjectURL(url); s.remove(); };
              s.onerror = () => { URL.revokeObjectURL(url); s.remove();
                console.error('[SFV-Interceptor] blob error in', label); };
              (document.head || document.documentElement).appendChild(s);
            }
            try {
              const resp = await fetch(assetUrl, {
                method: 'GET', credentials: 'include', cache: 'no-store',
                headers: { 'Accept': '*/*', 'Referer': location.href },
                mode: 'same-origin',
              });
              if (!resp.ok) throw new Error('HTTP ' + resp.status);
              const ct = resp.headers.get('content-type') || '';
              const original = await resp.text();
              if (original.trimStart()[0] === '<') throw new Error('server returned HTML — cannot fetch JS');
              let patched = original;
              if (staticBody !== null) {
                patched = staticBody;
              } else if (modifyCode) {
                const fn = new Function(modifyCode + '\nreturn modifyResponse(arguments[0]);');
                const res = fn({ method:'GET', url:assetUrl, response:original, responseType:ct, requestHeaders:{}, requestData:null, responseJSON:null });
                if (res != null) patched = typeof res === 'string' ? res : JSON.stringify(res);
              }
              const changed = patched !== original;
              if (changed) _t('📦', 'JS Patched', ruleName, file + ' · js', '#fbbf24');
              execViaBlob(patched, file);
            } catch(e) {
              console.error('[SFV-Interceptor] in-page fetch/blob error in', file, ':', e.message);
            }
          },
        });
        setIcon(tabId, true);
      } catch(e) { console.error('[SFV-I SW] in-page executeScript failed for', file, ':', e.message); }
      return;
    }

    const modifyCode = pair.responseType === 'static' ? null : (pair.responseBody || '');
    const staticBody = pair.responseType === 'static' ? (pair.responseBody || '') : null;

    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: false }, world: 'MAIN', injectImmediately: true,
        args: [original, modifyCode, staticBody, assetUrl, file, rule.name],
        func: function(original, modifyCode, staticBody, assetUrl, file, ruleName) {
          function _t(i,sl,a,b,c){const s=Reflect.ownKeys(window).reduce((f,k)=>{if(f)return f;try{return(typeof k==='symbol'&&window[k]?._sfvi===1)?window[k]:null}catch{return null}},null);if(s?.toast)s.toast(i,sl,a,b,c);}
          function execViaBlob(code, label) {
            const src  = code + '\n//# sourceURL=sfvi-patched/' + label;
            const blob = new Blob([src], { type: 'text/javascript' });
            const url  = URL.createObjectURL(blob);
            const s    = document.createElement('script');
            s.src = url;
            s.onload  = () => { URL.revokeObjectURL(url); s.remove(); };
            s.onerror = () => { URL.revokeObjectURL(url); s.remove();
              console.error('[SFV-Interceptor] blob error in', label); };
            (document.head || document.documentElement).appendChild(s);
          }
          let patched = original;
          if (staticBody !== null) {
            patched = staticBody;
          } else if (modifyCode) {
            try {
              const fn = new Function(modifyCode + '\nreturn modifyResponse(arguments[0]);');
              const res = fn({ method:'GET', url:assetUrl, response:original, responseType:'text/javascript', requestHeaders:{}, requestData:null, responseJSON:null });
              if (res != null) patched = typeof res === 'string' ? res : JSON.stringify(res);
            } catch(e) { console.error('[SFV-Interceptor] modifyResponse error in', file, ':', e.message); }
          }
          const changed = patched !== original;
          if (changed) _t('📦', 'JS Patched', ruleName, file + ' · js', '#fbbf24');
          execViaBlob(patched, file);
        },
      });
      setIcon(tabId, true);
    } catch(e) { console.error('[SFV-I SW] executeScript failed for', file, ':', e.message); }
  }));
});

// ── API rules for page-hook ───────────────────────────────────────────────────

async function getApiRules() {
  const rules = await getRules();
  const result = [];
  for (const rule of rules) {
    if (rule.enabled === false || rule.resourceType === 'html') continue;
    for (const pair of (rule.pairs || [])) {
      if (!pair.urlPattern) continue;
      const regexFilter = pairToRegexFilter(pair);
      if (!regexFilter) continue;
      result.push({
        id:            rule.id + '|' + pair.id,
        regex:         regexFilter,
        method:        pair.method        || '',
        responseType:  pair.responseType  || 'static',
        responseBody:  pair.responseBody  || '',
        statusCode:    pair.statusCode    || 200,
        delay:         parseInt(pair.delay) || 0,
        gqlOperation:  pair.gqlOperation  || '',
        customHeaders: pair.customHeaders || '',
      });
    }
  }
  return result;
}

// ── Notify all extension pages ────────────────────────────────────────────────

function notifyRulesChanged() {
  chrome.runtime.sendMessage({ type: 'RULES_CHANGED' }).catch(() => {});
}

// ── Push updated API rules to open tabs ──────────────────────────────────────

async function pushRulesToActiveTab(changedRule) {
  const apiRules = await getApiRules();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url || /^(chrome|chrome-extension|about|devtools):/.test(tab.url)) continue;
    if (changedRule) {
      const tabMatches = (changedRule.pairs || []).some(pair => urlMatchesPair(tab.url, pair));
      if (!tabMatches) { if (!apiRules.length) setIcon(tab.id, false); continue; }
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page-hook.js'], world: 'MAIN' });
    } catch {}
    try {
      await chrome.tabs.sendMessage(tab.id, { type: '__sfvi_push_rules__', apis: apiRules });
    } catch {}
    if (!apiRules.length) setIcon(tab.id, false);
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

const MUTATION_TYPES = new Set(['IMPORT_RULES', 'MERGE_RULES', 'SAVE_RULE', 'DELETE_RULE', 'TOGGLE_RULE']);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (MUTATION_TYPES.has(msg.type) && sender.tab) {
      sendResponse({ error: 'unauthorized' }); return;
    }
    const tabId = sender.tab?.id;
    switch (msg.type) {

      case 'GET_API_RULES': sendResponse({ rules: await getApiRules() }); break;

      case 'INJECT_HOOK': {
        if (!tabId) { sendResponse({ ok: false }); break; }
        try {
          await chrome.scripting.executeScript({ target:{tabId}, files:['page-hook.js'], world:'MAIN' });
          sendResponse({ ok: true });
        } catch(e) { sendResponse({ ok: false, error: e.message }); }
        break;
      }

      case 'RULE_APPLIED':
        if (tabId) setIcon(tabId, true);
        sendResponse({ ok: true });
        break;

      case 'GET_RULES':    sendResponse({ rules: await getRules() }); break;
      case 'EXPORT_RULES': sendResponse({ rules: await getRules() }); break;

      case 'IMPORT_RULES':
        await saveRules(msg.rules.map(migrateRule)); await rebuildDNR();
        sendResponse({ ok: true }); break;

      case 'MERGE_RULES': {
        const existing = await getRules();
        const incoming = (msg.rules || []).map(migrateRule);
        const strategy = msg.strategy || 'skip';
        const merged   = [...existing];
        let added = 0, updated = 0, skipped = 0;
        for (const r of incoming) {
          const idx = merged.findIndex(e => e.id === r.id);
          if (idx >= 0) {
            if (strategy === 'overwrite') { merged[idx] = r; updated++; }
            else skipped++;
          } else { merged.push(r); added++; }
        }
        await saveRules(merged); await rebuildDNR(); notifyRulesChanged();
        sendResponse({ ok: true, added, updated, skipped }); break;
      }

      case 'SAVE_RULE': {
        const rules = await getRules();
        const rule  = migrateRule(msg.rule);
        if (!rule.id) rule.id = generateId();
        // Ensure all pairs have IDs
        rule.pairs = (rule.pairs || []).map(p => ({ ...p, id: p.id || generatePairId() }));
        const idx = rules.findIndex(r => r.id === rule.id);
        if (idx >= 0) rules[idx] = rule; else rules.push(rule);
        await saveRules(rules); await rebuildDNR(); notifyRulesChanged();
        await pushRulesToActiveTab(rule);
        sendResponse({ ok: true, rule }); break;
      }

      case 'DELETE_RULE': {
        const rules = await getRules();
        await saveRules(rules.filter(r => r.id !== msg.id));
        await rebuildDNR(); notifyRulesChanged(); sendResponse({ ok: true }); break;
      }

      case 'TOGGLE_RULE': {
        const rules = await getRules();
        const rule  = rules.find(r => r.id === msg.id);
        if (rule) rule.enabled = !rule.enabled;
        await saveRules(rules); await rebuildDNR(); notifyRulesChanged();
        // If disabling, immediately reset icon to blue on all tabs
        if (!rule?.enabled) {
          const allTabs = await chrome.tabs.query({});
          for (const t of allTabs) {
            if (t.id && t.url && !/^(chrome|chrome-extension|about|devtools):/.test(t.url)) {
              setIcon(t.id, false);
            }
          }
        }
        await pushRulesToActiveTab(rule);
        sendResponse({ ok: true, enabled: rule?.enabled ?? false }); break;
      }

      default: sendResponse({ error: 'unknown: ' + msg.type });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => rebuildDNR());
chrome.runtime.onStartup.addListener(()   => rebuildDNR());
