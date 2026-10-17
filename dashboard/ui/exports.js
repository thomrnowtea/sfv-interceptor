import { serializeRules } from '../editor/compact.js';
import { showToast } from '../core/utils.js';

export async function downloadRules(rules, button) {
  const snapshot = structuredClone(rules);
  if (button) button.disabled = true;
  try {
    const json = await serializeRules(snapshot);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sfv-interceptor-rules.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast(`Exported ${snapshot.length} rule(s)`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}
