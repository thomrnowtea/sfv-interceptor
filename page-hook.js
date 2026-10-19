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

  const _origin = location.origin && location.origin !== 'null' ? location.origin : '*';
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
  let _regexCache = new WeakMap();

  function ruleRegex(rule) {
    if (!rule.regex) return null;
    if (!_regexCache.has(rule)) {
      try { _regexCache.set(rule, new RegExp(rule.regex, rule.caseSensitive ? '' : 'i')); }
      catch { _regexCache.set(rule, null); }
    }
    return _regexCache.get(rule);
  }

  function updateApis(apis, activity = null) {
    const generation = activity?.configGeneration || apis[0]?.configGeneration || 0;
    // Never install or overwrite published descriptors without their own cycle.
    if (generation && !activity) return;
    if (generation < STATE.generation) return;
    STATE.generation = generation;
    STATE.apis = apis.map(rule => ({ ...rule, activity: activity ? { ...activity } : null }));
    _regexCache = new WeakMap();
  }
  _s.updateApis = updateApis;
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      STATE.apis = [];
      _regexCache = new WeakMap();
    }
  });

  function _waitForSandbox() {
    return new Promise((resolve, reject) => {
      const expires = Date.now() + 5000;
      let timer;
      function cleanup() {
        clearTimeout(timer);
        window.removeEventListener('message', ready);
      }
      function ready(event) {
        const target = document.getElementById('__sfvi_sandbox__')?.contentWindow;
        if (!target || event.source !== target || event.data?.type !== '__sfvi_sandbox_ready__') return;
        cleanup(); resolve(target);
      }
      function check() {
        if (Date.now() >= expires) { cleanup(); reject(new Error('Sandbox readiness timeout')); return; }
        document.getElementById('__sfvi_sandbox__')?.contentWindow?.postMessage({ type: '__sfvi_sandbox_ping__' }, '*');
        timer = setTimeout(check, 50);
      }
      window.addEventListener('message', ready);
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
    return ruleRegex(rule)?.test(url) || false;
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

  function buildResponse(rule, body, requestUrl, method) {
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
    const resp = new Response(hasResponseBody(method, status) ? body : null, { status, headers });
    // Stealth: native Response.url equals the request URL — match it on mocks.
    if (requestUrl) {
      try { Object.defineProperty(resp, 'url', { value: requestUrl, configurable: true }); } catch {}
    }
    return resp;
  }

  function hasResponseBody(method, status) {
    return method !== 'HEAD' && ![204, 205, 304].includes(status);
  }

  function gqlRequest(request) {
    if (request.method === 'GET') {
      const query = new URL(request.url).searchParams;
      return { operationName: query.get('operationName'), query: query.get('query') };
    }
    if (typeof request.body !== 'string') return request.body;
    return parseJson(request.body) ?? { query: request.body };
  }

  function gqlDefinitionName(tokens, index) {
    if (!['query', 'mutation', 'subscription'].includes(tokens[index])) return null;
    return /^[_A-Za-z][_0-9A-Za-z]*$/.test(tokens[index + 1] || '') ? tokens[index + 1] : null;
  }

  function gqlTokens(query) {
    const tokens = query.match(/#[^\r\n]*|"""(?:\\"""|[^])*?"""|"(?:\\[^]|[^"\\])*"|[_A-Za-z][_0-9A-Za-z]*|[{}()[\]]/g) || [];
    return tokens.filter(token => !['#', '"'].includes(token[0]));
  }

  function gqlOperationNames(query) {
    // Lex only definition boundaries; this is operation selection, not schema validation.
    const tokens = gqlTokens(query);
    let depth = 0;
    let definition = false;
    const names = [];
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (depth === 0 && !definition) {
        if (['query', 'mutation', 'subscription', '{'].includes(token)) names.push(gqlDefinitionName(tokens, index));
        definition = true;
      }
      if ('{(['.includes(token)) depth++;
      if ('})]'.includes(token)) depth--;
      if (depth === 0 && token === '}') definition = false;
    }
    return names;
  }

  function matchesGqlOperation(rule, request) {
    if (!rule.gqlOperation) return true;
    const payload = gqlRequest(request);
    if (!payload || Array.isArray(payload)) return false;
    if (payload.operationName) return payload.operationName === rule.gqlOperation;
    if (typeof payload.query !== 'string') return false;
    const names = gqlOperationNames(payload.query);
    return names.length === 1 && names[0] === rule.gqlOperation;
  }

  // Rules are treated as trusted code: responseBody runs in MAIN world with full page access.
  function serializeModifierResult(result) {
    if (result && typeof result.then === 'function') return Promise.resolve(result).then(serializeModifierResult);
    return result == null ? '' : (typeof result === 'string' ? result : JSON.stringify(result));
  }

  function modifierError(error) {
    try { return String(error?.message ?? error) || 'Modifier failed'; }
    catch { return 'Modifier failed'; }
  }

  function synchronousModifierResult(result) {
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new Error('Async modifiers cannot complete during a synchronous XMLHttpRequest');
    }
    return result;
  }

  function compileModifier(code, name) {
    return new Function(code + '\nreturn ' + name + '(arguments[0]);');
  }

  function runModifierSafe(code, name, args, remote) {
    let fn;
    try { fn = compileModifier(code, name); }
    catch (error) {
      const isCsp = error instanceof EvalError || /CSP|Content Security Policy|unsafe-eval|evaluating a string as javascript/i.test(error.message);
      if (isCsp) return remote();
      throw error;
    }
    // Once user code starts, its errors must never cause a second execution.
    return serializeModifierResult(fn(args));
  }

  function runModifyResponse(rule, args) {
    const fn = compileModifier(rule.responseBody, 'modifyResponse');
    return serializeModifierResult(fn(args));
  }

  function sandboxReply(data) {
    const result = Object.hasOwn(data, 'result');
    const error = Object.hasOwn(data, 'error');
    if (result === error) throw new Error('Invalid sandbox response');
    if (error && typeof data.error === 'string') return { error: new Error(data.error) };
    if (result && typeof data.result === 'string') return { result: data.result };
    throw new Error('Invalid sandbox response');
  }

  function checkedSandboxReply(data) {
    try { return sandboxReply(data); }
    catch { return { error: new Error('Invalid sandbox response') }; }
  }

  // Remote execution via sandboxed iframe (bypasses iframe CSP)
  async function runModifyResponseRemote(rule, args) {
    const target = await _waitForSandbox();
    return new Promise((resolve, reject) => {
      const id = '__sfvi_sandbox_' + Date.now() + '_' + Math.random();
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('runModifyResponseRemote timeout'));
      }, 5000);

      function handler(ev) {
        if (ev.source !== target) return;
        if (!ev.data || ev.data.type !== '__sfvi_sandbox_result__') return;
        if (ev.data.id !== id) return;
        const reply = checkedSandboxReply(ev.data);
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        if (reply.error) reject(reply.error);
        else resolve(reply.result);
      }

      window.addEventListener('message', handler);

      target.postMessage({
        type: '__sfvi_sandbox_exec__',
        id,
        code: rule.responseBody,
        args,
      }, '*');
    });
  }

  async function runModifyResponseSafe(rule, args) {
    return runModifierSafe(rule.responseBody, 'modifyResponse', args, () => runModifyResponseRemote(rule, args));
  }

  // ── Request modifier (mutates outgoing body) ──────────────────────────────
  function runModifyRequest(rule, args) {
    const fn = compileModifier(rule.requestBody, 'modifyRequest');
    return serializeModifierResult(fn(args));
  }

  async function runModifyRequestRemote(rule, args) {
    const target = await _waitForSandbox();
    return new Promise((resolve, reject) => {
      const id = '__sfvi_sandbox_req_' + Date.now() + '_' + Math.random();
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('runModifyRequestRemote timeout'));
      }, 5000);

      function handler(ev) {
        if (ev.source !== target) return;
        if (!ev.data || ev.data.type !== '__sfvi_sandbox_result__') return;
        if (ev.data.id !== id) return;
        const reply = checkedSandboxReply(ev.data);
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        if (reply.error) reject(reply.error);
        else resolve(reply.result);
      }

      window.addEventListener('message', handler);

      target.postMessage({
        type: '__sfvi_sandbox_exec_request__',
        id,
        code: rule.requestBody,
        args,
      }, '*');
    });
  }

  async function runModifyRequestSafe(rule, args) {
    return runModifierSafe(rule.requestBody, 'modifyRequest', args, () => runModifyRequestRemote(rule, args));
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
      (!rule.method || rule.method === request.method) && matchesGqlOperation(rule, request));
  }

  function fetchRequestMetadata(input, init) {
    const objectInput = input && typeof input === 'object';
    const url = objectInput ? input.url || input.href || '' : String(input || '');
    return { objectInput, url: toAbs(url), method: (init?.method || input?.method || 'GET').toUpperCase() };
  }

  async function readFetchRequest(input, init) {
    const { objectInput, url, method } = fetchRequestMetadata(input, init);
    let body = init?.body ?? null;
    if (body === null && objectInput && !['GET', 'HEAD'].includes(method)) {
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
      console.error('[SFV-I] Request modification failed:', modifierError(error));
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
    const effective = new Request(input, options);
    const finalInput = rule.redirectUrl ? await redirectFetchRequest(effective, url) : effective;
    const requestChanged = outgoingBody !== request.body || headersChanged || Boolean(rule.redirectUrl);
    return { input: finalInput, init: undefined, url, outgoingBody, requestChanged };
  }

  async function redirectFetchRequest(request, url) {
    const keys = ['method', 'headers', 'referrer', 'referrerPolicy', 'mode', 'credentials', 'cache', 'redirect', 'integrity', 'keepalive', 'signal'];
    const options = Object.fromEntries(keys.map(key => [key, request[key]]));
    // Passing request.body as RequestInit would force streaming upload on HTTP/1.
    if (request.body) options.body = await request.arrayBuffer();
    return new Request(url, options);
  }

  async function transformFetchResponse(rule, request, prepared) {
    const original = await _nativeFetch(prepared.input, prepared.init);
    try {
      const text = await original.clone().text();
      const body = await runModifyResponseSafe(rule, {
        method: request.method, url: prepared.url, response: text, responseJSON: parseJson(text),
        responseType: original.headers.get('content-type') || '',
        requestHeaders: request.headers, requestData: prepared.outgoingBody,
      });
      return { response: buildResponse(rule, body, prepared.url, request.method), applied: true };
    } catch (error) {
      console.error('[SFV-I] Response modification failed:', modifierError(error));
      return { response: original, applied: false };
    }
  }

  async function applyFetchResponse(rule, request, prepared) {
    const title = request.method + ' \u00b7 ' + _shortUrl(prepared.url);
    if (!rule.responseBody) {
      const response = await _nativeFetch(prepared.input, prepared.init);
      return { response, applied: prepared.requestChanged, status: 'request modified', title };
    }
    if (rule.responseType !== 'dynamic') {
      const response = buildResponse(rule, rule.responseBody, prepared.url, request.method);
      return { response, applied: true, status: 'response mocked', title };
    }
    const result = await transformFetchResponse(rule, request, prepared);
    return { ...result, status: 'response modified', title };
  }

  function withAbort(operation, signal) {
    if (!signal) return operation;
    if (signal.aborted) {
      Promise.resolve(operation).catch(() => {});
      return Promise.reject(signal.reason);
    }
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }

  async function responseDelay(delay, signal) {
    if (!(delay > 0)) return;
    let timer;
    try { await withAbort(new Promise(resolve => { timer = setTimeout(resolve, delay); }), signal); }
    finally { clearTimeout(timer); }
  }

  const _fetchOverride = async function fetch(input, init) {
    const metadata = fetchRequestMetadata(input, init);
    const candidates = STATE.apis.filter(rule => matchesRule(metadata.url, rule) && (!rule.method || rule.method === metadata.method));
    if (!candidates.length) return _nativeFetch(input, init);
    const signal = init?.signal === undefined ? input?.signal : init.signal;
    signal?.throwIfAborted();
    const request = await withAbort(readFetchRequest(input, init), signal);
    const rule = candidates.find(rule => matchesGqlOperation(rule, request));
    if (!rule) return _nativeFetch(input, init);
    const prepared = await withAbort(prepareFetchRequest(input, init, rule, request), signal);
    prepared.input.signal.throwIfAborted();
    const result = await withAbort(applyFetchResponse(rule, request, prepared), prepared.input.signal);
    await responseDelay(rule.delay, prepared.input.signal);
    prepared.input.signal.throwIfAborted();
    if (result.applied) completeApplied(rule, prepared.url, result.title, result.status);
    return result.response;
  };
  _nativables.add(_fetchOverride);
  window.fetch = _fetchOverride;

  // ═══════════════════════════════════════════════════════════════════════════
  // XHR OVERRIDE
  // ═══════════════════════════════════════════════════════════════════════════

  const _xhrPrototype = _NativeXHR.prototype;
  function xhrProperty(name) {
    for (let prototype = _xhrPrototype; prototype; prototype = Object.getPrototypeOf(prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (descriptor) return descriptor;
    }
  }

  const _timeoutProperty = xhrProperty('timeout');
  const _uploadProperty = xhrProperty('upload');
  function canPatchXhr() {
    return typeof _timeoutProperty?.get === 'function' && typeof _timeoutProperty?.set === 'function' &&
      typeof _uploadProperty?.get === 'function' && ['timeout', 'upload'].every(name =>
        Object.getOwnPropertyDescriptor(_xhrPrototype, name)?.configurable !== false) && Object.isExtensible(_xhrPrototype);
  }
  // A page may already wrap XHR. Unsupported shapes keep their existing behavior.
  if (!canPatchXhr()) return;
  const _protoOpen = _xhrPrototype.open;
  const _protoSend = _xhrPrototype.send;
  const _protoSetH = _xhrPrototype.setRequestHeader;
  const _protoAbort = _xhrPrototype.abort;
  const _eventAdd = EventTarget.prototype.addEventListener;
  const _eventRemove = EventTarget.prototype.removeEventListener;
  const _uploadListeners = new WeakMap();
  const _uploadEvents = ['loadstart', 'progress', 'load', 'loadend', 'error', 'abort', 'timeout'];
  const _xhrStates = new WeakMap();

  function uploadOptions(options) {
    if (typeof options === 'boolean') return { capture: options };
    return { capture: Boolean(options?.capture), once: Boolean(options?.once), passive: options?.passive, signal: options?.signal };
  }

  function forgetUploadListener(records, record) {
    const index = records.indexOf(record);
    if (index >= 0) records.splice(index, 1);
    record.options.signal?.removeEventListener('abort', record.abort);
  }

  function activeUploadListeners(target) {
    const records = _uploadListeners.get(target) || [];
    // Native abort algorithms run before the suppressible abort event cleanup.
    for (const record of [...records]) {
      if (record.options.signal?.aborted) forgetUploadListener(records, record);
    }
    return records;
  }

  function addUploadListener(target, type, listener, options) {
    const normalized = uploadOptions(options);
    const records = activeUploadListeners(target);
    const previous = records.find(record => record.type === type && record.listener === listener && record.options.capture === normalized.capture);
    if (previous) return _eventAdd.call(target, type, previous.wrapped, normalized);
    const record = { type, listener, options: normalized };
    record.abort = () => forgetUploadListener(records, record);
    record.wrapped = function(event) {
      if (normalized.once) forgetUploadListener(records, record);
      if (typeof listener === 'function') listener.call(this, event);
      else listener.handleEvent(event);
    };
    _eventAdd.call(target, type, record.wrapped, normalized);
    if (normalized.signal?.aborted) return;
    records.push(record);
    normalized.signal?.addEventListener('abort', record.abort, { once: true });
  }

  function watchUpload(target) {
    if (_uploadListeners.has(target)) return target;
    const records = [];
    _uploadListeners.set(target, records);
    const add = function addEventListener(type, listener, options) {
      if (arguments.length < 2 || !_uploadListeners.has(this)) return Reflect.apply(_eventAdd, this, arguments);
      if (!listener || !['function', 'object'].includes(typeof listener)) return _eventAdd.call(this, type, listener, options);
      return addUploadListener(this, '' + type, listener, options);
    };
    const remove = function removeEventListener(type, listener, options) {
      if (arguments.length < 2 || !_uploadListeners.has(this)) return Reflect.apply(_eventRemove, this, arguments);
      const name = '' + type;
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
      const records = activeUploadListeners(this);
      const record = records.find(item => item.type === name && item.listener === listener && item.options.capture === capture);
      _eventRemove.call(this, name, record ? record.wrapped : listener, capture);
      if (record) forgetUploadListener(records, record);
    };
    _nativables.add(add); _nativables.add(remove);
    Object.defineProperties(target, { addEventListener: { value: add, configurable: true, writable: true },
      removeEventListener: { value: remove, configurable: true, writable: true } });
    return target;
  }

  const _xhrUpload = function upload() { return watchUpload(_uploadProperty.get.call(this)); };
  _nativables.add(_xhrUpload);
  Object.defineProperty(_xhrPrototype, 'upload', { ..._uploadProperty, get: _xhrUpload });

  function observesUpload(xhr) {
    const target = _uploadProperty.get.call(xhr);
    return Boolean(activeUploadListeners(target).length) || _uploadEvents.some(type => typeof target['on' + type] === 'function');
  }

  function scheduleXhrTimeout(xhr, state) {
    clearTimeout(state.deadline);
    if (state.done || state.isSync || xhr.timeout === 0) return;
    const remaining = Math.max(0, xhr.timeout - (performance.now() - state.started));
    state.deadline = setTimeout(() => expireXhrTimeout(xhr, state), Math.min(remaining, 2147483647));
  }

  function expireXhrTimeout(xhr, state) {
    if (performance.now() - state.started < xhr.timeout) return scheduleXhrTimeout(xhr, state);
    failXhr(xhr, state, 'timeout');
  }

  const _xhrTimeout = function timeout(value) {
    _timeoutProperty.set.call(this, value);
    const state = _xhrStates.get(this);
    if (state) scheduleXhrTimeout(this, state);
  };
  _nativables.add(_xhrTimeout);
  Object.defineProperty(_xhrPrototype, 'timeout', { ..._timeoutProperty, set: _xhrTimeout });

  function stopXhr(state) {
    if (!state) return;
    state.done = true;
    clearTimeout(state.timer);
    clearTimeout(state.deadline);
    state.real?.abort();
  }

  const _xhrOpen = function open(method, url, async = true, user, pass) {
    stopXhr(_xhrStates.get(this));
    _xhrStates.delete(this);
    this[_URL]    = toAbs(String(url));
    this[_METHOD] = (method || 'GET').toUpperCase();
    this[_HDRS]   = {};
    this[_ASYNC]  = async !== false;
    for (const k of ['readyState', 'status', 'statusText', 'responseText', 'response', 'responseXML', 'responseURL', 'getResponseHeader', 'getAllResponseHeaders']) {
      try { delete this[k]; } catch {}
    }
    return _protoOpen.call(this, method, url, async, user, pass);
  };
  _nativables.add(_xhrOpen);
  try { _xhrPrototype.open = _xhrOpen; } catch { return; }

  const _xhrSetH = function setRequestHeader(name, value) {
    if (this[_HDRS]) this[_HDRS][name] = value;
    return _protoSetH.call(this, name, value);
  };
  _nativables.add(_xhrSetH);
  try { _xhrPrototype.setRequestHeader = _xhrSetH; } catch {}

  function modifyXhrBody(rule, request) {
    if (!rule.requestBody) return request.body;
    if (rule.requestBodyType === 'static') return rule.requestBody;
    try {
      const modified = synchronousModifierResult(runModifyRequest(rule, requestBodyArgs(request)));
      return modified == null ? request.body : bodyText(modified);
    } catch (error) {
      console.error('[SFV-I] Request modification failed:', modifierError(error));
      return request.body;
    }
  }

  function prepareXhrRequest(rule, request, outgoingBody) {
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

  function xhrHeaderMap(realHeaders) {
    const text = typeof realHeaders === 'string' ? realHeaders : '';
    const headers = new Map();
    for (const line of text.split(/\r?\n/)) {
      const index = line.indexOf(':');
      if (index > 0) headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
    }
    return headers;
  }

  function installXhrHeaders(xhr, realHeaders, rule = null) {
    const headers = xhrHeaderMap(realHeaders);
    if (rule) {
      if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
      const custom = typeof rule.customHeaders === 'string' ? parseJson(rule.customHeaders) : rule.customHeaders;
      for (const [key, value] of Object.entries(custom || {})) headers.set(key.toLowerCase(), String(value));
    }
    const text = [...headers].map(([key, value]) => key + ': ' + value + '\r\n').join('');
    defineXhrMethod(xhr, 'getResponseHeader', name => headers.get(String(name).toLowerCase()) ?? null);
    defineXhrMethod(xhr, 'getAllResponseHeaders', () => text);
  }

  function fireXhrEvents(xhr, state) {
    for (const type of ['readystatechange', 'load', 'loadend']) {
      if (_xhrStates.get(xhr) !== state || xhr.readyState !== 4) return;
      xhr.dispatchEvent(type === 'readystatechange' ? new Event(type) : new ProgressEvent(type, state.progress));
    }
  }

  function xhrResponseProps(rule, prepared, realStatus, realStatusText) {
    const status = realStatus ?? (parseInt(rule.statusCode) || 200);
    return { readyState: 4, status, statusText: realStatusText || (status === 200 ? 'OK' : String(status)),
      responseURL: prepared.url };
  }

  function typedXhrResponse(type, body, contentType) {
    if (type === 'json') return parseJson(body);
    if (type === 'arraybuffer') return new TextEncoder().encode(body).buffer;
    if (type === 'blob') return new Blob([body], { type: contentType });
    if (type === 'document') return xhrDocument(body, contentType);
    return body;
  }

  function xhrDocument(body, contentType) {
    if (!/(?:\bxml\b|\+xml\b|text\/html)/i.test(contentType)) return null;
    const doc = new DOMParser().parseFromString(body, /text\/html/i.test(contentType) ? 'text/html' : 'application/xml');
    return doc.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror').length ? null : doc;
  }

  function textXhr(xhr) { return xhr.responseType === '' || xhr.responseType === 'text'; }

  function xhrBodyValue(xhr, body, original, stage) {
    if (stage < 3) return textXhr(xhr) ? '' : null;
    if (stage < 4 && !textXhr(xhr)) return null;
    return original ? original.response : typedXhrResponse(xhr.responseType, body, xhr.getResponseHeader('content-type') || 'application/json');
  }

  function installXhrBody(xhr, body, original, stage) {
    const type = xhr.responseType;
    const response = xhrBodyValue(xhr, body, original, stage);
    defineXhrProperty(xhr, 'response', response);
    if (textXhr(xhr)) defineXhrProperty(xhr, 'responseText', stage < 3 ? '' : body);
    if (type === 'document') defineXhrProperty(xhr, 'responseXML', response);
  }

  function resetXhrResponse(xhr, readyState) {
    for (const [key, value] of Object.entries({ readyState, status: 0, statusText: '', responseURL: '', response: null })) defineXhrProperty(xhr, key, value);
    if (!xhr.responseType || xhr.responseType === 'document') defineXhrProperty(xhr, 'responseXML', null);
    if (!xhr.responseType || xhr.responseType === 'text') {
      defineXhrProperty(xhr, 'responseText', '');
      defineXhrProperty(xhr, 'response', '');
    }
    installXhrHeaders(xhr, '');
  }

  function failXhr(xhr, state, type) {
    if (state.done || _xhrStates.get(xhr) !== state) return;
    stopXhr(state);
    resetXhrResponse(xhr, 4);
    xhr.dispatchEvent(new Event('readystatechange'));
    failUpload(xhr, state, type);
    for (const event of [type, 'loadend']) {
      if (_xhrStates.get(xhr) !== state) return;
      xhr.dispatchEvent(new ProgressEvent(event));
    }
    if (type === 'abort' && _xhrStates.get(xhr) === state) defineXhrProperty(xhr, 'readyState', 0);
  }

  function failUpload(xhr, state, type) {
    if (!state.uploadObserved || state.uploadComplete || _xhrStates.get(xhr) !== state) return;
    state.uploadComplete = true;
    const target = _uploadProperty.get.call(xhr);
    for (const event of [type, 'loadend']) {
      if (_xhrStates.get(xhr) !== state) return;
      target.dispatchEvent(new ProgressEvent(event));
    }
  }

  const _xhrAbort = function abort() {
    const state = _xhrStates.get(this);
    if (!state) return _protoAbort.call(this);
    if (!state.done) return failXhr(this, state, 'abort');
    _protoAbort.call(this);
    resetXhrResponse(this, 0);
  };
  _nativables.add(_xhrAbort);
  try { _xhrPrototype.abort = _xhrAbort; } catch {}

  function startXhr(xhr, request, rule) {
    if (xhr.readyState !== 1 || (_xhrStates.has(xhr) && !_xhrStates.get(xhr).done)) throw new DOMException('XHR is not opened or is already sending', 'InvalidStateError');
    const state = { done: false, real: null, timer: null, deadline: null, started: performance.now(), isSync: request.isSync,
      replaceResponse: Boolean(rule.responseBody), progress: { loaded: 0, total: 0, lengthComputable: false },
      uploadObserved: observesUpload(xhr), uploadComplete: request.body == null || ['GET', 'HEAD'].includes(request.method) };
    _xhrStates.set(xhr, state);
    scheduleXhrTimeout(xhr, state);
    if (!request.isSync) xhr.dispatchEvent(new ProgressEvent('loadstart'));
    return state;
  }

  function installXhrResponse(xhr, rule, request, prepared, result, stage = 4) {
    const props = xhrResponseProps(rule, prepared, result.realStatus, result.realStatusText);
    props.readyState = stage;
    for (const [key, value] of Object.entries(props)) defineXhrProperty(xhr, key, value);
    installXhrHeaders(xhr, result.realHeaders, result.applied && rule.responseBody ? rule : null);
    installXhrBody(xhr, hasResponseBody(request.method, props.status) ? result.body : '', result.original, stage);
  }

  function currentXhr(xhr, state) { return !state.done && _xhrStates.get(xhr) === state; }

  function progressData(event) {
    return { loaded: event.loaded, total: event.total, lengthComputable: event.lengthComputable };
  }

  function publishMockProgress(xhr, rule, request, prepared, result, state) {
    const body = hasResponseBody(request.method, result.realStatus ?? Number(rule.statusCode)) ? result.body : '';
    const size = new TextEncoder().encode(body).byteLength;
    if (!result.original) state.progress = { loaded: size, total: size, lengthComputable: true };
    for (const stage of [2, 3]) {
      if (!currentXhr(xhr, state)) return;
      installXhrResponse(xhr, rule, request, prepared, result, stage);
      xhr.dispatchEvent(new Event('readystatechange'));
    }
    if (currentXhr(xhr, state)) xhr.dispatchEvent(new ProgressEvent('progress', state.progress));
  }

  function mirrorXhrDownload(xhr, real, state) {
    real.addEventListener('readystatechange', () => {
      if (!currentXhr(xhr, state) || state.replaceResponse || ![2, 3].includes(real.readyState)) return;
      for (const key of ['status', 'statusText', 'responseURL', 'responseText']) {
        Object.defineProperty(xhr, key, { configurable: true, get: () => real[key] });
      }
      Object.defineProperty(xhr, 'readyState', { configurable: true, get: () => Math.min(real.readyState, 3) });
      Object.defineProperty(xhr, 'response', { configurable: true, get: () => textXhr(xhr) ? real.response : null });
      installXhrHeaders(xhr, real.getAllResponseHeaders());
      xhr.dispatchEvent(new Event('readystatechange'));
    });
    real.addEventListener('progress', event => {
      if (!currentXhr(xhr, state)) return;
      state.progress = progressData(event);
      if (!state.replaceResponse) xhr.dispatchEvent(new ProgressEvent('progress', state.progress));
    });
  }

  function mirrorXhrUpload(xhr, real, state) {
    if (!state.uploadObserved) return;
    const target = _uploadProperty.get.call(xhr);
    const source = _uploadProperty.get.call(real);
    for (const type of ['loadstart', 'progress', 'load', 'loadend']) {
      source.addEventListener(type, event => {
        if (!currentXhr(xhr, state) || state.isSync) return;
        if (type === 'loadstart') state.uploadComplete = false;
        if (type === 'load') state.uploadComplete = true;
        if (type === 'loadend' && !state.uploadComplete) return;
        target.dispatchEvent(new ProgressEvent(type, progressData(event)));
      });
    }
  }

  function createXhrDispatcher(xhr, rule, request, prepared) {
    const title = request.method + ' \u00b7 ' + _shortUrl(prepared.url);
    const delay = rule.delay > 0 ? rule.delay : 0;
    const state = _xhrStates.get(xhr);
    return function dispatchMock(body, realStatus, realStatusText, realHeaders, applied = true, original = null) {
      const fire = () => {
        if (state.done || _xhrStates.get(xhr) !== state) return;
        const result = { body, realStatus, realStatusText, realHeaders, applied, original };
        if (state.replaceResponse && !request.isSync) publishMockProgress(xhr, rule, request, prepared, result, state);
        if (!currentXhr(xhr, state)) return;
        state.done = true;
        clearTimeout(state.deadline);
        installXhrResponse(xhr, rule, request, prepared, result);
        if (applied && (rule.responseBody || prepared.requestChanged)) {
          completeApplied(rule, prepared.url, title, rule.responseBody ? 'response applied' : 'request modified');
        }
        fireXhrEvents(xhr, state);
      };
      if (request.isSync) fire();
      else state.timer = setTimeout(fire, delay);
    };
  }

  function nativeXhr(xhr, request, prepared) {
    const real = new _NativeXHR();
    _protoOpen.call(real, request.method, prepared.url, !request.isSync);
    Object.entries(prepared.headers).forEach(([key, value]) => _protoSetH.call(real, key, value));
    real.withCredentials = xhr.withCredentials;
    if (!request.isSync) {
      real.responseType = xhr.responseType;
      // One deadline includes modifier work and delays, measured from the outer send.
      real.timeout = 0;
    }
    const state = _xhrStates.get(xhr);
    state.real = real;
    mirrorXhrUpload(xhr, real, state);
    if (!request.isSync) mirrorXhrDownload(xhr, real, state);
    for (const type of ['error', 'timeout', 'abort']) real.addEventListener(type, () => failXhr(xhr, state, type));
    return real;
  }

  function deliverOriginal(real, deliver, applied = false) {
    const text = !real.responseType || real.responseType === 'text' ? real.responseText : '';
    deliver(text, real.status, real.statusText, real.getAllResponseHeaders(), applied, real);
  }

  function sendRequestOnlyXhr(xhr, request, prepared, deliver) {
    const real = nativeXhr(xhr, request, prepared);
    if (request.isSync) {
      _protoSend.call(real, prepared.outgoingBody);
      deliverOriginal(real, deliver, true);
      return;
    }
    real.onload = () => deliverOriginal(real, deliver, true);
    _protoSend.call(real, prepared.outgoingBody);
  }

  function sendStaticXhr(xhr, rule, request, prepared, deliver) {
    if (!rule.responseBody) return sendRequestOnlyXhr(xhr, request, prepared, deliver);
    if (request.isSync) return deliver(rule.responseBody);
    const real = nativeXhr(xhr, request, prepared);
    real.onload = () => deliver(rule.responseBody);
    _protoSend.call(real, prepared.outgoingBody);
  }

  function xhrResponseText(real) {
    if (real.responseType === 'json') return JSON.stringify(real.response);
    if (real.responseType === 'arraybuffer') return new TextDecoder().decode(real.response);
    if (real.responseType === 'blob') return real.response.text();
    if (real.responseType === 'document') return new XMLSerializer().serializeToString(real.response);
    return real.responseText;
  }

  function xhrResponseArgs(real, request, prepared, text) {
    return { method: request.method, url: prepared.url, response: text, responseJSON: parseJson(text),
      responseType: real.getResponseHeader('content-type') || '', requestHeaders: prepared.headers, requestData: request.body };
  }

  function deliverTransformedXhr(real, result, deliver, applied = true) {
    deliver(result, real.status, real.statusText, real.getAllResponseHeaders(), applied);
  }

  function transformSyncXhr(real, rule, request, prepared, deliver) {
    try {
      const result = synchronousModifierResult(runModifyResponse(rule, xhrResponseArgs(real, request, prepared, real.responseText)));
      deliverTransformedXhr(real, result, deliver);
    } catch {
      deliverOriginal(real, deliver);
    }
  }

  async function transformAsyncXhr(real, rule, request, prepared, deliver) {
    try {
      const text = await xhrResponseText(real);
      const result = await runModifyResponseSafe(rule, xhrResponseArgs(real, request, prepared, text));
      deliverTransformedXhr(real, result, deliver);
    } catch {
      deliverOriginal(real, deliver);
    }
  }

  function sendDynamicXhr(xhr, rule, request, prepared, deliver) {
    if (!rule.responseBody) return sendRequestOnlyXhr(xhr, request, prepared, deliver);
    const real = nativeXhr(xhr, request, prepared);
    if (request.isSync) {
      _protoSend.call(real, prepared.outgoingBody);
      transformSyncXhr(real, rule, request, prepared, deliver);
      return;
    }
    real.onload = () => transformAsyncXhr(real, rule, request, prepared, deliver);
    _protoSend.call(real, prepared.outgoingBody);
  }

  function sendPreparedXhr(xhr, rule, request, outgoingBody) {
    if (_xhrStates.get(xhr)?.done) return;
    const prepared = prepareXhrRequest(rule, request, outgoingBody);
    const deliver = createXhrDispatcher(xhr, rule, request, prepared);
    if (rule.responseType !== 'dynamic') return sendStaticXhr(xhr, rule, request, prepared, deliver);
    return sendDynamicXhr(xhr, rule, request, prepared, deliver);
  }

  function sendImmediateXhr(xhr, rule, request, state) {
    try { return sendPreparedXhr(xhr, rule, request, modifyXhrBody(rule, request)); }
    catch (error) {
      stopXhr(state);
      _xhrStates.delete(xhr);
      throw error;
    }
  }

  function assertXhrIdle(xhr) {
    const state = _xhrStates.get(xhr);
    if (!state) return;
    if (!state.done || xhr.readyState !== 1) throw new DOMException('XHR is not opened or is already sending', 'InvalidStateError');
  }

  const _xhrSend = function send(body) {
    assertXhrIdle(this);
    const request = { url: this[_URL] || '', method: this[_METHOD], headers: this[_HDRS] || {}, body, isSync: this[_ASYNC] === false };
    const rule = findApiRule(request);
    if (!rule) return _protoSend.call(this, body);
    const state = startXhr(this, request, rule);
    if (request.isSync || rule.requestBodyType !== 'dynamic' || !rule.requestBody) {
      return sendImmediateXhr(this, rule, request, state);
    }
    modifyFetchBody(rule, request).then(outgoingBody => {
      if (_xhrStates.get(this) === state && !state.done) sendPreparedXhr(this, rule, request, outgoingBody);
    }).catch(() => failXhr(this, state, 'error'));
  };
  _nativables.add(_xhrSend);
  try { _xhrPrototype.send = _xhrSend; } catch {}

})();
