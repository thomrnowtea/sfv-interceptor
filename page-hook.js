// page-hook.js — MAIN world (injected via chrome.scripting executeScript files:[])
// Injected by the extension; page font and style policies still need explicit handling.

(function () {
  'use strict';

  // ── Stealth: Symbol-keyed state container, persisted across re-injections ──
  let _s = Reflect.ownKeys(window).reduce((f, k) => {
    if (f) return f;
    try { return (typeof k === 'symbol' && window[k]?._sfvi === 1) ? window[k] : null; }
    catch { return null; }
  }, null);

  if (!_s) {
    _s = {
      _sfvi:       1,
      installed:   false,
      nativeFetch: window.fetch.bind(window),
      NativeXHR:   window.XMLHttpRequest,
      toast:       null,   // set to _sfviToast below
      _toastFn:    null,   // set after _initToasts() runs
    };
    Object.defineProperty(window, Symbol(), {
      value: _s, enumerable: false, configurable: false, writable: false,
    });
  }

  const _nativeFetch = _s.nativeFetch;
  const _NativeXHR   = _s.NativeXHR;

  const _origin = location.origin || '*';
  if (_s.installed) {
    window.postMessage({ type: '__sfvi_hook_ready__' }, _origin);
    return;
  }
  _s.installed = true;
  window.postMessage({ type: '__sfvi_hook_ready__' }, _origin);

  // ── Stealth: Symbol keys for XHR instance state ───────────────────────────
  const _URL    = Symbol();
  const _METHOD = Symbol();
  const _HDRS   = Symbol();
  const _ASYNC  = Symbol();

  // ── Stealth: Function.prototype.toString patch ────────────────────────────
  const _nativeToString = Function.prototype.toString;
  const _nativables     = new WeakSet();
  const _toStringPatch  = function toString() {
    if (_nativables.has(this)) return `function ${this.name || ''}() { [native code] }`;
    return _nativeToString.call(this);
  };
  _nativables.add(_toStringPatch);
  Object.defineProperty(Function.prototype, 'toString', {
    value: _toStringPatch, writable: true, configurable: true, enumerable: false,
  });

  // ── Toast notification system ─────────────────────────────────────────────
  // Pattern: customElements.define + closed Shadow DOM +
  // :host CSS for position:fixed + CSS transition triggered by class toggle.
  function _initToasts() {
    const TAG = 'sfvi-t';
    const cards = [];
    const states = new WeakMap();
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host { display:block; width:100%; opacity:0; transition:opacity 180ms ease; pointer-events:auto; }
      :host(.sfvi-in) { opacity:1; }
      :host(.sfvi-out) { opacity:0; transition-duration:120ms; }
      * { box-sizing:border-box; }
      #c { position:relative; display:grid; grid-template-columns:22px minmax(0,1fr); gap:10px; width:100%; padding:14px; overflow:hidden; appearance:none; border:1px solid var(--sfvi-border2,#363b52); border-radius:12px; background:var(--sfvi-surface,#1c1e26); color:var(--sfvi-text,#e2e4f0); box-shadow:0 8px 24px rgba(0,0,0,.22); font:400 12px/1.5 'SFVI Manrope',Manrope,sans-serif; text-align:left; cursor:pointer; touch-action:manipulation; }
      .mark { color:var(--ac,#22d3ee); margin-top:1px; }
      svg { display:block; width:20px; height:20px; }
      .status { display:block; color:var(--sfvi-text2,#c0c4d8); font-size:11px; }
      .title { display:block; font-size:13px; line-height:1.4; font-weight:600; overflow-wrap:anywhere; margin-top:2px; }
      .subtitle { display:block; color:var(--sfvi-text2,#c0c4d8); font-size:11px; margin-top:4px; overflow-wrap:anywhere; }
      .progress { position:absolute; left:0; right:0; bottom:0; height:3px; pointer-events:none; background:var(--sfvi-surface3,#292c38); }
      .progress-fill { display:block; height:100%; background:var(--ac,#22d3ee); transform-origin:left; }
      #c:focus-visible { outline:2px solid var(--ac,#22d3ee); outline-offset:-3px; }
      #c:active { background:var(--sfvi-surface2,#22252f); }
      @media(hover:hover) and (pointer:fine) { #c:hover { border-color:var(--ac,#22d3ee); } }
      @media(prefers-reduced-motion:reduce) { :host,:host(.sfvi-in),:host(.sfvi-out) { transform:none; transition:none; } }
      @media(forced-colors:active) { #c { border:1px solid CanvasText; color:ButtonText; } .progress-fill { background:Highlight; } }
    `);

    const wrap = document.createElement('div');
    wrap.dataset.sfviNotifications = '';
    const properties = {
      position:'fixed', bottom:'max(12px, env(safe-area-inset-bottom))', right:'max(12px, env(safe-area-inset-right))',
      width:'min(320px, calc(100vw - 24px))', 'max-height':'calc(100dvh - 24px)', 'overflow-y':'auto', 'overflow-x':'hidden',
      'z-index':'2147483647', 'pointer-events':'none', display:'flex', 'flex-direction':'column', gap:'8px',
      border:'none', background:'transparent', padding:'0', margin:'0', 'overscroll-behavior':'contain',
    };
    for (const [key, value] of Object.entries(properties)) wrap.style.setProperty(key, value, 'important');
    _s.toastWrap = wrap;
    for (const [key, value] of Object.entries(_s.toastTheme || {})) wrap.style.setProperty(key, value);
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
    wrap.appendChild(announcement);
    let announceTimer;

    function svg(path) {
      const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [key, value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) element.setAttribute(key,value);
      const line = document.createElementNS('http://www.w3.org/2000/svg','path');
      line.setAttribute('d',path);
      element.appendChild(line);
      return element;
    }

    function removeCard(card) {
      const index = cards.indexOf(card);
      if (index !== -1) cards.splice(index,1);
    }

    if (!customElements.get(TAG)) {
      class SfviToast extends HTMLElement {
        connectedCallback() {
          if (states.has(this)) return;
          const root = this.attachShadow({mode:'closed'});
          root.adoptedStyleSheets = [sheet];
          const card = document.createElement('button'); card.id='c'; card.type='button';
          const color=this.getAttribute('c') || '#22d3ee';
          const kind={ '#22d3ee':'rest', '#0e7490':'rest', '#34d399':'rest', '#fb7185':'gql', '#60a5fa':'html', '#9cb7ff':'html', '#fbbf24':'js', '#a78bfa':'css' }[color.toLowerCase()];
          card.style.setProperty('--ac',kind ? `var(--sfvi-t-${kind}-c,${color})` : color);
          const mark = document.createElement('span'); mark.className='mark';
          mark.appendChild(svg('M5 12l4 4L19 6'));
          const copy = document.createElement('span');
          for (const [className, attribute] of [['status','sl'],['title','ti'],['subtitle','su']]) {
            const text = document.createElement('span'); text.className=className; text.textContent=this.getAttribute(attribute) || '';
            copy.appendChild(text);
          }
          const label=['sl','ti','su'].map(attribute => this.getAttribute(attribute)).filter(Boolean).join('. ');
          card.setAttribute('aria-label',`Dismiss notification: ${label}`);
          const track=document.createElement('span'); track.className='progress'; track.setAttribute('aria-hidden','true');
          const progress=document.createElement('span'); progress.className='progress-fill'; track.appendChild(progress);
          card.append(mark,copy,track); root.appendChild(card);
          const previousFocus = document.activeElement;
          const requested = Number(this.getAttribute('d'));
          const duration = Number.isFinite(requested) && requested > 0 ? requested : 5000;
          let remaining = duration;
          const motion=matchMedia('(prefers-reduced-motion: reduce)');
          const progressAnimation=progress.animate([{transform:'scaleX(1)'},{transform:'scaleX(0)'}],{duration,easing:'linear',fill:'forwards'});
          progressAnimation.pause();
          const updateProgressMotion=() => progressAnimation.effect.updateTiming({easing:motion.matches ? `steps(${Math.max(1,Math.ceil(duration/1000))}, end)` : 'linear'});
          updateProgressMotion();
          motion.addEventListener('change',updateProgressMotion);
          let timer, exitTimer, started=0, focused=false, closing=false;
          const pause = () => {
            if (!timer) return;
            clearTimeout(timer); timer=undefined; remaining=Math.max(0,remaining-(performance.now()-started));
            progressAnimation.pause(); progressAnimation.currentTime=duration-remaining;
          };
          const resume = () => {
            if (focused || closing || timer) return;
            progressAnimation.currentTime=duration-remaining; progressAnimation.play();
            started=performance.now(); timer=setTimeout(() => dismiss(),remaining);
          };
          const dispose = () => {
            closing=true;
            clearTimeout(timer); clearTimeout(exitTimer); progressAnimation.cancel();
            motion.removeEventListener('change',updateProgressMotion); removeCard(this);
          };
          const dismiss = (immediate=false) => {
            if (closing) return;
            closing=true; pause();
            if (root.activeElement) {
              const next=cards.find(item => item !== this);
              if (next) states.get(next).action.focus();
              else if (previousFocus?.isConnected && previousFocus !== this) previousFocus.focus({preventScroll:true});
            }
            removeCard(this); this.classList.remove('sfvi-in'); this.classList.add('sfvi-out');
            if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches) this.remove();
            else exitTimer=setTimeout(() => this.remove(),140);
          };
          states.set(this,{root,action:card,dispose,dismiss}); cards.push(this);
          this.addEventListener('focusin',() => { focused=true; pause(); });
          this.addEventListener('focusout',() => queueMicrotask(() => { focused=Boolean(root.activeElement); resume(); }));
          this.addEventListener('keydown',event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(true); }
          });
          card.addEventListener('click',event => { event.stopPropagation(); dismiss(event.detail === 0); });
          requestAnimationFrame(() => { if (!closing) this.classList.add('sfvi-in'); });
          resume();
        }
        disconnectedCallback() { states.get(this)?.dispose(); }
      }
      customElements.define(TAG,SfviToast);
    }

    const attach = () => {
      if (document.documentElement) document.documentElement.appendChild(wrap);
      else requestAnimationFrame(attach);
    };
    attach();

    return function showToast(_icon,statusLabel,title,sub,color,duration) {
      if (cards.length >= 3) {
        const victim=cards.find(card => !states.get(card).root.activeElement);
        if (victim) states.get(victim).dismiss(true);
      }
      const element=document.createElement(TAG);
      for (const [key,value] of Object.entries({sl:statusLabel || 'Rule applied',ti:title || '',su:sub || '',c:color || '#22d3ee',d:String(duration || 5000)})) element.setAttribute(key,value);
      wrap.appendChild(element);
      clearTimeout(announceTimer);
      announceTimer=setTimeout(() => { announcement.textContent=`${statusLabel || 'Rule applied'}: ${title || ''}`; },120);
    };
  }

  function _loadToastFont(bytes) {
    if (_s.fontLoading || !(bytes instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > 131072) return;
    _s.fontLoading=true;
    try {
      const face=new FontFace('SFVI Manrope',bytes,{weight:'200 800',style:'normal'});
      face.load().then(loaded => document.fonts.add(loaded)).catch(() => {});
    } catch {}
  }


  // Lazy-init wrapper — exposed on _s.toast so background.js _t() helpers find it
  function _sfviToast(icon, statusLabel, title, sub, color, duration) {
    if (!_s._toastFn) {
      try { _s._toastFn = _initToasts(); }
      catch (e) { console.warn('[SFV-I] Notification initialization failed:', e.message); return false; }
    }
    _s._toastFn(icon, statusLabel, title, sub, color, duration);
    return true;
  }
  _s.toast = _sfviToast;

  const assetNotifications = new Set();
  _s.notifyAsset = ({ id, theme, statusLabel, name, sub, color }) => {
    if (!id || assetNotifications.has(id)) return false;
    if (theme) _applyThemeVars(theme);
    if (!_sfviToast('', statusLabel, name, sub, color)) return false;
    assetNotifications.add(id);
    if (assetNotifications.size > 128) assetNotifications.delete(assetNotifications.values().next().value);
    return true;
  };

  function _applyThemeVars(vars) {
    if (!vars) return;
    const root = document.documentElement;
    const map = {
      '--sfvi-bg':       vars['--bg'],
      '--sfvi-surface':  vars['--surface'],
      '--sfvi-surface2': vars['--surface2'],
      '--sfvi-surface3': vars['--surface3'],
      '--sfvi-border':   vars['--border'],
      '--sfvi-border2':  vars['--border2'],
      '--sfvi-text':     vars['--text'],
      '--sfvi-text2':    vars['--text2'],
      '--sfvi-text3':    vars['--text3'],
      '--sfvi-muted':    vars['--muted'],
      '--sfvi-accent':   vars['--accent'],
      '--sfvi-accent-link': vars['--accent-link'],
      '--sfvi-t-rest-c': vars['--t-rest-c'],
      '--sfvi-t-gql-c': vars['--t-gql-c'],
      '--sfvi-t-html-c': vars['--t-html-c'],
      '--sfvi-t-js-c': vars['--t-js-c'],
      '--sfvi-t-css-c': vars['--t-css-c'],
    };
    _s.toastTheme = Object.fromEntries(Object.entries(map).filter(([,value]) => value));
    if (_s.toastWrap) Object.entries(_s.toastTheme).forEach(([key,value]) => _s.toastWrap.style.setProperty(key,value));
  }

  function _shortUrl(abs) {
    try {
      const u     = new URL(abs);
      const parts = u.pathname.split('/').filter(Boolean);
      const last  = parts[parts.length - 1] || u.hostname;
      return last.length > 34 ? last.slice(0, 32) + '…' : last;
    } catch { return abs.slice(0, 34); }
  }

  // ── State ─────────────────────────────────────────────────────────────────
  const STATE = { apis: [], generation: 0 };
  const _regexCache = new Map();

  function updateApis(apis, activity = null) {
    const generation = activity?.configGeneration || apis[0]?.configGeneration || 0;
    // Never install or overwrite published descriptors without their own cycle.
    if (generation && !activity) return;
    if (generation < STATE.generation) return;
    STATE.generation = generation;
    STATE.apis = apis.map(rule => ({ ...rule, activity: activity ? { ...activity } : null }));
    _regexCache.clear();
    for (const rule of apis) {
      if (rule.regex) {
        try { _regexCache.set(rule.regex, new RegExp(rule.regex, 'i')); } catch {}
      }
    }
  }
  _s.updateApis = updateApis;
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      STATE.apis = [];
      _regexCache.clear();
    }
  });

  function _waitForSandbox() {
    return new Promise((resolve) => {
      function check() {
        const iframe = document.getElementById('__sfvi_sandbox__');
        if (iframe && iframe.contentWindow) resolve();
        else setTimeout(check, 50);
      }
      check();
    });
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    if (!ev.data) return;
    if (ev.data.type === '__sfvi_hook_data__') {
      if (ev.data.apis) updateApis(ev.data.apis, ev.data.activity);
    } else if (ev.data.type === '__sfvi_font__') {
      _loadToastFont(ev.data.bytes);
    } else if (ev.data.type === '__sfvi_theme__') {
      _applyThemeVars(ev.data.vars);
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function toAbs(u) {
    try { return new URL(u, location.href).href; } catch { return String(u || ''); }
  }

  function matchesRule(url, rule) {
    if (!rule.regex) return false;
    const re = _regexCache.get(rule.regex);
    if (re) return re.test(url);
    try { return new RegExp(rule.regex, 'i').test(url); } catch { return false; }
  }

  function notifyApplied(rule, url) {
    if (!rule.activity) return;
    window.dispatchEvent(new CustomEvent('__sfvi_applied__', { detail: {
      ruleId: rule.ruleId, pairId: rule.pairId, activity: rule.activity, url,
    } }));
  }

  function completeApplied(rule, url, title, status) {
    try { notifyApplied(rule, url); } catch {}
    try { _sfviToast('', 'Rule Applied', rule.name || title, title + ' \u00b7 ' + status, rule.color || '#22d3ee'); } catch {}
  }

  function buildResponse(rule, body, requestUrl) {
    const status  = parseInt(rule.statusCode) || 200;
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    if (rule.customHeaders) {
      try {
        const custom = typeof rule.customHeaders === 'string'
          ? JSON.parse(rule.customHeaders)
          : rule.customHeaders;
        Object.assign(headers, custom);
      } catch {}
    }
    const resp = new Response(body, { status, headers });
    // Stealth: native Response.url equals the request URL — match it on mocks.
    if (requestUrl) {
      try { Object.defineProperty(resp, 'url', { value: requestUrl, configurable: true }); } catch {}
    }
    return resp;
  }

  function matchesGqlOperation(rule, requestBody) {
    if (!rule.gqlOperation) return true;
    if (!requestBody) return false;
    try {
      const bodyStr = typeof requestBody === 'string'
        ? requestBody : JSON.stringify(requestBody);
      const parsed = JSON.parse(bodyStr);
      if (parsed.operationName) return parsed.operationName === rule.gqlOperation;
      return (parsed.query || '').includes(rule.gqlOperation);
    } catch {
      return String(requestBody).includes(rule.gqlOperation);
    }
  }

  // Rules are treated as trusted code: responseBody runs in MAIN world with full page access.
  function runModifyResponse(rule, args) {
    const fn  = new Function(rule.responseBody + '\nreturn modifyResponse(arguments[0]);');
    const res = fn(args);
    return res == null ? '' : (typeof res === 'string' ? res : JSON.stringify(res));
  }

  // Remote execution via sandboxed iframe (bypasses iframe CSP)
  async function runModifyResponseRemote(rule, args) {
    await _waitForSandbox();
    return new Promise((resolve, reject) => {
      const id = '__sfvi_sandbox_' + Date.now() + '_' + Math.random();
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('runModifyResponseRemote timeout'));
      }, 5000);

      function handler(ev) {
        if (!ev.data || ev.data.type !== '__sfvi_sandbox_result__') return;
        if (ev.data.id !== id) return;
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        if (ev.data.error) reject(new Error(ev.data.error));
        else resolve(ev.data.result);
      }

      window.addEventListener('message', handler);

      const iframe = document.getElementById('__sfvi_sandbox__');
      iframe.contentWindow.postMessage({
        type: '__sfvi_sandbox_exec__',
        id,
        code: rule.responseBody,
        args,
      }, '*');
    });
  }

  async function runModifyResponseSafe(rule, args) {
    try {
      return runModifyResponse(rule, args);
    } catch (err) {
      const isCsp = err instanceof EvalError || /CSP|Content Security Policy|unsafe-eval|evaluating a string as javascript/i.test(err.message);
      if (isCsp) {
        return await runModifyResponseRemote(rule, args);
      }
      throw err;
    }
  }

  // ── Request modifier (mutates outgoing body) ──────────────────────────────
  function runModifyRequest(rule, args) {
    const fn  = new Function(rule.requestBody + '\nreturn modifyRequest(arguments[0]);');
    const res = fn(args);
    return res == null ? '' : (typeof res === 'string' ? res : JSON.stringify(res));
  }

  async function runModifyRequestRemote(rule, args) {
    await _waitForSandbox();
    return new Promise((resolve, reject) => {
      const id = '__sfvi_sandbox_req_' + Date.now() + '_' + Math.random();
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('runModifyRequestRemote timeout'));
      }, 5000);

      function handler(ev) {
        if (!ev.data || ev.data.type !== '__sfvi_sandbox_result__') return;
        if (ev.data.id !== id) return;
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        if (ev.data.error) reject(new Error(ev.data.error));
        else resolve(ev.data.result);
      }

      window.addEventListener('message', handler);

      const iframe = document.getElementById('__sfvi_sandbox__');
      iframe.contentWindow.postMessage({
        type: '__sfvi_sandbox_exec_request__',
        id,
        code: rule.requestBody,
        args,
      }, '*');
    });
  }

  async function runModifyRequestSafe(rule, args) {
    try {
      return runModifyRequest(rule, args);
    } catch (err) {
      const isCsp = err instanceof EvalError || /CSP|Content Security Policy|unsafe-eval|evaluating a string as javascript/i.test(err.message);
      if (isCsp) {
        return await runModifyRequestRemote(rule, args);
      }
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FETCH OVERRIDE
  // ═══════════════════════════════════════════════════════════════════════════

  function parseJson(value) {
    try { return JSON.parse(value); } catch { return null; }
  }

  function customRequestHeaders(rule) {
    if (!rule.requestCustomHeaders) return {};
    const headers = typeof rule.requestCustomHeaders === 'string' ? parseJson(rule.requestCustomHeaders) : rule.requestCustomHeaders;
    return headers && typeof headers === 'object' ? headers : {};
  }

  function requestBodyArgs(request) {
    return { method: request.method, url: request.url, requestHeaders: request.headers,
      requestData: request.body, requestJSON: parseJson(request.body) };
  }

  function bodyText(value) { return typeof value === 'string' ? value : JSON.stringify(value); }

  function findApiRule(request) {
    return STATE.apis.find(rule => matchesRule(request.url, rule) &&
      (!rule.method || rule.method === request.method) && matchesGqlOperation(rule, request.body));
  }

  function fetchRequestMetadata(input, init) {
    const objectInput = input && typeof input === 'object';
    const url = objectInput ? input.url || input.href || '' : String(input || '');
    return { objectInput, url: toAbs(url), method: (init?.method || input?.method || 'GET').toUpperCase() };
  }

  async function readFetchRequest(input, init) {
    const { objectInput, url, method } = fetchRequestMetadata(input, init);
    let body = init?.body ?? null;
    if (!body && objectInput && ['POST','PUT','PATCH'].includes(method)) {
      try { body = await input.clone().text(); } catch {}
    }
    const headers = {};
    try { new Headers(init?.headers || input?.headers).forEach((value, key) => { headers[key] = value; }); } catch {}
    return { url, method, body, headers };
  }

  async function modifyFetchBody(rule, request) {
    if (!rule.requestBody) return request.body;
    if (rule.requestBodyType === 'static') return rule.requestBody;
    try {
      const modified = await runModifyRequestSafe(rule, requestBodyArgs(request));
      return modified == null ? request.body : bodyText(modified);
    } catch (error) {
      console.error('[SFV-I] Request modification failed:', error.message);
      return request.body;
    }
  }

  async function prepareFetchRequest(input, init, rule, request) {
    const outgoingBody = await modifyFetchBody(rule, request);
    const options = { ...init };
    if (outgoingBody !== request.body) options.body = outgoingBody;
    const custom = customRequestHeaders(rule);
    const headersChanged = Object.keys(custom).length > 0;
    if (headersChanged) {
      const headers = new Headers(options.headers || request.headers);
      for (const [key, value] of Object.entries(custom)) headers.set(key, String(value));
      options.headers = headers;
    }
    const url = rule.redirectUrl ? toAbs(rule.redirectUrl) : request.url;
    let finalInput = rule.redirectUrl ? url : input;
    if (typeof finalInput !== 'string') finalInput = new Request(finalInput, options);
    const requestChanged = outgoingBody !== request.body || headersChanged || Boolean(rule.redirectUrl);
    return { input: finalInput, init: options, url, outgoingBody, requestChanged };
  }

  async function transformFetchResponse(rule, request, prepared) {
    const original = await _nativeFetch(prepared.input, prepared.init);
    const text = await original.text();
    const body = await runModifyResponseSafe(rule, {
      method: request.method, url: prepared.url, response: text, responseJSON: parseJson(text),
      responseType: original.headers.get('content-type') || '',
      requestHeaders: request.headers, requestData: prepared.outgoingBody,
    });
    return buildResponse(rule, body, prepared.url);
  }

  async function applyFetchResponse(rule, request, prepared) {
    const title = request.method + ' \u00b7 ' + _shortUrl(prepared.url);
    if (!rule.responseBody) {
      const response = await _nativeFetch(prepared.input, prepared.init);
      if (prepared.requestChanged) completeApplied(rule, prepared.url, title, 'request modified');
      return response;
    }
    if (rule.responseType !== 'dynamic') {
      const response = buildResponse(rule, rule.responseBody, prepared.url);
      completeApplied(rule, prepared.url, title, 'response mocked');
      return response;
    }
    try {
      const response = await transformFetchResponse(rule, request, prepared);
      completeApplied(rule, prepared.url, title, 'response modified');
      return response;
    } catch (error) {
      // Preserve the existing fallback, without presenting a failed transform as success.
      console.error('[SFV-I] Response modification failed:', error.message);
      return buildResponse(rule, rule.responseBody, prepared.url);
    }
  }

  const _fetchOverride = async function fetch(input, init) {
    const request = await readFetchRequest(input, init);
    const rule = findApiRule(request);
    if (!rule) return _nativeFetch(input, init);
    const prepared = await prepareFetchRequest(input, init, rule, request);
    return applyFetchResponse(rule, request, prepared);
  };
  _nativables.add(_fetchOverride);
  window.fetch = _fetchOverride;

  // ═══════════════════════════════════════════════════════════════════════════
  // XHR OVERRIDE
  // ═══════════════════════════════════════════════════════════════════════════

  const _protoOpen = XMLHttpRequest.prototype.open;
  const _protoSend = XMLHttpRequest.prototype.send;
  const _protoSetH = XMLHttpRequest.prototype.setRequestHeader;

  const _xhrOpen = function open(method, url, async = true, user, pass) {
    this[_URL]    = toAbs(String(url));
    this[_METHOD] = (method || 'GET').toUpperCase();
    this[_HDRS]   = {};
    this[_ASYNC]  = async !== false;
    for (const k of ['readyState', 'status', 'statusText', 'responseText', 'response', 'responseURL']) {
      try { delete this[k]; } catch {}
    }
    return _protoOpen.call(this, method, url, async, user, pass);
  };
  _nativables.add(_xhrOpen);
  try { XMLHttpRequest.prototype.open = _xhrOpen; } catch { return; }

  const _xhrSetH = function setRequestHeader(name, value) {
    if (this[_HDRS]) this[_HDRS][name] = value;
    return _protoSetH.call(this, name, value);
  };
  _nativables.add(_xhrSetH);
  try { XMLHttpRequest.prototype.setRequestHeader = _xhrSetH; } catch {}

  function modifyXhrBody(rule, request) {
    if (!rule.requestBody) return request.body;
    if (rule.requestBodyType === 'static') return rule.requestBody;
    try {
      const modified = runModifyRequest(rule, requestBodyArgs(request));
      return modified == null ? request.body : bodyText(modified);
    } catch (error) {
      console.error('[SFV-I] Request modification failed:', error.message);
      return request.body;
    }
  }

  function prepareXhrRequest(rule, request) {
    const outgoingBody = modifyXhrBody(rule, request);
    const custom = customRequestHeaders(rule);
    return { outgoingBody, headers: { ...request.headers, ...custom },
      url: rule.redirectUrl ? toAbs(rule.redirectUrl) : request.url,
      requestChanged: outgoingBody !== request.body || Object.keys(custom).length > 0 || Boolean(rule.redirectUrl) };
  }

  function defineXhrProperty(xhr, key, value) {
    try { Object.defineProperty(xhr, key, { get: () => value, configurable: true, enumerable: true }); }
    catch { try { xhr[key] = value; } catch {} }
  }

  function defineXhrMethod(xhr, key, value) {
    try { Object.defineProperty(xhr, key, { value, configurable: true, enumerable: true, writable: true }); }
    catch { try { xhr[key] = value; } catch {} }
  }

  function installXhrHeaders(xhr, realHeaders) {
    const text = typeof realHeaders === 'string' ? realHeaders : '';
    const headers = new Map();
    for (const line of text.split(/\r?\n/)) {
      const index = line.indexOf(':');
      if (index > 0) headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
    }
    defineXhrMethod(xhr, 'getResponseHeader', name => headers.get(String(name).toLowerCase()) || null);
    defineXhrMethod(xhr, 'getAllResponseHeaders', () => text);
  }

  function fireXhrEvents(xhr) {
    xhr.dispatchEvent(new Event('readystatechange'));
    if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
    xhr.dispatchEvent(new ProgressEvent('load'));
    xhr.dispatchEvent(new ProgressEvent('loadend'));
    if (typeof xhr.onload === 'function') xhr.onload(new ProgressEvent('load'));
    if (typeof xhr.onloadend === 'function') xhr.onloadend(new ProgressEvent('loadend'));
  }

  function xhrResponseProps(rule, prepared, body, realStatus, realStatusText) {
    const status = realStatus || parseInt(rule.statusCode) || 200;
    return { readyState: 4, status, statusText: realStatusText || (status === 200 ? 'OK' : String(status)),
      responseText: body, response: body, responseURL: prepared.url };
  }

  function createXhrDispatcher(xhr, rule, request, prepared) {
    const title = request.method + ' \u00b7 ' + _shortUrl(prepared.url);
    const delay = rule.delay > 0 ? rule.delay : 0;
    return function dispatchMock(body, realStatus, realStatusText, realHeaders, applied = true) {
      const props = xhrResponseProps(rule, prepared, body, realStatus, realStatusText);
      for (const [key, value] of Object.entries(props)) defineXhrProperty(xhr, key, value);
      installXhrHeaders(xhr, realHeaders);
      const fire = () => {
        if (applied && (rule.responseBody || prepared.requestChanged)) {
          completeApplied(rule, prepared.url, title, rule.responseBody ? 'response applied' : 'request modified');
        }
        fireXhrEvents(xhr);
      };
      if (request.isSync) fire();
      else setTimeout(fire, delay);
    };
  }

  function nativeXhr(xhr, request, prepared, forwardOptions = false) {
    const real = new _NativeXHR();
    _protoOpen.call(real, request.method, prepared.url, !request.isSync);
    Object.entries(prepared.headers).forEach(([key, value]) => _protoSetH.call(real, key, value));
    if (forwardOptions) {
      try {
        for (const key of ['responseType', 'withCredentials', 'timeout']) {
          if (xhr[key] != null) real[key] = xhr[key];
        }
      } catch {}
    }
    return real;
  }

  function deliverOriginal(real, deliver) {
    deliver(real.responseText, real.status, real.statusText, real.getAllResponseHeaders());
  }

  function sendRequestOnlyXhr(xhr, rule, request, prepared, deliver) {
    const real = nativeXhr(xhr, request, prepared, rule.responseType === 'dynamic' && !request.isSync);
    if (request.isSync) {
      _protoSend.call(real, prepared.outgoingBody);
      deliverOriginal(real, deliver);
      return;
    }
    real.onload = () => deliverOriginal(real, deliver);
    real.onerror = () => deliver('', undefined, undefined, undefined, false);
    _protoSend.call(real, prepared.outgoingBody);
  }

  function sendStaticXhr(xhr, rule, request, prepared, deliver) {
    if (!rule.responseBody) return sendRequestOnlyXhr(xhr, rule, request, prepared, deliver);
    if (request.isSync) return deliver(rule.responseBody);
    const real = nativeXhr(xhr, request, prepared);
    real.onload = () => deliver(rule.responseBody);
    real.onerror = () => deliver(rule.responseBody);
    _protoSend.call(real, prepared.outgoingBody);
  }

  function xhrResponseArgs(real, request, prepared) {
    const text = real.responseText;
    return { method: request.method, url: prepared.url, response: text, responseJSON: parseJson(text),
      responseType: real.getResponseHeader('content-type') || '', requestHeaders: prepared.headers, requestData: request.body };
  }

  function deliverTransformedXhr(real, result, deliver, applied = true) {
    deliver(result, real.status, real.statusText, real.getAllResponseHeaders(), applied);
  }

  function transformSyncXhr(real, rule, request, prepared, deliver) {
    try {
      const result = runModifyResponse(rule, xhrResponseArgs(real, request, prepared));
      deliverTransformedXhr(real, result, deliver);
    } catch {
      deliverTransformedXhr(real, rule.responseBody || real.responseText, deliver, false);
    }
  }

  async function transformAsyncXhr(real, rule, request, prepared, deliver) {
    try {
      const result = await runModifyResponseSafe(rule, xhrResponseArgs(real, request, prepared));
      deliverTransformedXhr(real, result, deliver);
    } catch {
      deliverTransformedXhr(real, rule.responseBody || real.responseText, deliver, false);
    }
  }

  function sendDynamicXhr(xhr, rule, request, prepared, deliver) {
    if (!rule.responseBody) return sendRequestOnlyXhr(xhr, rule, request, prepared, deliver);
    const real = nativeXhr(xhr, request, prepared, true);
    if (request.isSync) {
      _protoSend.call(real, prepared.outgoingBody);
      transformSyncXhr(real, rule, request, prepared, deliver);
      return;
    }
    real.onload = () => transformAsyncXhr(real, rule, request, prepared, deliver);
    real.onerror = () => deliver(rule.responseBody || '', undefined, undefined, undefined, false);
    _protoSend.call(real, prepared.outgoingBody);
  }

  const _xhrSend = function send(body) {
    const request = { url: this[_URL] || '', method: this[_METHOD], headers: this[_HDRS] || {}, body, isSync: this[_ASYNC] === false };
    const rule = findApiRule(request);
    if (!rule) return _protoSend.call(this, body);
    const prepared = prepareXhrRequest(rule, request);
    const deliver = createXhrDispatcher(this, rule, request, prepared);
    if (rule.responseType !== 'dynamic') return sendStaticXhr(this, rule, request, prepared, deliver);
    return sendDynamicXhr(this, rule, request, prepared, deliver);
  };
  _nativables.add(_xhrSend);
  try { XMLHttpRequest.prototype.send = _xhrSend; } catch {}

})();
