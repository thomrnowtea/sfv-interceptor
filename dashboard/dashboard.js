import { state, sortedRules }                          from './core/state.js';
import { msg, showToast }                              from './core/utils.js';
import { initCodeMirror, destroyEditors }              from './editor/editor.js';
import { applyTheme, buildCustomVars, themeState, initTheme } from './ui/theme.js';
import { fromRQ }                                      from './core/converters.js';
import { renderNav, initNav, updateSelectButtons, initSidebar } from './ui/nav.js';
import { buildEditorHTML, bindEditorEvents, initRuleEditor }    from './ui/rule-editor.js';

// ── Coordination functions ────────────────────────────────────────────────────

function showEmpty() {
  state.ghostRule = null;
  destroyEditors();
  document.getElementById('main').innerHTML = `
    <div class="empty-main">
      <div class="empty-icon">🛰️</div>
      <h2>No rule selected</h2>
      <p>Select a rule from the sidebar, or create a new one to start intercepting requests.</p>
      <button class="btn-new-sidebar" style="max-width:200px;margin-top:4px" id="btn-new-empty">+ New Rule</button>
    </div>`;
  document.getElementById('btn-new-empty').addEventListener('click', newRule);
}

function selectRule(id, scroll = true) {
  const rule = state.allRules.find(r => r.id === id);
  if (!rule) return;
  const prevScroll = !scroll ? (document.querySelector('.editor-body')?.scrollTop ?? 0) : 0;
  state.ghostRule = null;
  state.currentId = id;
  renderNav(document.getElementById('search').value);
  destroyEditors();
  document.getElementById('main').innerHTML = buildEditorHTML(rule);
  bindEditorEvents(rule, false);
  const eb = document.querySelector('.editor-body');
  if (eb) eb.scrollTop = scroll ? 0 : prevScroll;
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
  state.currentId = null;
  state.ghostRule = { name: '', resourceType: 'rest', urlPattern: '' };
  renderNav(document.getElementById('search').value);
  destroyEditors();
  const blank = { enabled: true, resourceType: 'rest' };
  document.getElementById('main').innerHTML = buildEditorHTML(blank);
  bindEditorEvents(blank, true);
  setTimeout(() => {
    document.getElementById('f-name')?.addEventListener('input', updateGhost);
    document.querySelector('.pair-url')?.addEventListener('input', updateGhost);
    document.querySelectorAll('#type-selector .type-btn').forEach(btn =>
      btn.addEventListener('click', updateGhost)
    );
  }, 50);
}

let _refreshing = false;
let _refreshPending = false;

async function refresh() {
  if (_refreshing) { _refreshPending = true; return; }
  _refreshing = true;
  try {
    const res = await msg({ type: 'GET_RULES' });
    state.allRules = res.rules || [];
    renderNav(document.getElementById('search').value);
    const selectBtn = document.getElementById('btn-select-rules');
    if (selectBtn) selectBtn.disabled = state.allRules.length === 0;
  } finally {
    _refreshing = false;
    if (_refreshPending) { _refreshPending = false; refresh(); }
  }
}

// ── Wire callbacks ────────────────────────────────────────────────────────────

initNav({ onSelect: selectRule });
initRuleEditor({ renderNav, refresh, selectRule, showEmpty, updateGhost });
initSidebar();
initTheme();

// ── Global events ─────────────────────────────────────────────────────────────

document.getElementById('btn-new').addEventListener('click', newRule);
document.getElementById('search').addEventListener('input', e => renderNav(e.target.value));

// ── Sort controls ─────────────────────────────────────────────────────────────

function updateSortUI() {
  document.querySelectorAll('.sort-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.sort === state.sortKey)
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
  const allSelected = state.allRules.length > 0 && state.allRules.every(r => state.selectedIds.has(r.id));
  state.selectedIds = allSelected ? new Set() : new Set(state.allRules.map(r => r.id));
  updateSelectButtons();
  renderNav(document.getElementById('search').value);
});

document.getElementById('export-selected').addEventListener('click', () => {
  if (!state.selectedIds.size) { showToast('No rules selected', true); return; }
  const toExport = sortedRules().filter(r => state.selectedIds.has(r.id));
  const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'sfv-interceptor-rules.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast(`↑ Exported ${toExport.length} rule(s)`);
});

document.getElementById('delete-selected').addEventListener('click', async () => {
  if (!state.selectedIds.size) return;
  if (!confirm(`Delete ${state.selectedIds.size} rule(s)? This cannot be undone.`)) return;
  for (const id of state.selectedIds) await msg({ type: 'DELETE_RULE', id });
  state.customOrder = state.customOrder.filter(id => !state.selectedIds.has(id));
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

async function processImportRaw(raw) {
  if (!Array.isArray(raw)) { showToast('Expected JSON array', true); return; }
  const isRQ = raw.length === 0 || (raw[0] && typeof raw[0] === 'object' && (raw[0].objectType === 'rule' || raw[0].ruleType));
  const incoming = isRQ ? raw.map(fromRQ) : raw;
  if (!incoming.length) { showToast('No rules found', true); return; }

  const existingIds = new Set(state.allRules.map(r => r.id));
  const conflicts   = incoming.filter(r => existingIds.has(r.id)).length;
  const fresh       = incoming.length - conflicts;

  let strategy = 'skip';
  if (conflicts > 0) {
    const overwrite = confirm(
      `Importing ${incoming.length} rule(s):\n` +
      `  • ${fresh} new\n` +
      `  • ${conflicts} already exist (same ID)\n\n` +
      `OK → overwrite existing\nCancel → keep existing, import only new`
    );
    strategy = overwrite ? 'overwrite' : 'skip';
  }

  try {
    const res = await msg({ type: 'MERGE_RULES', rules: incoming, strategy });
    await refresh();
    showToast(`✓ ${res.added} added · ${res.updated} updated · ${res.skipped} skipped`);
  } catch (e) {
    showToast('Import failed: ' + (e.message || 'unknown error'), true);
  }
}

const importModal    = document.getElementById('import-modal');
const importUrlInput = document.getElementById('import-url-input');
const importUrlBtn   = document.getElementById('import-from-url');

function openImportModal()  { importModal.style.display = 'flex'; importUrlInput.value = ''; }
function closeImportModal() { importModal.style.display = 'none'; }

document.getElementById('import-all').addEventListener('click', openImportModal);
document.getElementById('import-modal-close').addEventListener('click', closeImportModal);
importModal.addEventListener('click', e => { if (e.target === importModal) closeImportModal(); });

document.getElementById('import-from-file').addEventListener('click', () => {
  closeImportModal();
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return; e.target.value = '';
  let raw;
  try { raw = JSON.parse(await file.text()); } catch { showToast('Invalid JSON', true); return; }
  await processImportRaw(raw);
});

importUrlBtn.addEventListener('click', async () => {
  const url = importUrlInput.value.trim();
  if (!url) { showToast('Enter a URL', true); return; }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') { showToast('Only HTTPS URLs are allowed', true); return; }
  } catch { showToast('Invalid URL', true); return; }
  importUrlBtn.disabled = true; importUrlBtn.textContent = '...';
  try {
    const response = await fetch(url);
    if (!response.ok) { showToast(`HTTP ${response.status}`, true); return; }
    let raw;
    try { raw = await response.json(); } catch { showToast('Response is not valid JSON', true); return; }
    closeImportModal();
    await processImportRaw(raw);
  } catch (err) {
    showToast('Fetch failed: ' + err.message, true);
  } finally {
    importUrlBtn.disabled = false; importUrlBtn.textContent = '↓ Fetch';
  }
});

importUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') importUrlBtn.click(); });

// ── Init ──────────────────────────────────────────────────────────────────────

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
    const blob = new Blob([JSON.stringify(state.allRules, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'sfv-interceptor-rules.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
})();

// ── Auto-sync with other dashboard tabs / popup ───────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'RULES_CHANGED') return;
  (async () => {
    await refresh();
    if (state.currentId) {
      const updated = state.allRules.find(r => r.id === state.currentId);
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
  })();
  return true;
});
