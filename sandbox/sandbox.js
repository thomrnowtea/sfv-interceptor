(function() {
  'use strict';

  const modifiers = { __sfvi_sandbox_exec__: 'modifyResponse', __sfvi_sandbox_exec_request__: 'modifyRequest' };

  function parentMessage(event) {
    return event.source === window.parent && event.data && typeof event.data.type === 'string';
  }

  function errorMessage(error) {
    try { return String(error?.message ?? error) || 'Modifier failed'; }
    catch { return 'Modifier failed'; }
  }

  async function execute(data) {
    if (typeof data.code !== 'string' || !data.args || typeof data.args !== 'object' || Array.isArray(data.args)) throw new Error('Invalid sandbox request');
    const fn = new Function(data.code + '\nreturn ' + modifiers[data.type] + '(arguments[0]);');
    const result = await fn(data.args);
    const serialized = result == null ? '' : (typeof result === 'string' ? result : JSON.stringify(result));
    if (typeof serialized !== 'string') throw new Error('Modifier result cannot be serialized');
    return serialized;
  }

  window.addEventListener('message', async (ev) => {
    if (!parentMessage(ev)) return;
    if (ev.data.type === '__sfvi_sandbox_ping__') {
      ev.source.postMessage({ type: '__sfvi_sandbox_ready__' }, '*');
      return;
    }
    if (!Object.hasOwn(modifiers, ev.data.type)) return;
    if (typeof ev.data.id !== 'string' || !ev.data.id) return;
    try {
      const result = await execute(ev.data);
      ev.source.postMessage({ type: '__sfvi_sandbox_result__', id: ev.data.id, result }, '*');
    } catch (err) {
      ev.source.postMessage({ type: '__sfvi_sandbox_result__', id: ev.data.id, error: errorMessage(err) }, '*');
    }
  });

  // Notify parent that sandbox is ready
  window.parent.postMessage({ type: '__sfvi_sandbox_ready__' }, '*');
})();
