// page-hook.js — MAIN world (injected via chrome.scripting executeScript files:[])
// CSP-exempt: extension files injected via scripting API bypass all page CSP.

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

    if (!customElements.get(TAG)) {
      const CSS = `
        :host {
          display: block;
          width: 100%;
          transform: translateX(calc(100% + 24px));
          opacity: 0;
          transition: transform 0.45s cubic-bezier(0.3, -0.1, 1, 1), opacity 0.3s ease;
          pointer-events: auto;
        }
        :host(.sfvi-in) {
          transform: translateX(0);
          opacity: 1;
        }
        :host(.sfvi-out) {
          transform: translateX(calc(100% + 24px));
          opacity: 0;
          transition-duration: 0.3s;
        }
        #c {
          background: var(--sfvi-surface, #16181f);
          border: 1px solid var(--sfvi-border, #252836);
          border-left: 3px solid var(--ac, #34d399);
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 8px 32px rgba(0,0,0,.72), 0 2px 6px rgba(0,0,0,.4);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        }
        .head {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 9px 13px 8px;
          border-bottom: 1px solid var(--sfvi-border2, #1e2230);
        }
        .hi { font-size: 14px; line-height: 1; flex-shrink: 0; }
        .hn {
          color: var(--sfvi-text3, #555e6b);
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: .04em;
          text-transform: uppercase;
          flex: 1;
        }
        .body { padding: 10px 13px 12px; }
        .st {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 5px;
        }
        .ring {
          width: 15px;
          height: 15px;
          border-radius: 50%;
          border: 2px solid var(--ac, #34d399);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 9px;
          color: var(--ac, #34d399);
          line-height: 1;
        }
        .sl {
          color: var(--ac, #34d399);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: .07em;
          text-transform: uppercase;
        }
        .ti {
          color: var(--sfvi-text, #e6edf3);
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.35;
        }
        .su {
          color: var(--sfvi-muted, #45505f);
          font-size: 11px;
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .bw { height: 2px; background: var(--sfvi-surface2, #1a1f2e); }
        .br {
          height: 100%;
          background: var(--ac, #34d399);
          transform-origin: left;
          animation: sfvi-bar linear forwards;
        }
        @keyframes sfvi-bar {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `;

      class SfviToast extends HTMLElement {
        connectedCallback() {
          if (this.shadowRoot) return;
          const shadow = this.attachShadow({ mode: 'closed' });

          const sty = document.createElement('style');
          sty.textContent = CSS;

          const c   = document.createElement('div'); c.id = 'c';
          const hd  = document.createElement('div'); hd.className  = 'head';
          const hi  = document.createElement('span'); hi.className = 'hi';
          const hn  = document.createElement('span'); hn.className = 'hn'; hn.textContent = 'SFV Interceptor';
          const bd  = document.createElement('div'); bd.className  = 'body';
          const st  = document.createElement('div'); st.className  = 'st';
          const rg  = document.createElement('div'); rg.className  = 'ring'; rg.textContent = '✓';
          const sl  = document.createElement('span'); sl.className = 'sl';
          const ti  = document.createElement('div'); ti.className  = 'ti';
          const su  = document.createElement('div'); su.className  = 'su';
          const bw  = document.createElement('div'); bw.className  = 'bw';
          const br  = document.createElement('div'); br.className  = 'br';

          hd.append(hi, hn);
          st.append(rg, sl);
          bd.append(st, ti, su);
          bw.appendChild(br);
          c.append(hd, bd, bw);
          shadow.append(sty, c);

          const ms    = parseInt(this.getAttribute('d')  || '5000');
          const color = this.getAttribute('c')  || '#34d399';

          c.style.setProperty('--ac', color);
          hi.textContent = this.getAttribute('i')  || '🔁';
          sl.textContent = this.getAttribute('sl') || 'Rule Applied';
          ti.textContent = this.getAttribute('ti') || '';
          su.textContent = this.getAttribute('su') || '';
          br.style.animationDuration = ms + 'ms';

           // Pattern: small delay then add class to trigger CSS transition
          setTimeout(() => this.classList.add('sfvi-in'), 50);

          setTimeout(() => {
            this.classList.remove('sfvi-in');
            this.classList.add('sfvi-out');
            setTimeout(() => this.remove(), 320);
          }, ms);
        }
      }

      customElements.define(TAG, SfviToast);
    }

    // Wrapper for vertical stacking — plain div, inline !important styles
    const wrap = document.createElement('div');
    wrap.style.setProperty('position',        'fixed',      'important');
    wrap.style.setProperty('top',             '60px',       'important');
    wrap.style.setProperty('right',           '16px',       'important');
    wrap.style.setProperty('width',           '300px',      'important');
    wrap.style.setProperty('z-index',         '2147483647', 'important');
    wrap.style.setProperty('pointer-events',  'none',       'important');
    wrap.style.setProperty('display',         'flex',       'important');
    wrap.style.setProperty('flex-direction',  'column',     'important');
    wrap.style.setProperty('gap',             '10px',       'important');
    wrap.style.setProperty('border',          'none',       'important');
    wrap.style.setProperty('background',      'transparent','important');
    wrap.style.setProperty('padding',         '0',          'important');
    wrap.style.setProperty('margin',          '0',          'important');
    if (document.documentElement) {
      document.documentElement.appendChild(wrap);
    } else {
      // Retry when DOM is ready (document_start injection edge case)
      const tryAppend = () => {
        if (document.documentElement) document.documentElement.appendChild(wrap);
        else requestAnimationFrame(tryAppend);
      };
      requestAnimationFrame(tryAppend);
    }

    return function showToast(icon, statusLabel, title, sub, color, duration) {
      const el = document.createElement(TAG);
      el.setAttribute('i',  icon        || '🔁');
      el.setAttribute('sl', statusLabel || 'Rule Applied');
      el.setAttribute('ti', title       || '');
      el.setAttribute('su', sub         || '');
      el.setAttribute('c',  color       || '#34d399');
      el.setAttribute('d',  String(duration || 5000));
      wrap.appendChild(el);
    };
  }

  // Lazy-init wrapper — exposed on _s.toast so background.js _t() helpers find it
  function _sfviToast(icon, statusLabel, title, sub, color, duration) {
    if (!_s._toastFn) {
      try { _s._toastFn = _initToasts(); }
      catch (e) { _s._toastFn = () => {}; }
    }
    _s._toastFn(icon, statusLabel, title, sub, color, duration);
  }
  _s.toast = _sfviToast;

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
    };
    Object.entries(map).forEach(([k, v]) => { if (v) root.style.setProperty(k, v); });
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
  const STATE = { apis: [] };
  const _regexCache = new Map();

  function updateApis(apis) {
    STATE.apis = apis;
    _regexCache.clear();
    for (const rule of apis) {
      if (rule.regex) {
        try { _regexCache.set(rule.regex, new RegExp(rule.regex, 'i')); } catch {}
      }
    }
  }
  _s.updateApis = updateApis;

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
      if (ev.data.apis) updateApis(ev.data.apis);
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

  function notifyApplied(ruleId, url) {
    window.dispatchEvent(new CustomEvent('__sfvi_applied__', { detail: { ruleId, url } }));
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

  // ═══════════════════════════════════════════════════════════════════════════
  // FETCH OVERRIDE
  // ═══════════════════════════════════════════════════════════════════════════

  const _fetchOverride = async function fetch(input, init) {
    let url, method, reqBody, requestHeaders = {};
    if (input && typeof input === 'object') {
      url    = input.url || input.href || '';
      method = (init?.method || input.method || 'GET').toUpperCase();
      reqBody = init?.body ?? null;
      if (!reqBody && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        try { reqBody = await input.clone().text(); } catch {}
      }
      try {
        if (input.headers) input.headers.forEach((v, k) => requestHeaders[k] = v);
      } catch {}
    } else {
      url     = typeof input === 'string' ? input : (input?.url ?? input?.href ?? '');
      method  = (init?.method || 'GET').toUpperCase();
      reqBody = init?.body ?? null;
      if (init?.headers) {
        if (init.headers instanceof Headers) init.headers.forEach((v, k) => requestHeaders[k] = v);
        else if (typeof init.headers === 'object') Object.assign(requestHeaders, init.headers);
      }
    }
    const abs = toAbs(url);

    const rule = STATE.apis.find(r =>
      matchesRule(abs, r) &&
      (!r.method || r.method === method) &&
      matchesGqlOperation(r, reqBody)
    );
    if (!rule) return _nativeFetch(input, init);

    notifyApplied(rule.id, abs);
    const statusCode = rule.statusCode || '200';
    const title      = method + ' · ' + _shortUrl(abs);

    if (rule.delay > 0) await new Promise(r => setTimeout(r, rule.delay));

    if (rule.responseType !== 'dynamic') {
      _sfviToast('🔁', 'Rule Applied', rule.name || title, title + ' · mocked · ' + statusCode, '#34d399');
      return buildResponse(rule, rule.responseBody || '', abs);
    }

    try {
      const origResp = await _nativeFetch(input, init);
      const origText = await origResp.text();
      let   origJSON = null;
      try { origJSON = JSON.parse(origText); } catch {}
      const body = await runModifyResponseSafe(rule, {
        method, url: abs,
        response:       origText,
        responseJSON:   origJSON,
        responseType:   origResp.headers.get('content-type') || '',
        requestHeaders,
        requestData:    reqBody,
      });
      _sfviToast('🔁', 'Rule Applied', rule.name || title, title + ' · modified · ' + statusCode, '#34d399');
      return buildResponse(rule, body, abs);
    } catch (err) {
      _sfviToast('🔁', 'Rule Applied', rule.name || title, title + ' · mocked · ' + statusCode, '#34d399');
      return buildResponse(rule, rule.responseBody || '', abs);
    }
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

  const _xhrSend = function send(body) {
    const url = this[_URL] || '';
    const rule = STATE.apis.find(r =>
      matchesRule(url, r) &&
      (!r.method || r.method === this[_METHOD]) &&
      matchesGqlOperation(r, body)
    );
    if (!rule) return _protoSend.call(this, body);

    notifyApplied(rule.id, this[_URL]);

    const xhr        = this;
    const reqMethod  = this[_METHOD];
    const reqUrl     = this[_URL];
    const reqHeaders = this[_HDRS] || {};
    const delay      = rule.delay > 0 ? rule.delay : 0;
    const statusCode = rule.statusCode || '200';
    const title      = reqMethod + ' · ' + _shortUrl(reqUrl);
    const isSync     = this[_ASYNC] === false;

    function dispatchMock(mockBody) {
      const st = parseInt(rule.statusCode) || 200;
      const props = {
        readyState:   4,
        status:       st,
        statusText:   st === 200 ? 'OK' : String(st),
        responseText: mockBody,
        response:     mockBody,
        responseURL:  reqUrl,
      };
      for (const [k, v] of Object.entries(props)) {
        try {
          Object.defineProperty(xhr, k, { get: () => v, configurable: true, enumerable: true });
        } catch {
          try { xhr[k] = v; } catch {}
        }
      }
      const fire = () => {
        xhr.dispatchEvent(new Event('readystatechange'));
        if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
        xhr.dispatchEvent(new ProgressEvent('load'));
        xhr.dispatchEvent(new ProgressEvent('loadend'));
        if (typeof xhr.onload    === 'function') xhr.onload(new ProgressEvent('load'));
        if (typeof xhr.onloadend === 'function') xhr.onloadend(new ProgressEvent('loadend'));
      };
      if (isSync) fire();
      else setTimeout(fire, delay);
    }

    if (rule.responseType !== 'dynamic') {
      if (isSync) {
        dispatchMock(rule.responseBody || '');
        _sfviToast('🔁', 'Rule Applied', rule.name || title, title + ' · mocked · ' + statusCode, '#34d399');
        return;
      }
      const realXhr = new _NativeXHR();
      _protoOpen.call(realXhr, reqMethod, reqUrl, true);
      Object.entries(reqHeaders).forEach(([k, v]) => _protoSetH.call(realXhr, k, v));
      realXhr.onload  = () => { dispatchMock(rule.responseBody || ''); _sfviToast('🔁', 'Rule Applied', rule.name || title, title + ' · mocked · ' + statusCode, '#34d399'); };
      realXhr.onerror = () => { dispatchMock(rule.responseBody || ''); };
      _protoSend.call(realXhr, body);
      return;
    }

    const realXhr = new _NativeXHR();
    _protoOpen.call(realXhr, reqMethod, reqUrl, !isSync);
    Object.entries(reqHeaders).forEach(([k, v]) => _protoSetH.call(realXhr, k, v));
    try {
      ['responseType', 'withCredentials', 'timeout'].forEach(p => {
        if (xhr[p] != null) realXhr[p] = xhr[p];
      });
    } catch {}

    if (isSync) {
      _protoSend.call(realXhr, body);
      let result = rule.responseBody || '';
      try {
        const origText = realXhr.responseText;
        let origJSON = null;
        try { origJSON = JSON.parse(origText); } catch {}
        result = runModifyResponse(rule, {
          method:         reqMethod,
          url:            reqUrl,
          response:       origText,
          responseJSON:   origJSON,
          responseType:   realXhr.getResponseHeader('content-type') || '',
          requestHeaders: reqHeaders,
          requestData:    body,
        });
        dispatchMock(result);
        _sfviToast('🔁', 'Rule Applied', rule.name || title, title + ' · modified · ' + statusCode, '#34d399');
      } catch (err) {
        dispatchMock(rule.responseBody || '');
        _sfviToast('🔁', 'Rule Applied', rule.name || title, title + ' · mocked · ' + statusCode, '#34d399');
      }
      return;
    }

    realXhr.onload = async () => {
      try {
        const origText = realXhr.responseText;
        let   origJSON = null;
        try { origJSON = JSON.parse(origText); } catch {}
        const result = await runModifyResponseSafe(rule, {
          method:         reqMethod,
          url:            reqUrl,
          response:       origText,
          responseJSON:   origJSON,
          responseType:   realXhr.getResponseHeader('content-type') || '',
          requestHeaders: reqHeaders,
          requestData:    body,
        });
        dispatchMock(result);
        _sfviToast('🔁', 'Rule Applied', rule.name || title, title + ' · modified · ' + statusCode, '#34d399');
      } catch (err) {
        dispatchMock(rule.responseBody || '');
        _sfviToast('🔁', 'Rule Applied', rule.name || title, title + ' · mocked · ' + statusCode, '#34d399');
      }
    };
    realXhr.onerror = () => dispatchMock(rule.responseBody || '');
    _protoSend.call(realXhr, body);
  };
  _nativables.add(_xhrSend);
  try { XMLHttpRequest.prototype.send = _xhrSend; } catch {}

})();
