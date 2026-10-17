// These functions are serialized by executeScript; all browser helpers stay inside.
export async function applyPageRule({ code, url }) {
  try {
    const modify = new Function(code + '\nreturn modifyResponse(arguments[0]);');
    await modify({ method: 'GET', url, response: '', responseType: 'text/html', requestHeaders: {}, requestData: null, responseJSON: null });
    return { applied: true };
  } catch (error) {
    console.error('[SFV-I] Page injection failed:', error.message);
    return { applied: false };
  }
}

// Omitted transport fields must behave like explicit null for dynamic rules.
export async function applyAssetRule({ original = null, code, staticBody = null, url, file, subtype }) {
  function replacementText(source) {
    if (staticBody !== null) return staticBody;
    const modify = new Function(code + '\nreturn modifyResponse(arguments[0]);');
    const result = modify({ method: 'GET', url, response: source, responseType: subtype === 'css' ? 'text/css' : 'text/javascript', requestHeaders: {}, requestData: null, responseJSON: null });
    const normalize = value => value == null ? source : typeof value === 'string' ? value : JSON.stringify(value);
    return result && typeof result.then === 'function' ? Promise.resolve(result).then(normalize) : normalize(result);
  }
  function readOriginal() {
    if (typeof original === 'string') return original;
    if (original !== null) throw new TypeError('Original asset must be a string');
    return fetch(url, { credentials: 'include', cache: 'no-store', mode: 'same-origin' }).then(async response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const text = await response.text();
      if (text.trimStart().startsWith('<')) throw new Error('Server returned HTML for an asset');
      return text;
    });
  }
  function installCss(body) {
    const style = document.createElement('style');
    style.textContent = body;
    (document.head || document.documentElement).appendChild(style);
    return Boolean(style.sheet);
  }
  function installScript(body) {
    const label = ('sfvi-patched/' + file).replace(/[\r\n]/g, '');
    const marker = '__sfvi_exec_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const started = marker + '_started';
    window[started] = false;
    window[marker] = false;
    const inline = document.createElement('script');
    const strictDirective = body.match(/^((?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*)(['"])use strict\2\s*;?/);
    const startMarker = 'window[' + JSON.stringify(started) + '] = true;\n';
    const source = strictDirective
      ? strictDirective[0] + startMarker + body.slice(strictDirective[0].length)
      : startMarker + body;
    inline.textContent = source + '\n;window[' + JSON.stringify(marker) + '] = true;\n//# sourceURL=' + label;
    (document.head || document.documentElement).appendChild(inline);
    inline.remove();
    const ran = window[marker] === true;
    const startedRunning = window[started] === true;
    try { delete window[marker]; delete window[started]; } catch {}
    // Inline script insertion executes synchronously when the page policy
    // allows it. Keep Blob loading as the CSP-compatible fallback path.
    if (ran) return true;
    if (startedRunning) return false;

    return new Promise(resolve => {
      const objectUrl = URL.createObjectURL(new Blob([body + '\n//# sourceURL=' + label], { type: 'text/javascript' }));
      const script = document.createElement('script');
      let failed = false;
      const onError = event => { if (event.filename === objectUrl || event.filename?.endsWith(label)) failed = true; };
      const finish = applied => {
        clearTimeout(timeout);
        window.removeEventListener('error', onError);
        URL.revokeObjectURL(objectUrl);
        script.remove();
        resolve(applied && !failed);
      };
      const timeout = setTimeout(() => finish(false), 15000);
      window.addEventListener('error', onError);
      script.onload = () => finish(true);
      script.onerror = () => finish(false);
      script.src = objectUrl;
      (document.head || document.documentElement).appendChild(script);
    });
  }
  function finish(body) {
    if (typeof body !== 'string') throw new TypeError('Asset replacement must produce a string');
    const installed = subtype === 'css' ? installCss(body) : installScript(body);
    const report = applied => ({ applied });
    return installed && typeof installed.then === 'function' ? installed.then(report) : report(installed);
  }
  function fail(error) {
    console.error('[SFV-I] Asset replacement failed:', error.stack || error.message);
    return { applied: false };
  }
  try {
    if (staticBody !== null) return finish(staticBody);
    const source = readOriginal();
    if (source && typeof source.then === 'function') {
      return source.then(text => replacementText(text)).then(finish).catch(fail);
    }
    const body = replacementText(source);
    if (body && typeof body.then === 'function') return Promise.resolve(body).then(finish).catch(fail);
    const finished = finish(body);
    return finished && typeof finished.then === 'function' ? finished.catch(fail) : finished;
  } catch (error) { return fail(error); }
}

export function notifyAssetRule(notification) {
  const hook = Reflect.ownKeys(window).reduce((found, key) => {
    if (found || typeof key !== 'symbol') return found;
    try { return window[key]?._sfvi === 1 ? window[key] : null; } catch { return null; }
  }, null);
  return hook?.notifyAsset?.(notification) === true;
}
