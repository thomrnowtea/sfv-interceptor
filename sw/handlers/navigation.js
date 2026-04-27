import { getRules } from '../core/rules.js';
import { urlMatchesPair } from '../core/matcher.js';
import { getScriptUrlsForPage, getOriginalText, originalCache, pendingOriginal } from '../cache/assets.js';
import { setIcon } from './icons.js';

export function initNavigation() {
  chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId !== 0) return;
    const pageUrl = details.url;
    if (!pageUrl || /^(chrome|about|devtools|chrome-extension):/.test(pageUrl)) return;

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

  chrome.webNavigation.onCommitted.addListener(async (details) => {
    if (details.frameId !== 0) return;
    const pageUrl = details.url;
    if (!pageUrl || /^(chrome|about|devtools|chrome-extension):/.test(pageUrl)) return;

    const tabId = details.tabId;
    const [rules, scriptUrls] = await Promise.all([getRules(), getScriptUrlsForPage(pageUrl)]);
    const htmlRules = rules.filter(r => r.enabled !== false && r.resourceType === 'html');
    if (!htmlRules.length) return;

    const matches = [];
    for (const rule of htmlRules) {
      const sub = rule.resourceSubtype || 'js';
      for (const pair of (rule.pairs || [])) {
        if (sub === 'html') {
          if (urlMatchesPair(pageUrl, pair))
            matches.push({ assetUrl: pageUrl, ruleId: rule.id, pairId: pair.id, isPageInject: true });
        } else {
          const extFilter = sub === 'css'
            ? u => /\.css(\?|$)/i.test(u)
            : u => /\.js(\?|$)/i.test(u);
          for (const url of scriptUrls.filter(u => extFilter(u) && urlMatchesPair(u, pair)))
            matches.push({ assetUrl: url, ruleId: rule.id, pairId: pair.id, isPageInject: false });
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

      if (original === null) {
        const modifyCode = pair.responseType === 'static' ? null : (pair.responseBody || '');
        const staticBody = pair.responseType === 'static' ? (pair.responseBody || '') : null;
        if (!modifyCode && staticBody === null) return;
        try {
          await chrome.scripting.executeScript({
            target: { tabId, allFrames: false }, world: 'MAIN', injectImmediately: true,
            args: [modifyCode, staticBody, assetUrl, file, rule.name, rule.resourceSubtype || 'js'],
            func: async function(modifyCode, staticBody, assetUrl, file, ruleName, resType) {
              function _t(i,sl,a,b,c){const s=Reflect.ownKeys(window).reduce((f,k)=>{if(f)return f;try{return(typeof k==='symbol'&&window[k]?._sfvi===1)?window[k]:null}catch{return null}},null);if(s?.toast)s.toast(i,sl,a,b,c);}
              function execViaBlob(code, label) {
                const src  = code + '\n//# sourceURL=sfvi-patched/' + label;
                const blob = new Blob([src], { type: 'text/javascript' });
                const url  = URL.createObjectURL(blob);
                const s    = document.createElement('script');
                s.src = url;
                s.onload  = () => { URL.revokeObjectURL(url); s.remove(); };
                s.onerror = () => { URL.revokeObjectURL(url); s.remove(); console.error('[SFV-Interceptor] blob error in', label); };
                (document.head || document.documentElement).appendChild(s);
              }
              try {
                const resp = await fetch(assetUrl, {
                  method: 'GET', credentials: 'include', cache: 'no-store',
                  headers: { 'Accept': '*/*', 'Referer': location.href }, mode: 'same-origin',
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
                if (changed) _t('📦', resType === 'css' ? 'CSS Patched' : 'JS Patched', ruleName, file + ' · ' + resType, '#fbbf24');
                execViaBlob(patched, file);
              } catch(e) { console.error('[SFV-Interceptor] in-page fetch/blob error in', file, ':', e.message); }
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
          args: [original, modifyCode, staticBody, assetUrl, file, rule.name, rule.resourceSubtype || 'js'],
          func: function(original, modifyCode, staticBody, assetUrl, file, ruleName, resType) {
            function _t(i,sl,a,b,c){const s=Reflect.ownKeys(window).reduce((f,k)=>{if(f)return f;try{return(typeof k==='symbol'&&window[k]?._sfvi===1)?window[k]:null}catch{return null}},null);if(s?.toast)s.toast(i,sl,a,b,c);}
            function execViaBlob(code, label) {
              const src  = code + '\n//# sourceURL=sfvi-patched/' + label;
              const blob = new Blob([src], { type: 'text/javascript' });
              const url  = URL.createObjectURL(blob);
              const s    = document.createElement('script');
              s.src = url;
              s.onload  = () => { URL.revokeObjectURL(url); s.remove(); };
              s.onerror = () => { URL.revokeObjectURL(url); s.remove(); console.error('[SFV-Interceptor] blob error in', label); };
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
            if (changed) _t('📦', resType === 'css' ? 'CSS Patched' : 'JS Patched', ruleName, file + ' · ' + resType, '#fbbf24');
            execViaBlob(patched, file);
          },
        });
        setIcon(tabId, true);
      } catch(e) { console.error('[SFV-I SW] executeScript failed for', file, ':', e.message); }
    }));
  });
}
