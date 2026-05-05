(function() {
  'use strict';

  window.addEventListener('message', (ev) => {
    if (!ev.data) return;
    if (ev.data.type !== '__sfvi_sandbox_exec__') return;

    try {
      const fn = new Function(ev.data.code + '\nreturn modifyResponse(arguments[0]);');
      const result = fn(ev.data.args);
      const serialized = result == null ? '' : (typeof result === 'string' ? result : JSON.stringify(result));

      ev.source.postMessage({
        type: '__sfvi_sandbox_result__',
        id: ev.data.id,
        result: serialized,
      }, '*');
    } catch (err) {
      ev.source.postMessage({
        type: '__sfvi_sandbox_result__',
        id: ev.data.id,
        error: err.message || String(err),
      }, '*');
    }
  });

  // Notify parent that sandbox is ready
  window.parent.postMessage({ type: '__sfvi_sandbox_ready__' }, '*');
})();
