import { state, sortedRules } from '../core/state.js';
import { isRemoteRule } from '../../shared/rule-schema.js';
import { renderRuleList } from './rule-list.js';
import { bindDialog } from '../../shared/dialogs.js';
import { icon } from '../../shared/icons.js';

let _onSelect = null;

export function initNav({ onSelect }) {
  _onSelect = onSelect;
}

export function updateSelectButtons() {
  const count     = state.selectedIds.size;
  const exportBtn = document.getElementById('export-selected');
  const deleteBtn = document.getElementById('delete-selected');
  const allBtn    = document.getElementById('select-all-rules');
  if (exportBtn) exportBtn.textContent = count ? `↑ Export (${count})` : '↑ Export';
  const localCount = state.allRules.filter(rule => state.selectedIds.has(rule.id) && !isRemoteRule(rule)).length;
  if (deleteBtn) {
    deleteBtn.textContent = localCount ? `Delete local (${localCount})` : 'Delete local';
    deleteBtn.disabled = !localCount;
  }
  if (allBtn) {
    const visible = [...document.querySelectorAll('#rules-nav .nav-rule[data-id]')].map(row => row.dataset.id);
    const allSelected = visible.length > 0 && visible.every(id => state.selectedIds.has(id));
    allBtn.textContent = allSelected ? 'None' : 'All visible';
  }
}

export function renderNav(filter = '') {
  renderRuleList({ filter, onSelect: _onSelect, onDragSort: bindDragSort, updateSelectButtons });
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
    const MIN_W = 220;
    const MAX_W = () => Math.max(MIN_W, Math.floor(window.innerWidth * 0.4));

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
    window.addEventListener('resize', () => {
      if (matchMedia('(max-width: 760px)').matches) return;
      const width = sidebar.getBoundingClientRect().width;
      sidebar.style.width = Math.min(Math.max(width, MIN_W), MAX_W()) + 'px';
    });
  }

  const colBtn = document.getElementById('sidebar-collapse-btn');
  const body = document.getElementById('sidebar-body');
  const drawer = document.getElementById('rules-drawer');
  const drawerContent = document.getElementById('rules-drawer-content');
  const narrow = matchMedia('(max-width: 760px)');
  sidebar.querySelector('.sidebar-header').appendChild(colBtn);
  colBtn.innerHTML = `${icon('rules')} Browse rules`;
  document.getElementById('rules-drawer-close').innerHTML = icon('close');
  bindDialog(drawer);
  const placeNavigation = () => {
    closeRuleBrowser();
    (narrow.matches ? drawerContent : sidebar).appendChild(body);
  };
  placeNavigation();
  narrow.addEventListener('change', placeNavigation);
  colBtn.addEventListener('click', () => { drawer.showModal(); colBtn.setAttribute('aria-expanded', 'true'); });
  document.getElementById('rules-drawer-close').addEventListener('click', closeRuleBrowser);
  drawer.addEventListener('close', () => colBtn.setAttribute('aria-expanded', 'false'));
  drawer.addEventListener('click', event => {
    if (event.target.closest('#btn-sources, #import-all')) closeRuleBrowser();
  }, true);
}

export function closeRuleBrowser() {
  const drawer = document.getElementById('rules-drawer');
  if (drawer?.open) drawer.close();
}
