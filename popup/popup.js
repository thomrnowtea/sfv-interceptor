import { icon } from '../shared/icons.js';
import { renderPopupRuleList } from './rule-list.js';
import { resolveTheme } from '../shared/themes.js';
import { showAppVersion } from '../shared/app-version.js';

showAppVersion();

// ── Theme sync ────────────────────────────────────────────────────────────────
function _applyThemeVars(vars) {
  if (!vars) return;
  const root = document.documentElement;
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  const bg = vars['--bg'];
  if (bg?.startsWith('#') && bg.length >= 7) {
    const r = parseInt(bg.slice(1,3), 16), g = parseInt(bg.slice(3,5), 16), b = parseInt(bg.slice(5,7), 16);
    root.setAttribute('data-scheme', (0.299*r + 0.587*g + 0.114*b) / 255 > 0.5 ? 'light' : 'dark');
  }
}
function refreshTheme() {
  return chrome.storage.local.get(['sfvi_theme', 'sfvi_theme_vars', 'sfvi_theme_custom']).then(stored => _applyThemeVars(resolveTheme(stored)));
}
refreshTheme();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.sfvi_theme_vars || changes.sfvi_theme || changes.sfvi_theme_custom)) {
    refreshTheme();
  }
});

let _allRules = [];
let _currentTab = 'active';
let _activeTabId = null;
let _appliedRuleIds = new Set();
let _refreshRevision = 0;

async function sendMsg(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}
async function loadRules() {
  const response = await sendMsg({ type: 'GET_RULES' });
  const errorElement = document.getElementById('popup-error');
  errorElement.textContent = response.applyError || '';
  errorElement.hidden = !response.applyError;
  return response.rules || [];
}

function renderRules() {
  const active = _allRules.filter(rule => rule.enabled !== false).length;
  document.getElementById('stats').innerHTML = '<b>' + _allRules.length + '</b> rules / <b>' + active + '</b> active';
  renderPopupRuleList({
    rules: _sortedRules(),
    tab: _currentTab,
    query: document.getElementById('popup-search').value,
    appliedRuleIds: _appliedRuleIds,
    onToggle: async id => {
      try { await sendMsg({ type: 'TOGGLE_RULE', id }); }
      finally { await refresh(); } // Publication can fail after activation was saved.
    },
  });
}

async function refresh() {
  const revision = ++_refreshRevision;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [rules, activity] = await Promise.all([
      loadRules(), tab ? sendMsg({ type: 'GET_TAB_ACTIVITY', tabId: tab.id }) : Promise.resolve({ appliedRuleIds: [] }),
    ]);
    if (revision !== _refreshRevision) return;
    _activeTabId = tab?.id ?? null;
    _allRules = rules;
    _appliedRuleIds = new Set(activity.appliedRuleIds || []);
    renderRules();
  } catch (error) {
    const errorElement = document.getElementById('popup-error');
    errorElement.textContent = error.message;
    errorElement.hidden = false;
  }
}

async function openDashboard(editId, action) {
  let url = chrome.runtime.getURL('dashboard/dashboard.html');
  if (editId) {
    url += '?edit=' + encodeURIComponent(editId);
  } else if (action === 'new') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabUrl = tab?.url || '';
    url += '?action=new';
    if (tabUrl && !/^(chrome|about|devtools|chrome-extension):/.test(tabUrl))
      url += '&prefillUrl=' + encodeURIComponent(tabUrl);
  } else if (action) {
    url += '?action=' + action;
  }
  chrome.tabs.create({ url });
  window.close();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab').forEach(item => item.setAttribute('aria-pressed', String(item === tab)));
    _currentTab = tab.dataset.tab;
    renderRules();
  });
});

document.getElementById('new-rule').innerHTML = `${icon('plus')} New rule`;
document.getElementById('popup-search-icon').innerHTML = icon('search');
document.getElementById('new-rule').addEventListener('click', () => openDashboard(null, 'new'));
document.getElementById('open-dashboard').addEventListener('click', () => openDashboard(null));




// ── Sort (mirrors dashboard sort stored in chrome.storage.local) ──────────────
let _sortKey = 'custom', _sortDir = 'asc', _customOrder = [];
const _typeOrder = { rest: 0, graphql: 1, html: 2 };
const _subOrder  = { html: 0, css: 1, js: 2 };

chrome.storage.local.get(['sfvi_sort_key', 'sfvi_sort_dir', 'sfvi_custom_order'], d => {
  _sortKey     = d.sfvi_sort_key  || 'custom';
  _sortDir     = d.sfvi_sort_dir  || 'asc';
  _customOrder = Array.isArray(d.sfvi_custom_order) ? d.sfvi_custom_order : [];
  renderRules();
});

function _sortedRules() {
  if (_sortKey === 'custom') {
    if (!_customOrder.length) return [..._allRules];
    const orderMap = new Map(_customOrder.map((id, i) => [id, i]));
    return [..._allRules].sort((a, b) => {
      const ai = orderMap.get(a.id);
      const bi = orderMap.get(b.id);
      return (ai === undefined ? Infinity : ai) - (bi === undefined ? Infinity : bi);
    });
  }
  return [..._allRules].sort((a, b) => {
    let va, vb;
    if (_sortKey === 'name') {
      va = (a.name||'').toLowerCase();
      vb = (b.name||'').toLowerCase();
    } else {
      const ta = (_typeOrder[a.resourceType]??99) * 10 + (_subOrder[a.resourceSubtype]??9);
      const tb = (_typeOrder[b.resourceType]??99) * 10 + (_subOrder[b.resourceSubtype]??9);
      va = ta; vb = tb;
    }
    if (va < vb) return _sortDir === 'asc' ? -1 :  1;
    if (va > vb) return _sortDir === 'asc' ?  1 : -1;
    return 0;
  });
}

// Auto-refresh when rules change from any context (dashboard, another popup)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'RULES_CHANGED') refresh();
  if (msg?.type === 'ACTIVITY_CHANGED' && (_activeTabId === null || msg.tabId === _activeTabId)) refresh();
});
chrome.tabs.onActivated.addListener(() => refresh());

document.getElementById('popup-search')?.addEventListener('input', () => renderRules());

refresh();
