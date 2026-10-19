import { state, sortedRules } from '../core/state.js';
import { esc, msg, showToast } from '../core/utils.js';
import { isRemoteRule } from '../../shared/rule-schema.js';
import { displayPatterns, displayVersion } from '../../shared/rule-display.js';

const TYPES = { rest: ['REST', 't-rest'], graphql: ['GQL', 't-graphql'], js: ['JS', 't-js'], css: ['CSS', 't-css'], html: ['HTML', 't-html'] };

function typeBadge(rule) {
  const key = rule.resourceType === 'html' ? (rule.resourceSubtype || 'html') : rule.resourceType;
  const [label, className] = TYPES[key] ?? TYPES.rest;
  return `<span class="nav-rule-type ${className}">${label}</span>`;
}

function matches(rule, query) {
  if (state.origin === 'local' && isRemoteRule(rule)) return false;
  if (state.origin === 'remote' && !isRemoteRule(rule)) return false;
  const text = [rule.name, displayVersion(rule), rule.sourceName, ...displayPatterns(rule).map(pair => pair.urlPattern)].join(' ').toLowerCase();
  return text.includes(query);
}

function ruleControl(rule) {
  if (state.selectMode || state.dragSortMode) return '';
  return `<label class="toggle-sm">
    <input type="checkbox" name="enabled" aria-label="Enable ${esc(rule.name)}" data-toggle="${esc(rule.id)}" ${rule.enabled !== false ? 'checked' : ''}>
    <span class="toggle-sm-track"><span class="toggle-sm-thumb" style="display:block"></span></span>
  </label>`;
}

function selectionControl(rule) {
  if (state.dragSortMode) return '<span class="drag-handle" title="Drag to reorder">⠿</span>';
  if (!state.selectMode) return '';
  return `<input type="checkbox" class="nav-checkbox" name="selected-rule" data-id="${esc(rule.id)}" aria-label="Select ${esc(rule.name)}" ${state.selectedIds.has(rule.id) ? 'checked' : ''}>`;
}

function rowClasses(rule) {
  const classes = [];
  if (rule.id === state.currentId && !state.selectMode) classes.push('active');
  if (state.selectMode && state.selectedIds.has(rule.id)) classes.push('nav-selected');
  if (rule.enabled === false) classes.push('disabled');
  return classes.join(' ');
}

function remoteMetadata(rule) {
  if (!isRemoteRule(rule)) return '';
  const source = esc(rule.sourceName || 'Remote source');
  return `<span class="nav-rule-meta" title="${source} · read-only content">${source} · read-only content</span>`;
}

function ruleInformation(rule, patterns) {
  const version = esc(displayVersion(rule));
  const extra = patterns.length > 1 ? ` +${patterns.length - 1}` : '';
  const name = esc(rule.name || 'Untitled');
  return `<span class="nav-rule-info">
    <span class="nav-rule-heading"><span class="nav-rule-name" title="${name}">${name}</span></span>
    <span class="nav-rule-details"><span class="nav-rule-url" title="${esc(patterns[0].urlPattern)}">${esc(patterns[0].urlPattern || 'No URL pattern')}${extra}</span><span class="nav-rule-version" title="Version ${version}">${version}</span></span>
    ${remoteMetadata(rule)}
  </span>`;
}

function ruleHTML(rule) {
  const active = rule.id === state.currentId && !state.selectMode;
  const patterns = displayPatterns(rule);
  return `<div class="nav-rule ${rowClasses(rule)}" data-id="${esc(rule.id)}" ${state.dragSortMode ? 'draggable="true"' : ''}>
    ${selectionControl(rule)}
    <button type="button" class="nav-rule-open" aria-current="${active ? 'true' : 'false'}">
      ${typeBadge(rule)}
      ${ruleInformation(rule, patterns)}
    </button>
    ${ruleControl(rule)}
  </div>`;
}

function groupHTML(title, rules, suffix = '') {
  if (!rules.length) return '';
  return `<div class="nav-group-title">${title} <span>${rules.length}${suffix}</span></div>${rules.map(ruleHTML).join('')}`;
}

function ghostHTML() {
  if (!state.ghostRule) return '';
  const rule = state.ghostRule;
  return `<div class="nav-rule ghost active">${typeBadge(rule)}<div class="nav-rule-info">
    <div class="nav-rule-name">${esc(rule.name || 'Untitled rule')}</div>
    <div class="nav-rule-url">${esc(rule.urlPattern || 'Add a URL pattern')}</div>
    <div class="nav-rule-meta">Local draft</div>
  </div></div>`;
}

function bindSelection(nav, updateSelectButtons) {
  nav.querySelectorAll('.nav-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedIds.add(checkbox.dataset.id);
      else state.selectedIds.delete(checkbox.dataset.id);
      checkbox.closest('.nav-rule').classList.toggle('nav-selected', checkbox.checked);
      updateSelectButtons();
    });
  });
}

async function reconcileToggle(id) {
  const result = await msg({ type: 'GET_RULES' });
  state.allRules = result.rules;
  const rule = state.allRules.find(item => item.id === id);
  const checkbox = [...document.querySelectorAll('[data-toggle]')].find(input => input.dataset.toggle === id);
  if (!checkbox || !rule) return;
  checkbox.checked = rule.enabled !== false;
  checkbox.closest('.nav-rule').classList.toggle('disabled', !checkbox.checked);
}

function finishToggle(checkbox, hadFocus) {
  checkbox.disabled = false;
  if (!hadFocus || document.activeElement !== document.body) return;
  const next = [...document.querySelectorAll('[data-toggle]')].find(input => input.dataset.toggle === checkbox.dataset.toggle);
  next?.focus({ preventScroll: true });
}

function restoreFocusedToggle(nav, id) {
  if (!id) return;
  const next = [...nav.querySelectorAll('[data-toggle]')].find(input => input.dataset.toggle === id);
  next?.focus({ preventScroll: true });
}

function bindToggles(nav) {
  nav.querySelectorAll('[data-toggle]').forEach(checkbox => {
    checkbox.addEventListener('change', async () => {
      const hadFocus = document.activeElement === checkbox;
      checkbox.disabled = true;
      try {
        const result = await msg({ type: 'TOGGLE_RULE', id: checkbox.dataset.toggle });
        const rule = state.allRules.find(item => item.id === checkbox.dataset.toggle);
        if (rule) rule.enabled = result.enabled;
      } catch (error) {
        await reconcileToggle(checkbox.dataset.toggle).catch(() => {});
        showToast(error.message, true);
      } finally {
        finishToggle(checkbox, hadFocus);
      }
    });
  });
}

export function renderRuleList({ filter, onSelect, onDragSort, updateSelectButtons }) {
  const nav = document.getElementById('rules-nav');
  const focusedToggleId = document.activeElement?.closest('[data-toggle]')?.dataset.toggle;
  const list = sortedRules().filter(rule => matches(rule, filter.toLowerCase()));
  const visibleIds = new Set(list.map(rule => rule.id));
  state.selectedIds = new Set([...state.selectedIds].filter(id => visibleIds.has(id)));
  const local = list.filter(rule => !isRemoteRule(rule));
  const remote = list.filter(isRemoteRule);
  nav.innerHTML = groupHTML('Local rules', local) + ghostHTML() + groupHTML('Remote rules', remote, ' · read-only');
  if (!nav.innerHTML) nav.innerHTML = `<div class="nav-empty">${state.allRules.length ? 'No matching rules' : 'No rules yet'}</div>`;
  document.querySelectorAll('[data-origin]').forEach(button => {
    const active = button.dataset.origin === state.origin;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  nav.querySelectorAll('.nav-rule-open').forEach(button => {
    button.addEventListener('click', event => {
      if (state.dragSortMode) return;
      const row = button.closest('.nav-rule');
      if (state.selectMode) {
        const checkbox = row.querySelector('.nav-checkbox');
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
        return;
      }
      onSelect?.(row.dataset.id, true, event.detail === 0);
    });
  });
  bindSelection(nav, updateSelectButtons);
  bindToggles(nav);
  restoreFocusedToggle(nav, focusedToggleId);
  updateSelectButtons();
  if (state.dragSortMode) onDragSort(nav);
}
