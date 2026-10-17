import { icon } from '../shared/icons.js';
import { isRemoteRule } from '../shared/rule-schema.js';
import { displayPatterns, displayVersion } from '../shared/rule-display.js';

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const TYPES = { rest: ['REST', 'type-rest'], graphql: ['GQL', 'type-graphql'], js: ['JS', 'type-js'], css: ['CSS', 'type-css'], html: ['HTML', 'type-html'] };

function ruleToggle(rule) {
  return `<label class="toggle"><input type="checkbox" name="enabled" aria-label="Enable ${esc(rule.name)}" ${rule.enabled !== false ? 'checked' : ''} data-toggle="${esc(rule.id)}">
    <span class="toggle-track"><span class="toggle-thumb"></span></span></label>`;
}

function remoteInfoHTML(rule) {
  if (!isRemoteRule(rule)) return '';
  const source = esc(rule.sourceName || 'Remote source');
  return `<div class="rule-meta" title="${source}">${icon('lock')} ${source} · read-only content</div>`;
}

function ruleInfoHTML(rule) {
  const patterns = displayPatterns(rule);
  const extra = patterns.length > 1 ? ` +${patterns.length - 1}` : '';
  const version = esc(displayVersion(rule));
  const name = esc(rule.name || 'Untitled');
  return `    <div class="rule-info"><div class="rule-heading"><div class="rule-name" title="${name}">${name}</div><span class="rule-version" title="Version ${version}">${version}</span></div>
      <div class="rule-url" title="${esc(patterns[0].urlPattern || '')}">${esc(patterns[0].urlPattern || 'No URL pattern')}${extra}</div>
      ${remoteInfoHTML(rule)}
    </div>`;
}

function typeBadge(rule, applied) {
  const key = rule.resourceType === 'html' ? (rule.resourceSubtype || 'html') : rule.resourceType;
  const [label, className] = TYPES[key] ?? TYPES.rest;
  const status = applied ? '<span class="rule-applied" role="img" aria-label="Applied on this page" title="Applied on this page">&#10003;</span>' : '';
  return `<span class="rule-type-badge ${className}">${label}${status}</span>`;
}

function ruleHTML(rule, applied) {
  return `<div class="rule-item ${rule.enabled === false ? 'disabled' : ''} ${applied ? 'applied' : ''}" data-rule-id="${esc(rule.id)}">
    ${typeBadge(rule, applied)}${ruleInfoHTML(rule)}<div class="rule-actions">${ruleToggle(rule)}</div></div>`;
}

function matches(rule, query, tab) {
  if (tab === 'active' && rule.enabled === false) return false;
  const text = [rule.name, displayVersion(rule), rule.sourceName, ...displayPatterns(rule).map(pair => pair.urlPattern)].join(' ').toLowerCase();
  return text.includes(query.toLowerCase());
}

function emptyHTML(rules, query) {
  if (query) return `<div class="empty"><div class="empty-title">No matching rules</div><p>Try a name, version, or URL pattern.</p></div>`;
  const title = rules.length ? 'No active rules' : 'No rules yet';
  return `<div class="empty"><div class="empty-icon">${icon('rules')}</div><div class="empty-title">${title}</div><p>Create a local rule or subscribe to shared rules in the dashboard.</p></div>`;
}

async function runAction(action) {
  const errorElement = document.getElementById('popup-error');
  errorElement.hidden = true;
  try {
    await action();
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.hidden = false;
  }
}

function finishToggle(input, hadFocus) {
  input.disabled = false;
  if (!hadFocus || document.activeElement !== document.body) return;
  const next = [...document.querySelectorAll('[data-toggle]')].find(element => element.dataset.toggle === input.dataset.toggle)
    || document.querySelector('[data-toggle]') || document.getElementById('popup-search');
  next?.focus({ preventScroll: true });
}

function bindToggle(input, onToggle) {
  input.addEventListener('change', () => runAction(async () => {
    const hadFocus = document.activeElement === input;
    input.disabled = true;
    try { await onToggle(input.dataset.toggle); }
    finally { finishToggle(input, hadFocus); }
  }));
}

function restoreRuleFocus(list, ruleId) {
  if (!ruleId) return;
  const next = [...list.querySelectorAll('[data-toggle]')].find(element => element.dataset.toggle === ruleId)
    || list.querySelector('[data-toggle]') || document.getElementById('popup-search');
  next.focus({ preventScroll: true });
}

export function renderPopupRuleList({ rules, tab, query, onToggle, appliedRuleIds = new Set() }) {
  const list = document.getElementById('rules-list');
  const filtered = rules.filter(rule => matches(rule, query, tab));
  const focused = document.activeElement?.dataset.toggle;
  list.innerHTML = filtered.length ? filtered.map(rule => ruleHTML(rule, appliedRuleIds.has(rule.id))).join('') : emptyHTML(rules, query);
  restoreRuleFocus(list, focused);
  list.querySelectorAll('[data-toggle]').forEach(input => bindToggle(input, onToggle));
}
