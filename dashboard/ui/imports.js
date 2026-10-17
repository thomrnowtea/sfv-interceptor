import { state } from '../core/state.js';
import { msg, showToast } from '../core/utils.js';
import { parseRuleDocument, fetchRuleDocument } from '../../shared/rule-document.js';
import { isRemoteRule } from '../../shared/rule-schema.js';
import { bindDialog } from '../../shared/dialogs.js';
import { compactRuleCopies } from '../editor/compact.js';

let callbacks = {};

async function importRules(raw) {
  const incoming = parseRuleDocument(raw);
  if (!incoming.length) throw new Error('No rules found');
  const localIds = new Set(state.allRules.filter(rule => !isRemoteRule(rule)).map(rule => rule.id));
  const conflicts = incoming.filter(rule => localIds.has(rule.id)).length;
  let strategy = 'skip';
  if (conflicts && confirm(`${conflicts} local rule(s) already have these IDs.\n\nOK: replace those local rules with the imported copy.\nCancel: keep existing rules and import only new IDs.`)) {
    strategy = 'overwrite';
  }
  const skipped = strategy === 'skip' ? incoming.filter(rule => localIds.has(rule.id)) : [];
  const candidates = incoming.filter(rule => !skipped.includes(rule));
  const compact = await compactRuleCopies(candidates);
  const result = await msg({ type: 'MERGE_RULES', rules: compact, strategy });
  result.skipped += skipped.length;
  await callbacks.refresh();
  showToast(`${result.added} added · ${result.updated} updated · ${result.skipped} skipped`);
}

export function openImportModal() {
  document.getElementById('import-url-input').value = '';
  document.getElementById('import-error').hidden = true;
  document.getElementById('import-modal').showModal();
}

async function importFromUrl() {
  const button = document.getElementById('import-from-url');
  const errorElement = document.getElementById('import-error');
  errorElement.hidden = true;
  button.disabled = true;
  button.textContent = 'Importing…';
  try {
    const rules = await fetchRuleDocument(document.getElementById('import-url-input').value.trim(), {
      signal: AbortSignal.timeout(15000),
    });
    await importRules(rules);
    document.getElementById('import-modal').close();
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Import a local copy';
  }
}

export function initImports(options) {
  callbacks = options;
  const dialog = document.getElementById('import-modal');
  bindDialog(dialog);
  const fileInput = document.getElementById('import-file');
  document.getElementById('import-all').addEventListener('click', openImportModal);
  document.getElementById('import-modal-close').addEventListener('click', () => dialog.close());
  document.getElementById('import-from-file').addEventListener('click', () => {
    dialog.close();
    fileInput.click();
  });
  fileInput.addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      await importRules(JSON.parse(await file.text()));
    } catch (error) {
      showToast('Import failed: ' + error.message, true);
    }
  });
  document.getElementById('import-from-url').addEventListener('click', importFromUrl);
  document.getElementById('import-url-input').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      document.getElementById('import-from-url').click();
    }
  });
  document.getElementById('import-open-source').addEventListener('click', () => {
    dialog.close();
    callbacks.subscribe();
  });
}
