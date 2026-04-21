// page-hook.js — MAIN world (injected via chrome.scripting executeScript files:[])
// CSP-exempt: extension files injected via scripting API bypass all page CSP.

(function () {
  'use strict';

  // ── Capture natives at the very top of the IIFE ───────────────────────────
  // page-hook.js is injected with injectImmediately:true at document_start,
  // BEFORE any page script runs. So window.fetch and XMLHttpRequest are still
  // the unmodified browser natives at this point.
  //
  // On re-injection (e.g. SPA navigation), __sfviHookInstalled guard returns early,
  // so the override block never runs again — no loop possible.
  //
  // We store them on the window under non-enumerable keys so re-injection can
  // always find the originals even if window.fetch was later patched by page code.
  if (!window.__sfviNativeFetch) {
    Object.defineProperty(window, '__sfviNativeFetch', {
      value: window.fetch.bind(window), writable: false, configurable: false, enumerable: false,
    });
  }
  if (!window.__sfviNativeXHR) {
    Object.defineProperty(window, '__sfviNativeXHR', {
      value: window.XMLHttpRequest, writable: false, configurable: false, enumerable: false,
    });
  }

  const _nativeFetch = window.__sfviNativeFetch;
  const _NativeXHR   = window.__sfviNativeXHR;

  if (window.__sfviHookInstalled) {
    window.postMessage({ type: '__sfvi_hook_ready__' }, '*');
    return;
  }
  window.__sfviHookInstalled = true;

  // ── State ─────────────────────────────────────────────────────────────────
  const STATE = { apis: [] };

  window.addEventListener('message', (ev) => {
    if (!ev.data || ev.data.type !== '__sfvi_hook_data__') return;
    if (ev.data.apis) STATE.apis = ev.data.apis;
  });

  window.postMessage({ type: '__sfvi_hook_ready__' }, '*');

  // ── Helpers ───────────────────────────────────────────────────────────────

  function toAbs(u) {
    try { return new URL(u, location.href).href; } catch { return String(u || ''); }
  }

  function matchesRule(url, rule) {
    if (!rule.regex) return false;
    try { return new RegExp(rule.regex, 'i').test(url); } catch { return false; }
  }

  function notifyApplied(ruleId, url) {
    window.dispatchEvent(new CustomEvent('__sfvi_applied__', { detail: { ruleId, url } }));
  }

  function buildResponse(rule, body) {
    // Start with the configured status code
    const status = parseInt(rule.statusCode) || 200;
    // Merge custom headers over the default Content-Type.
    // rule.customHeaders is a JSON string set in the dashboard.
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    if (rule.customHeaders) {
      try {
        const custom = typeof rule.customHeaders === 'string'
          ? JSON.parse(rule.customHeaders)
          : rule.customHeaders;
        Object.assign(headers, custom);
      } catch {}
    }
    return new Response(body, { status, headers });
  }

  // matchesGqlOperation: returns true if the rule has no gql operation filter,
  // or if the request body contains the specified operation name.
  function matchesGqlOperation(rule, requestBody) {
    if (!rule.gqlOperation) return true;
    if (!requestBody) return false;
    try {
      const bodyStr = typeof requestBody === 'string'
        ? requestBody
        : JSON.stringify(requestBody);
      // GraphQL requests send { query: '...', operationName: '...' }
      // Match against operationName field or the query string itself
      const parsed = JSON.parse(bodyStr);
      if (parsed.operationName) {
        return parsed.operationName === rule.gqlOperation;
      }
      // Fallback: scan the query string for the operation name
      return (parsed.query || '').includes(rule.gqlOperation);
    } catch {
      return String(requestBody).includes(rule.gqlOperation);
    }
  }

  function runModifyResponse(rule, args) {
    const fn  = new Function(rule.responseBody + '\nreturn modifyResponse(arguments[0]);');
    const res = fn(args);
    return res == null ? '' : (typeof res === 'string' ? res : JSON.stringify(res));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FETCH OVERRIDE
  // ═══════════════════════════════════════════════════════════════════════════

  window.fetch = async function (input, init) {
    // Fix: handle Request objects correctly — input may be a Request instance,
    // a string URL, or a URL object. Extract url and method from all cases.
    let url, method, reqBody;
    if (input instanceof Request) {
      url    = input.url;
      method = (init?.method || input.method || 'GET').toUpperCase();
      // Clone to allow reading the body later for GraphQL matching
      reqBody = init?.body ?? null;
      if (!reqBody && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        try { reqBody = await input.clone().text(); } catch {}
      }
    } else {
      url     = typeof input === 'string' ? input : (input?.url ?? '');
      method  = (init?.method || 'GET').toUpperCase();
      reqBody = init?.body ?? null;
    }
    const abs = toAbs(url);

    const rule = STATE.apis.find(r =>
      matchesRule(abs, r) &&
      (!r.method || r.method === method) &&
      matchesGqlOperation(r, reqBody)
    );
    if (!rule) return _nativeFetch(input, init);

    notifyApplied(rule.id, abs);
    console.log(
      '%c[SFV-Interceptor]%c 🔁 API response mocked — ' + method + ' ' + abs.split('?')[0],
      'color:#34d399;font-weight:700;background:#052e16;padding:2px 6px;border-radius:3px',
      'color:#34d399;font-weight:600'
    );

    if (rule.delay > 0) await new Promise(r => setTimeout(r, rule.delay));

    if (rule.responseType !== 'dynamic') {
      // Make the real request so it appears in Network tab, then return static body.
      try { await _nativeFetch(input, init); } catch {}
      return buildResponse(rule, rule.responseBody || '');
    }

    try {
      const origResp = await _nativeFetch(input, init);
      const origText = await origResp.text();
      let   origJSON = null;
      try { origJSON = JSON.parse(origText); } catch {}
      const body = runModifyResponse(rule, {
        method, url: abs,
        response:       origText,
        responseJSON:   origJSON,
        responseType:   origResp.headers.get('content-type') || '',
        requestHeaders: {},
        requestData:    reqBody,
      });
      return buildResponse(rule, body);
    } catch(e) {
      console.warn('[SFV-Interceptor] fetch modifyResponse error:', e.message);
      return buildResponse(rule, rule.responseBody || '');
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // XHR OVERRIDE
  // ═══════════════════════════════════════════════════════════════════════════

  const _protoOpen = XMLHttpRequest.prototype.open;
  const _protoSend = XMLHttpRequest.prototype.send;
  const _protoSetH = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, async = true, user, pass) {
    this.__miUrl     = toAbs(String(url));
    this.__miMethod  = (method || 'GET').toUpperCase();
    this.__miHeaders = {};
    // Reset any mock properties left from a previous intercepted call on this instance
    for (const k of ['readyState', 'status', 'statusText', 'responseText', 'response', 'responseURL']) {
      try { delete this[k]; } catch {}
    }
    return _protoOpen.call(this, method, url, async, user, pass);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__miHeaders) this.__miHeaders[name] = value;
    return _protoSetH.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const rule = STATE.apis.find(r =>
      matchesRule(this.__miUrl || '', r) &&
      (!r.method || r.method === this.__miMethod) &&
      matchesGqlOperation(r, body)
    );
    if (!rule) return _protoSend.call(this, body);

    notifyApplied(rule.id, this.__miUrl);
    console.log(
      '%c[SFV-Interceptor]%c 🔁 API response mocked — ' + this.__miMethod + ' ' + (this.__miUrl || '').split('?')[0],
      'color:#34d399;font-weight:700;background:#052e16;padding:2px 6px;border-radius:3px',
      'color:#34d399;font-weight:600'
    );

    const xhr        = this;
    const reqMethod  = this.__miMethod;
    const reqUrl     = this.__miUrl;
    const reqHeaders = this.__miHeaders || {};
    const delay      = rule.delay > 0 ? rule.delay : 0;

    function dispatchMock(mockBody) {
      const status = parseInt(rule.statusCode) || 200;
      const props = {
        readyState:   4,
        status:       status,
        statusText:   status === 200 ? 'OK' : String(status),
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
      setTimeout(() => {
        xhr.dispatchEvent(new Event('readystatechange'));
        if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
        xhr.dispatchEvent(new ProgressEvent('load'));
        xhr.dispatchEvent(new ProgressEvent('loadend'));
        if (typeof xhr.onload    === 'function') xhr.onload(new ProgressEvent('load'));
        if (typeof xhr.onloadend === 'function') xhr.onloadend(new ProgressEvent('loadend'));
      }, delay);
    }

    if (rule.responseType !== 'dynamic') {
      // Make the real request so it appears in Network and the XHR instance stays fresh,
      // but discard the response and return the static body instead.
      const realXhr = new _NativeXHR();
      _protoOpen.call(realXhr, reqMethod, reqUrl, true);
      Object.entries(reqHeaders).forEach(([k, v]) => _protoSetH.call(realXhr, k, v));
      realXhr.onload  = () => dispatchMock(rule.responseBody || '');
      realXhr.onerror = () => dispatchMock(rule.responseBody || '');
      _protoSend.call(realXhr, body);
      return;
    }

    // Use _NativeXHR constructor + saved proto methods to avoid hitting our override
    const realXhr = new _NativeXHR();
    _protoOpen.call(realXhr, reqMethod, reqUrl, true);
    Object.entries(reqHeaders).forEach(([k, v]) => _protoSetH.call(realXhr, k, v));

    realXhr.onload = () => {
      try {
        const origText = realXhr.responseText;
        let   origJSON = null;
        try { origJSON = JSON.parse(origText); } catch {}
        const result = runModifyResponse(rule, {
          method:         reqMethod,
          url:            reqUrl,
          response:       origText,
          responseJSON:   origJSON,
          responseType:   realXhr.getResponseHeader('content-type') || '',
          requestHeaders: reqHeaders,
          requestData:    body,
        });
        dispatchMock(result);
      } catch(e) {
        console.warn('[SFV-Interceptor] XHR modifyResponse error:', e.message);
        dispatchMock(rule.responseBody || '');
      }
    };
    realXhr.onerror = () => dispatchMock(rule.responseBody || '');
    _protoSend.call(realXhr, body);
  };

})();
