import { state } from '../core/state.js';
import { msg, showToast } from '../core/utils.js';
import { mountEditor, getEditorValue, setEditorValue, formatEditor } from '../editor/editor.js';
import { bodyLanguage } from '../editor/formatter.js';
import { compactRuleCopy } from '../editor/compact.js';
import { inspectRuleCode, showSecurityWarning, updateRiskBar, scheduleRiskAnalysis } from '../core/security.js';
import { isRemoteRule, normalizeVersion } from '../../shared/rule-schema.js';

const RESPONSE_IDS = { static: 'f-body-static', dynamic: 'f-body-dynamic' };
const REQUEST_IDS = { static: 'f-req-body-static', dynamic: 'f-req-modifier' };

function value(id) {
  return document.getElementById(id)?.value ?? '';
}

function rowValue(row, selector) {
  return row.querySelector(selector)?.value.trim() ?? '';
}

function readPairs(editor) {
  return [...editor.body.querySelectorAll('.pair-row')].map((row, index) => ({
    id: editor.pairs[index].id,
    urlPattern: rowValue(row, '.pair-url'),
    urlOperator: rowValue(row, '.pair-operator'),
    method: rowValue(row, '.pair-method'),
    caseSensitive: row.querySelector('.pair-cs').dataset.cs === 'true',
    redirectUrl: rowValue(row, '.pair-redirect-url'),
    gqlOperation: value('f-gql-op').trim(),
  }));
}

function collectRule(editor) {
  return {
    id: editor.rule.id ?? null,
    name: value('f-name').trim(),
    version: value('f-version').trim(),
    description: value('f-description').trim(),
    enabled: document.getElementById('f-enabled').checked,
    resourceType: editor.resourceType,
    resourceSubtype: editor.resourceType === 'html' ? editor.resourceSubtype : undefined,
    pairs: readPairs(editor),
    request: { type: editor.requestType, body: getEditorValue(REQUEST_IDS[editor.requestType]), customHeaders: value('f-req-headers').trim() },
    response: {
      type: editor.responseType,
      body: getEditorValue(RESPONSE_IDS[editor.responseType]),
      statusCode: value('f-status'),
      delay: Number(value('f-delay')) || 0,
      customHeaders: value('f-headers').trim(),
    },
  };
}

function checkDirty(editor) {
  const dirty = editor.isNew || JSON.stringify(collectRule(editor)) !== editor.snapshot;
  editor.saveButton.style.display = dirty ? '' : 'none';
  editor.closeButton.textContent = dirty ? 'Cancel' : 'Close';
  editor.callbacks.updateGhost?.();
}

function selectButton(button, selector) {
  document.querySelectorAll(selector).forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
}

function refreshPairs(editor, pairs) {
  editor.pairs = pairs;
  editor.body.querySelector('#pairs-list').innerHTML = pairs.map(editor.buildPairRow).join('');
  bindPairEvents(editor);
  checkDirty(editor);
}

function bindPairEvents(editor) {
  editor.body.querySelectorAll('.pair-row').forEach((row, index) => {
    row.querySelectorAll('input,select').forEach(input => {
      input.addEventListener('input', () => checkDirty(editor));
    });
    const caseButton = row.querySelector('.pair-cs');
    caseButton.setAttribute('aria-pressed', caseButton.dataset.cs);
    caseButton.addEventListener('click', () => {
      caseButton.dataset.cs = String(caseButton.dataset.cs !== 'true');
      caseButton.setAttribute('aria-pressed', caseButton.dataset.cs);
      checkDirty(editor);
    });
    row.querySelector('.pair-redirect-btn').addEventListener('click', event => {
      const wrap = row.querySelector('.pair-redirect-wrap');
      const open = wrap.style.display === 'none';
      wrap.style.display = open ? '' : 'none';
      event.currentTarget.classList.toggle('active', open);
      event.currentTarget.setAttribute('aria-expanded', String(open));
      if (open) row.querySelector('.pair-redirect-url').focus();
    });
    row.querySelector('.pair-remove')?.addEventListener('click', () => {
      const pairs = readPairs(editor);
      pairs.splice(index, 1);
      refreshPairs(editor, pairs);
      editor.body.querySelectorAll('.pair-url')[Math.max(0, index - 1)]?.focus();
    });
  });
}

function bindResourceTypes(editor) {
  editor.body.querySelectorAll('.type-btn').forEach(button => {
    button.addEventListener('click', () => {
      editor.resourceType = button.dataset.type;
      editor.formatRevision++;
      selectButton(button, '.type-btn');
      document.getElementById('subtype-selector').style.display = editor.resourceType === 'html' ? 'flex' : 'none';
      document.getElementById('graphql-fields').style.display = editor.resourceType === 'graphql' ? '' : 'none';
      checkDirty(editor);
      updateRiskBar(editor);
    });
  });
  editor.body.querySelectorAll('.subtype-btn').forEach(button => {
    button.addEventListener('click', () => {
      editor.resourceSubtype = button.dataset.sub;
      editor.formatRevision++;
      selectButton(button, '.subtype-btn');
      checkDirty(editor);
      updateRiskBar(editor);
    });
  });
}

function bindBodyTabs(editor, selector, property, dataKey, panels) {
  editor.body.querySelectorAll(selector).forEach(button => {
    button.addEventListener('click', () => {
      const type = button.dataset[dataKey];
      editor[property] = type;
      editor.formatRevision++;
      selectButton(button, selector);
      for (const [kind, id] of Object.entries(panels)) document.getElementById(id).style.display = type === kind ? '' : 'none';
      checkDirty(editor);
      updateRiskBar(editor);
    });
  });
}

function mountBodies(editor, readOnly) {
  const ids = [...Object.values(REQUEST_IDS), ...Object.values(RESPONSE_IDS)];
  for (const id of ids) {
    mountEditor(id, value(id), () => {
      if (!readOnly) checkDirty(editor);
    }, { readOnly, getLanguage: () => bodyLanguage(id, editor), contextVersion: () => editor.formatRevision,
      onVisibleChange: () => scheduleRiskAnalysis(editor) });
  }
}

function bindCodeActions(editor) {
  const templates = {
    static: editor.resourceType === 'html' ? '// Return the full file content as a string\n' : '{\n  "success": true,\n  "data": []\n}',
    dynamic: editor.resourceType === 'html'
      ? 'function modifyResponse(args) {\n  const { url, response } = args;\n  return response;\n}'
      : 'function modifyResponse(args) {\n  const { responseJSON } = args;\n  return { ...responseJSON, mocked: true };\n}',
    'req-static': '{\n  \n}',
    'req-modifier': 'function modifyRequest(args) {\n  const { requestJSON } = args;\n  return requestJSON;\n}',
  };
  const fields = { static: 'f-body-static', dynamic: 'f-body-dynamic', 'req-static': 'f-req-body-static', 'req-modifier': 'f-req-modifier' };
  for (const [action, id] of Object.entries(fields)) {
    const formatButton = document.getElementById('fmt-' + action);
    formatButton.addEventListener('click', () => {
      void formatEditor(id, { language: bodyLanguage(id, editor), contextVersion: () => editor.formatRevision, button: formatButton });
    });
    document.getElementById('tpl-' + action).addEventListener('click', () => { setEditorValue(id, templates[action]); checkDirty(editor); });
  }
}

function validateEditorRule(rule) {
  if (!rule.name) throw new Error('Rule name is required');
  rule.version = normalizeVersion(rule.version);
  rule.pairs = rule.pairs.filter(pair => pair.urlPattern);
  if (!rule.pairs.length) throw new Error('At least one URL pattern is required');
  const customizations = [rule.request.body, rule.response.body, rule.request.customHeaders, rule.response.customHeaders, ...rule.pairs.map(pair => pair.redirectUrl)];
  if (!customizations.some(text => text.trim())) throw new Error('Add a body, custom headers, or a redirect URL');
  for (const id of ['f-status', 'f-delay']) {
    const field = document.getElementById(id);
    if (!field.checkValidity()) throw new Error(field.validationMessage);
  }
}

async function approveCode(rule) {
  const risks = inspectRuleCode(rule).filter(risk => risk.sev >= 2);
  return risks.length === 0 || await showSecurityWarning(risks);
}

async function persistEditedRule(editor, rule, captured) {
  const compact = await compactRuleCopy(rule);
  if (!editor.body.isConnected) return null;
  if (JSON.stringify(collectRule(editor)) !== captured) throw new Error('The rule changed while saving. Save again to include your latest edits.');
  const result = await msg({ type: 'SAVE_RULE', rule: compact });
  return result.rule;
}

async function rememberSavedRule(saved) {
  const index = state.allRules.findIndex(item => item.id === saved.id);
  if (index === -1) state.allRules.push(saved);
  else state.allRules[index] = saved;
  if (!state.customOrder.includes(saved.id)) {
    state.customOrder.push(saved.id);
    await chrome.storage.local.set({ sfvi_custom_order: state.customOrder });
  }
  state.ghostRule = null;
}

async function saveEditedRule(editor) {
  editor.saveButton.disabled = true;
  editor.formatRevision++;
  try {
    const rule = collectRule(editor);
    const captured = JSON.stringify(rule);
    validateEditorRule(rule);
    if (!await approveCode(rule)) return;
    const saved = await persistEditedRule(editor, rule, captured);
    if (!saved) return;
    await rememberSavedRule(saved);
    if (!editor.body.isConnected) { await editor.callbacks.refresh(); return; }
    editor.callbacks.selectRule(saved.id, false);
    await editor.callbacks.refresh();
    showToast('Rule saved');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    editor.saveButton.disabled = false;
  }
}

async function deleteEditedRule(editor) {
  if (!confirm('Delete this local rule?')) return;
  try {
    await msg({ type: 'DELETE_RULE', id: editor.rule.id });
    state.customOrder = state.customOrder.filter(id => id !== editor.rule.id);
    await chrome.storage.local.set({ sfvi_custom_order: state.customOrder });
    await editor.callbacks.refresh();
    editor.callbacks.showEmpty();
    showToast('Rule deleted');
  } catch (error) {
    showToast(error.message, true);
  }
}

function bindReadOnlyEditor(editor) {
  editor.body.querySelectorAll('input, textarea').forEach(input => {
    input.readOnly = true;
    if (input.type === 'checkbox') input.disabled = true;
  });
  editor.body.querySelectorAll('button:not(#btn-source-details), select').forEach(input => { input.disabled = true; });
  editor.saveButton.disabled = true;
  editor.saveButton.style.display = 'none';
  document.getElementById('btn-source-details').addEventListener('click', editor.callbacks.showSources);
  mountBodies(editor, true);
  updateRiskBar(editor);
}

export function bindRuleEditor(rule, isNew, callbacks, buildPairRow) {
  const editor = {
    formatRevision: 0,
    rule, isNew, callbacks, buildPairRow,
    body: document.querySelector('.editor-body'),
    saveButton: document.getElementById('btn-save'),
    closeButton: document.getElementById('btn-close'),
    resourceType: rule.resourceType || 'rest',
    resourceSubtype: rule.resourceSubtype || 'html',
    responseType: rule.response?.type || 'static',
    requestType: rule.request?.type || 'static',
    pairs: structuredClone(rule.pairs || [{ id: 'pair_' + crypto.randomUUID() }]),
  };
  editor.closeButton.addEventListener('click', callbacks.showEmpty);
  if (isRemoteRule(rule)) { bindReadOnlyEditor(editor); return; }
  mountBodies(editor, false);
  editor.snapshot = JSON.stringify(collectRule(editor));
  document.querySelectorAll('#f-name, #f-version, #f-description, #f-status, #f-delay, #f-headers, #f-req-headers, #f-gql-op').forEach(input => {
    input.addEventListener('input', () => checkDirty(editor));
  });
  bindPairEvents(editor);
  bindResourceTypes(editor);
  bindBodyTabs(editor, '.resp-tab', 'responseType', 'resp', { static: 'static-body-field', dynamic: 'dynamic-body-field' });
  bindBodyTabs(editor, '.req-tab', 'requestType', 'reqBody', { static: 'req-static-body-field', dynamic: 'req-dynamic-body-field' });
  bindCodeActions(editor);
  document.getElementById('btn-add-pair').addEventListener('click', () => {
    refreshPairs(editor, [...readPairs(editor), { id: 'pair_' + crypto.randomUUID() }]);
  });
  editor.saveButton.addEventListener('click', () => saveEditedRule(editor));
  document.getElementById('btn-delete')?.addEventListener('click', () => deleteEditedRule(editor));
  checkDirty(editor);
  updateRiskBar(editor);
}
