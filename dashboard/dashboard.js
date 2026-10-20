import { state, sortedRules }                          from './core/state.js';
import { msg, showToast }                              from './core/utils.js';
import { initCodeMirror, destroyEditors }              from './editor/editor.js';
import { applyTheme, buildCustomVars, themeState, initTheme } from './ui/theme.js';
import { initSources, renderSources, openSourceModal }  from './ui/sources.js';
import { initImports, openImportModal }                 from './ui/imports.js';
import { isRemoteRule }                                from '../shared/rule-schema.js';
import { downloadRules }                               from './ui/exports.js';
import { icon }                                       from '../shared/icons.js';
import { renderNav, initNav, updateSelectButtons, initSidebar, closeRuleBrowser } from './ui/nav.js';
import { buildEditorHTML, bindEditorEvents, initRuleEditor }    from './ui/rule-editor.js';
import { showAppVersion } from '../shared/app-version.js';

// ── Coordination functions ────────────────────────────────────────────────────

function showEmpty() {
  state.view = 'rules';
  state.currentId = null;
  state.ghostRule = null;
  document.getElementById('btn-sources').classList.remove('active');
  destroyEditors();
  document.getElementById('main').innerHTML = `
    <div class="empty-main">
      <div class="empty-icon">${icon('rules')}</div>
      <h2>${state.allRules.length ? 'Choose a rule to inspect' : 'Your request workspace'}</h2>
      <p>${state.allRules.length ? 'Select a local rule to edit, or inspect a remote rule and its published version.' : 'Mock a response, modify a request, or follow your team’s shared rules.'}</p>
      <div class="empty-actions">
        <button type="button" class="btn-save" id="btn-new-empty">${icon('plus')} New rule</button>
        <button type="button" class="btn-close" id="btn-empty-import">${icon('download')} Import a copy</button>
      </div>
      <div class="empty-secondary">Have a shared JSON URL? <button type="button" id="btn-empty-subscribe">Subscribe for updates</button></div>
    </div>`;
  document.getElementById('btn-new-empty').addEventListener('click', newRule);
  document.getElementById('btn-empty-import').addEventListener('click', openImportModal);
  document.getElementById('btn-empty-subscribe').addEventListener('click', openSourceModal);
  renderNav(document.getElementById('search').value);
}

function showSources() {
  state.view = 'sources';
  state.currentId = null;
  state.ghostRule = null;
  destroyEditors();
  renderNav(document.getElementById('search').value);
  document.getElementById('btn-sources').classList.add('active');
  renderSources();
}

function selectRule(id, scroll = true, keyboard = false) {
  const rule = state.allRules.find(r => r.id === id);
  if (!rule) return;
  closeRuleBrowser();
  state.view = 'rules';
  document.getElementById('btn-sources').classList.remove('active');
  const prevScroll = !scroll ? (document.querySelector('.editor-body')?.scrollTop ?? 0) : 0;
  state.ghostRule = null;
  state.currentId = id;
  renderNav(document.getElementById('search').value);
  destroyEditors();
  document.getElementById('main').innerHTML = buildEditorHTML(rule);
  bindEditorEvents(rule, false);
  const eb = document.querySelector('.editor-body');
  if (eb) eb.scrollTop = scroll ? 0 : prevScroll;
  if (keyboard) document.getElementById('f-name').focus({ preventScroll: true });
}

function updateGhost() {
  if (!state.ghostRule) return;
  state.ghostRule.name            = document.getElementById('f-name')?.value || '';
  state.ghostRule.resourceType    = document.querySelector('#type-selector .type-btn.active')?.dataset.type || 'rest';
  state.ghostRule.resourceSubtype = document.querySelector('.subtype-btn.active')?.dataset.sub || 'js';
  state.ghostRule.urlPattern      = document.querySelector('.pair-url')?.value || '';
  renderNav(document.getElementById('search').value);
}

function newRule() {
  state.view = 'rules';
  state.origin = 'local';
  document.getElementById('btn-sources').classList.remove('active');
  state.currentId = null;
  state.ghostRule = { name: '', resourceType: 'rest', urlPattern: '' };
  renderNav(document.getElementById('search').value);
  destroyEditors();
  const blank = { enabled: true, resourceType: 'rest' };
  document.getElementById('main').innerHTML = buildEditorHTML(blank);
  bindEditorEvents(blank, true);
}

let refreshQueue = Promise.resolve();

function refresh() {
  const next = refreshQueue.then(async () => {
    const res = await msg({ type: 'GET_RULES' });
    state.allRules = res.rules || [];
    state.sources = res.sources || [];
    const applicationError = document.getElementById('apply-error');
    applicationError.textContent = res.applyError ? `${res.applyError}. Changes are saved; file interception needs to be reapplied.` : '';
    applicationError.hidden = !res.applyError;
    document.documentElement.style.setProperty('--apply-error-height', applicationError.offsetHeight + 'px');
    const knownIds = new Set(state.allRules.map(rule => rule.id));
    state.selectedIds = new Set([...state.selectedIds].filter(id => knownIds.has(id)));
    document.getElementById('source-count').textContent = state.sources.length;
    renderNav(document.getElementById('search').value);
    const selectBtn = document.getElementById('btn-select-rules');
    if (selectBtn) selectBtn.disabled = state.allRules.length === 0;
    updateSelectButtons();
  });
  refreshQueue = next.catch(() => {});
  return next;
}

// ── Wire callbacks ────────────────────────────────────────────────────────────

initNav({ onSelect: selectRule });
initRuleEditor({ renderNav, refresh, selectRule, showEmpty, updateGhost, showSources });
initSources({ refresh, showSources });
initImports({ refresh, subscribe: openSourceModal });
initSidebar();
initTheme();
showAppVersion();

// ── Global events ─────────────────────────────────────────────────────────────

document.getElementById('btn-new').addEventListener('click', newRule);
document.getElementById('btn-new').innerHTML = `${icon('plus')} New rule`;
document.getElementById('btn-theme').innerHTML = icon('theme');
for (const id of ['import-modal-close', 'source-modal-close', 'theme-panel-close']) {
  document.getElementById(id).innerHTML = icon('close');
}
document.getElementById('search-icon').innerHTML = icon('search');
document.getElementById('import-file-icon').innerHTML = icon('file');
document.getElementById('import-all').innerHTML = `${icon('download')} Import a copy`;
document.getElementById('btn-sources').insertAdjacentHTML('afterbegin', icon('link'));
document.getElementById('btn-sources').addEventListener('click', showSources);
document.getElementById('search').addEventListener('input', e => renderNav(e.target.value));
document.querySelectorAll('[data-origin]').forEach(button => {
  button.addEventListener('click', () => {
    state.origin = button.dataset.origin;
    renderNav(document.getElementById('search').value);
  });
});

// ── Sort controls ─────────────────────────────────────────────────────────────

function updateSortUI() {
  document.querySelectorAll('.sort-btn').forEach(btn =>
    {
      btn.classList.toggle('active', btn.dataset.sort === state.sortKey);
      btn.setAttribute('aria-pressed', String(btn.dataset.sort === state.sortKey));
    }
  );
  const dirBtn = document.getElementById('sort-dir');
  if (dirBtn) {
    dirBtn.textContent = state.sortDir === 'asc' ? '↑' : '↓';
    const showDir = state.sortKey !== 'custom';
    dirBtn.style.display = showDir ? '' : 'none';
    dirBtn.classList.toggle('active', showDir);
  }
  const arrangeBtn = document.getElementById('btn-sort-custom');
  if (arrangeBtn) {
    arrangeBtn.style.display = state.sortKey === 'custom' ? '' : 'none';
    arrangeBtn.classList.toggle('active', state.dragSortMode);
  }
  chrome.storage.local.set({ sfvi_sort_key: state.sortKey, sfvi_sort_dir: state.sortDir });
}

document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (state.sortKey !== btn.dataset.sort) state.dragSortMode = false;
    state.sortKey = btn.dataset.sort;
    updateSortUI();
    renderNav(document.getElementById('search').value);
  });
});

document.getElementById('btn-sort-custom')?.addEventListener('click', () => {
  state.dragSortMode = !state.dragSortMode;
  updateSortUI();
  renderNav(document.getElementById('search').value);
});

document.getElementById('sort-dir')?.addEventListener('click', () => {
  state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  updateSortUI();
  renderNav(document.getElementById('search').value);
});

// ── Select mode ───────────────────────────────────────────────────────────────

document.getElementById('btn-select-rules').addEventListener('click', () => {
  state.selectMode  = true;
  state.selectedIds = new Set();
  document.getElementById('btn-select-rules').style.display   = 'none';
  document.getElementById('btn-deselect-rules').style.display = '';
  document.getElementById('select-all-rules').style.display   = '';
  document.getElementById('select-actions').style.display     = '';
  updateSelectButtons();
  renderNav(document.getElementById('search').value);
});

document.getElementById('btn-deselect-rules').addEventListener('click', () => {
  state.selectMode  = false;
  state.selectedIds = new Set();
  document.getElementById('btn-select-rules').style.display   = '';
  document.getElementById('btn-deselect-rules').style.display  = 'none';
  document.getElementById('select-all-rules').style.display    = 'none';
  document.getElementById('select-actions').style.display      = 'none';
  updateSelectButtons();
  renderNav(document.getElementById('search').value);
});

document.getElementById('select-all-rules').addEventListener('click', () => {
  const visible = [...document.querySelectorAll('#rules-nav .nav-rule[data-id]')].map(row => row.dataset.id);
  const allSelected = visible.length > 0 && visible.every(id => state.selectedIds.has(id));
  state.selectedIds = allSelected ? new Set() : new Set(visible);
  updateSelectButtons();
  renderNav(document.getElementById('search').value);
});

document.getElementById('export-selected').addEventListener('click', event => {
  if (!state.selectedIds.size) { showToast('No rules selected', true); return; }
  const toExport = sortedRules().filter(r => state.selectedIds.has(r.id));
  void downloadRules(toExport, event.currentTarget);
});

document.getElementById('delete-selected').addEventListener('click', async () => {
  const localIds = new Set(state.allRules.filter(rule => state.selectedIds.has(rule.id) && !isRemoteRule(rule)).map(rule => rule.id));
  if (!localIds.size) return;
  if (!confirm(`Delete ${localIds.size} local rule(s)? This cannot be undone.`)) return;
  try {
    for (const id of localIds) await msg({ type: 'DELETE_RULE', id });
  } catch (error) { showToast(error.message, true); return; }
  state.customOrder = state.customOrder.filter(id => !localIds.has(id));
  chrome.storage.local.set({ sfvi_custom_order: state.customOrder });
  state.selectedIds = new Set();
  state.selectMode  = false;
  document.getElementById('btn-select-rules').style.display   = '';
  document.getElementById('btn-deselect-rules').style.display  = 'none';
  document.getElementById('select-all-rules').style.display    = 'none';
  document.getElementById('select-actions').style.display      = 'none';
  updateSelectButtons();
  await refresh();
  showEmpty();
  showToast('Rules deleted');
});

// ── Import modal ──────────────────────────────────────────────────────────────

(async () => {
  initCodeMirror();
  await new Promise(res => chrome.storage.local.get(
    ['sfvi_sort_key','sfvi_sort_dir','sfvi_custom_order','sfvi_theme','sfvi_theme_custom'],
    d => {
      if (d.sfvi_sort_key) state.sortKey = d.sfvi_sort_key;
      if (d.sfvi_sort_dir) state.sortDir = d.sfvi_sort_dir;
      if (Array.isArray(d.sfvi_custom_order)) state.customOrder = d.sfvi_custom_order;
      if (d.sfvi_theme_custom) Object.assign(themeState.custom, d.sfvi_theme_custom);
      const themeId = d.sfvi_theme || 'default';
      if (themeId === 'custom') {
        applyTheme('custom', buildCustomVars(themeState.custom.bg, themeState.custom.accent, themeState.custom.surface));
      } else {
        applyTheme(themeId);
      }
      res();
    }
  ));

  await refresh();
  updateSortUI();

  const params    = new URLSearchParams(location.search);
  const editId    = params.get('edit');
  const action    = params.get('action');

  if (editId && state.allRules.find(r => r.id === editId)) {
    selectRule(editId);
  } else if (action === 'new') {
    newRule();
    const prefillUrl = params.get('prefillUrl');
    if (prefillUrl) setTimeout(() => {
      const input = document.querySelector('.pair-url');
      if (input) { input.value = prefillUrl; updateGhost(); }
    }, 60);
  } else {
    showEmpty();
  }

  if (action === 'export' && state.allRules.length) {
    await downloadRules(state.allRules);
  }
})();

// ── Auto-sync with other dashboard tabs / popup ───────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'RULES_CHANGED') return;
  (async () => {
    const previous = state.allRules.find(rule => rule.id === state.currentId);
    await refresh();
    if (state.view === 'sources') {
      if (!state.sourceActionPending && !document.activeElement?.closest('[data-edit-source]')) renderSources();
      sendResponse({});
      return;
    }
    if (state.currentId) {
      const updated = state.allRules.find(r => r.id === state.currentId);
      if (!updated) { showEmpty(); sendResponse({}); return; }
      if (isRemoteRule(updated) && JSON.stringify(updated) !== JSON.stringify(previous)) {
        selectRule(updated.id, false);
      }
      if (updated) {
        const toggle = document.getElementById('f-enabled');
        if (toggle) toggle.checked = updated.enabled !== false;
        const hdr = document.getElementById('editor-header');
        if (hdr) {
          hdr.classList.toggle('is-active',   updated.enabled !== false);
          hdr.classList.toggle('is-inactive', updated.enabled === false);
        }
      }
    }
    sendResponse({});
  })().catch(error => { showToast(error.message, true); sendResponse({}); });
  return true;
});
