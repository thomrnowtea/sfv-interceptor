import { state, sortedRules } from '../core/state.js';
import { esc, msg } from '../core/utils.js';

let _onSelect = null;

export function initNav({ onSelect }) {
  _onSelect = onSelect;
}

export function navRuleClass(t, sub) {
  if (t === 'html') return { js: 'nr-js', css: 'nr-css', html: 'nr-html' }[sub] || 'nr-html';
  return { rest: 'nr-rest', graphql: 'nr-graphql' }[t] || 'nr-rest';
}

export function hrClass(t, sub) {
  if (t === 'html') return { js: 'hr-js', css: 'hr-css', html: 'hr-html' }[sub] || 'hr-html';
  return { rest: 'hr-rest', graphql: 'hr-graphql' }[t] || 'hr-rest';
}

export function typeClass(t, sub) {
  if (t === 'html') return { js: 't-js', css: 't-css', html: 't-htm-sub' }[sub] || 't-html';
  return { rest: 't-rest', graphql: 't-graphql', html: 't-html' }[t] || 't-rest';
}

export function typeLabel(t, sub) {
  if (t === 'html') return { js: 'JS', css: 'CSS', html: 'HTML' }[sub] || 'RES';
  return { rest: 'REST', graphql: 'GQL' }[t] || 'REST';
}

export function updateSelectButtons() {
  const count     = state.selectedIds.size;
  const exportBtn = document.getElementById('export-selected');
  const deleteBtn = document.getElementById('delete-selected');
  const allBtn    = document.getElementById('select-all-rules');
  if (exportBtn) exportBtn.textContent = count ? `↑ Export (${count})` : '↑ Export';
  if (deleteBtn) deleteBtn.textContent = count ? `🗑 Delete (${count})` : '🗑 Delete';
  if (allBtn) {
    const allSelected = state.allRules.length > 0 && state.allRules.every(r => state.selectedIds.has(r.id));
    allBtn.textContent = allSelected ? '☐ None' : '☑ All';
  }
}

export function renderNav(filter = '') {
  const nav = document.getElementById('rules-nav');
  const q = filter.toLowerCase();
  const list = sortedRules().filter(r => {
    if (!q) return true;
    if ((r.name || '').toLowerCase().includes(q)) return true;
    return (r.pairs || []).some(p => (p.urlPattern || '').toLowerCase().includes(q));
  });

  const ghostHTML = state.ghostRule ? `
    <div class="nav-rule ghost active">
      <span class="nav-rule-type ${typeClass(state.ghostRule.resourceType || 'rest', state.ghostRule.resourceSubtype)}">${typeLabel(state.ghostRule.resourceType || 'rest', state.ghostRule.resourceSubtype)}</span>
      <div class="nav-rule-info">
        <div class="nav-rule-name">${esc(state.ghostRule.name || 'Untitled Rule')}</div>
        <div class="nav-rule-url">${esc(state.ghostRule.urlPattern || '—')}</div>
      </div>
    </div>` : '';

  if (!list.length && !ghostHTML) {
    nav.innerHTML = `<div style="padding:18px 12px;color:var(--muted);font-size:11.5px;text-align:center">${state.allRules.length ? 'No matches.' : 'No rules yet.'}</div>${ghostHTML}`;
    return;
  }
  nav.innerHTML = list.map(r => `
    <div class="nav-rule ${navRuleClass(r.resourceType, r.resourceSubtype)} ${r.id === state.currentId && !state.selectMode ? 'active' : ''} ${r.enabled !== false ? '' : 'disabled'} ${state.selectMode && state.selectedIds.has(r.id) ? 'nav-selected' : ''}" data-id="${esc(r.id)}" ${state.dragSortMode ? 'draggable="true"' : ''}>
      ${state.dragSortMode
        ? `<span class="drag-handle" title="Drag to reorder">⠿</span>`
        : state.selectMode
          ? `<input type="checkbox" class="nav-checkbox" data-id="${esc(r.id)}" ${state.selectedIds.has(r.id) ? 'checked' : ''}
               style="width:14px;height:14px;accent-color:var(--accent);flex-shrink:0;cursor:pointer;">`
          : `<span class="nav-rule-type ${typeClass(r.resourceType, r.resourceSubtype)}">${typeLabel(r.resourceType, r.resourceSubtype)}</span>`
      }
      <div class="nav-rule-info">
        <div class="nav-rule-name">${esc(r.name || 'Untitled')}</div>
        <div class="nav-rule-url">${(() => {
          const p = r.pairs || [];
          if (!p.length || !p[0].urlPattern) return '—';
          return esc(p[0].urlPattern) + (p.length > 1 ? ` <span style="color:var(--accent);font-size:9px">+${p.length-1}</span>` : '');
        })()}</div>
      </div>
      ${!state.selectMode && !state.dragSortMode ? `<label class="toggle-sm" data-stop-prop="1">
        <input type="checkbox" ${r.enabled !== false ? 'checked' : ''} data-toggle="${esc(r.id)}">
        <div class="toggle-sm-track"><div class="toggle-sm-thumb"></div></div>
      </label>` : ''}
    </div>`).join('') + ghostHTML;

  nav.querySelectorAll('.nav-rule').forEach(el =>
    el.addEventListener('click', e => {
      if (state.dragSortMode) return;
      if (state.selectMode) {
        const cb = el.querySelector('.nav-checkbox');
        if (cb && e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
        return;
      }
      if (_onSelect) _onSelect(el.dataset.id);
    })
  );

  if (state.dragSortMode) bindDragSort(nav);

  nav.querySelectorAll('.nav-checkbox').forEach(cb => {
    cb.addEventListener('change', e => {
      e.stopPropagation();
      if (cb.checked) state.selectedIds.add(cb.dataset.id);
      else            state.selectedIds.delete(cb.dataset.id);
      updateSelectButtons();
      const row = cb.closest('.nav-rule');
      if (row) row.classList.toggle('nav-selected', cb.checked);
    });
  });
  nav.querySelectorAll('[data-stop-prop]').forEach(label =>
    label.addEventListener('click', e => e.stopPropagation())
  );
  nav.querySelectorAll('[data-toggle]').forEach(el =>
    el.addEventListener('change', async e => {
      e.stopPropagation();
      const ruleId = el.dataset.toggle;
      const res = await msg({ type: 'TOGGLE_RULE', id: ruleId });
      const enabled = res?.enabled ?? false;
      if (ruleId === state.currentId) {
        const toggle = document.getElementById('f-enabled');
        if (toggle) toggle.checked = enabled;
        const hdr = document.getElementById('editor-header');
        if (hdr) { hdr.classList.toggle('is-active', enabled); hdr.classList.toggle('is-inactive', !enabled); }
      }
    })
  );
}

function bindDragSort(nav) {
  nav.querySelectorAll('.nav-rule:not(.ghost)').forEach(el => {
    el.addEventListener('dragstart', e => {
      state._dragSrcId = el.dataset.id;
      setTimeout(() => el.classList.add('dragging'), 0);
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      nav.querySelectorAll('.nav-rule').forEach(r =>
        r.classList.remove('drag-insert-before', 'drag-insert-after')
      );
      state._dragSrcId = null;
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      nav.querySelectorAll('.nav-rule').forEach(r =>
        r.classList.remove('drag-insert-before', 'drag-insert-after')
      );
      const rect = el.getBoundingClientRect();
      el.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-insert-before' : 'drag-insert-after');
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      if (!state._dragSrcId || state._dragSrcId === el.dataset.id) return;
      const ordered = sortedRules().map(r => r.id);
      const srcIdx  = ordered.indexOf(state._dragSrcId);
      if (srcIdx === -1) return;
      const rect = el.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;
      ordered.splice(srcIdx, 1);
      const newDst = ordered.indexOf(el.dataset.id);
      if (newDst === -1) return;
      ordered.splice(insertBefore ? newDst : newDst + 1, 0, state._dragSrcId);
      state.customOrder = ordered;
      chrome.storage.local.set({ sfvi_custom_order: state.customOrder });
      renderNav(document.getElementById('search').value);
    });
  });
}

export function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const handle  = document.getElementById('sidebar-resize-handle');

  if (sidebar && handle) {
    const KEY   = 'sfvi_sidebar_w';
    const MIN_W = 180;
    const MAX_W = () => Math.floor(window.innerWidth * 0.25);

    const saved = parseInt(localStorage.getItem(KEY), 10);
    if (saved >= MIN_W) sidebar.style.width = Math.min(saved, MAX_W()) + 'px';

    let dragging = false, startX = 0, startW = 0;

    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      dragging = true;
      startX   = e.clientX;
      startW   = sidebar.getBoundingClientRect().width;
      handle.classList.add('is-dragging');
      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const w = Math.min(Math.max(startW + (e.clientX - startX), MIN_W), MAX_W());
      sidebar.style.width = w + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('is-dragging');
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      const w = parseInt(sidebar.style.width, 10);
      if (w >= MIN_W) localStorage.setItem(KEY, w);
    });
  }

  const colBtn = document.getElementById('sidebar-collapse-btn');
  if (colBtn && sidebar) {
    colBtn.addEventListener('click', () => {
      const isNowCollapsed = sidebar.classList.toggle('collapsed');
      colBtn.textContent = isNowCollapsed ? '▼ Show Rules' : '▲ Hide Rules';
    });
  }
}
