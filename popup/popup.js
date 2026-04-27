// popup.js — SFV-Interceptor

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
chrome.storage.local.get('sfvi_theme_vars', d => _applyThemeVars(d.sfvi_theme_vars));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.sfvi_theme_vars) {
    _applyThemeVars(changes.sfvi_theme_vars.newValue);
  }
});

let _allRules = [];
let _currentTab = 'active';

async function sendMsg(msg) { return chrome.runtime.sendMessage(msg); }
async function loadRules() { const r = await sendMsg({ type:'GET_RULES' }); return r.rules||[]; }

function typeLabel(t, sub) {
  if (t === 'html') return { js: 'JS', css: 'CSS', html: 'HTML' }[sub] || 'RES';
  return { rest: 'REST', graphql: 'GQL' }[t] || 'REST';
}
function typeCls(t, sub) {
  if (t === 'html') return { js: 'type-js', css: 'type-css', html: 'type-htm-sub' }[sub] || 'type-html';
  return { rest: 'type-rest', graphql: 'type-graphql' }[t] || 'type-rest';
}
function esc(s) {
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderRules() {
  const list   = document.getElementById('rules-list');
  const stats  = document.getElementById('stats');
  const active = _allRules.filter(r => r.enabled !== false).length;
  stats.innerHTML = `<b>${_allRules.length}</b> rules · <b>${active}</b> active`;

  const q = (document.getElementById('popup-search')?.value || '').toLowerCase();
  const filtered = (_currentTab === 'active'
    ? _sortedRules().filter(r => r.enabled !== false)
    : _sortedRules()).filter(r => {
      if (!q) return true;
      if ((r.name||'').toLowerCase().includes(q)) return true;
      // Search across all pairs, not just pairs[0]
      return (r.pairs||[]).some(p => (p.urlPattern||'').toLowerCase().includes(q));
    });

  if (!filtered.length) {
    const m = _currentTab === 'active' && _allRules.length
      ? { icon:'💤', title:'No active rules', text:'All rules are disabled.' }
      : { icon:'🛰️', title:'No mock rules yet', text:'Create one to start intercepting.' };
    list.innerHTML = `<div class="empty"><div class="empty-icon">${m.icon}</div>
      <div class="empty-title">${m.title}</div><p>${m.text}</p>
      <button class="btn-primary" id="empty-new-rule">+ New Rule</button></div>`;
    document.getElementById('empty-new-rule')?.addEventListener('click', () => openDashboard(null, 'new'));
    return;
  }

  list.innerHTML = filtered.map(r => `
    <div class="rule-item ${r.enabled !== false ? '' : 'disabled'}">
      <span class="rule-type-badge ${typeCls(r.resourceType, r.resourceSubtype)}">${typeLabel(r.resourceType, r.resourceSubtype)}</span>
      <div class="rule-info">
        <div class="rule-name">${esc(r.name||'Untitled')}</div>
        <div class="rule-url">${(() => {
            const p = r.pairs?.[0]?.urlPattern || r.urlPattern || '—';
            const extra = (r.pairs?.length || 0) > 1 ? ` +${r.pairs.length-1}` : '';
            return esc(p) + (extra ? `<span style="color:var(--accent);font-size:9px">${extra}</span>` : '');
          })()}</div>
      </div>
      <div class="rule-actions">
        <label class="toggle">
          <input type="checkbox" ${r.enabled!==false?'checked':''} data-toggle="${esc(r.id)}">
          <div class="toggle-track"><div class="toggle-thumb"></div></div>
        </label>
        <button class="btn-edit" data-edit="${esc(r.id)}" title="Edit">✎</button>
        <button class="btn-del"  data-del="${esc(r.id)}"  title="Delete">🗑</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('[data-toggle]').forEach(el =>
    el.addEventListener('change', async e => {
      e.stopPropagation();
      await sendMsg({ type:'TOGGLE_RULE', id:el.dataset.toggle });
      await refresh();
    })
  );
  list.querySelectorAll('[data-edit]').forEach(el =>
    el.addEventListener('click', () => openDashboard(el.dataset.edit))
  );
  list.querySelectorAll('[data-del]').forEach(el =>
    el.addEventListener('click', async () => {
      if (confirm('Delete this rule?')) {
        await sendMsg({ type:'DELETE_RULE', id:el.dataset.del });
        await refresh();
      }
    })
  );
}

async function refresh() { _allRules = await loadRules(); renderRules(); }

async function openDashboard(editId, action) {
  let url = chrome.runtime.getURL('dashboard/dashboard.html');
  if (editId) {
    url += '?edit=' + editId;
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
    _currentTab = tab.dataset.tab;
    renderRules();
  });
});

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
    return [..._allRules].sort((a, b) => {
      const ai = _customOrder.indexOf(a.id);
      const bi = _customOrder.indexOf(b.id);
      return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
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
});

document.getElementById('popup-search')?.addEventListener('input', () => renderRules());

refresh();
