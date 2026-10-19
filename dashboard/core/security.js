import { bindDialog } from '../../shared/dialogs.js';
import { esc } from './utils.js';
import { RISK_FLAGS, riskSeverity } from './risk-catalog.js';
import { inspectCode, executableRuleFields } from './risk-analysis.js';
import { setEditorRisks, focusRiskRange, supportsRiskHighlights } from '../editor/risk-highlights.js';

export { inspectRuleCode } from './risk-analysis.js';

const LEVELS = {
  0: { key: 'none', label: 'No flags recognized' },
  1: { key: 'medium', label: 'Medium' },
  2: { key: 'high', label: 'High' },
  3: { key: 'critical', label: 'Critical' },
};
const FIELD_BARS = {
  'f-req-modifier': 'sfvi-request-risk-bar',
  'f-body-dynamic': 'sfvi-risk-bar',
  'f-body-static': 'sfvi-static-risk-bar',
};
let activeContext;
let pendingAnalysis;

function countLabel(count, noun) {
  return count + ' ' + noun + (count === 1 ? '' : 's');
}

function referenceGroup(severity, detected) {
  const level = LEVELS[severity];
  const flags = RISK_FLAGS.filter(flag => flag.sev === severity);
  return `<section class="risk-reference-group risk-level-${level.key}">
    <h3>${level.label}<span>${countLabel(flags.length, 'flag')}</span></h3>
    <ul>${flags.map(flag => `<li class="risk-reference-item ${detected.has(flag.id) ? 'is-detected' : ''}">
      <div class="risk-reference-title"><strong>${esc(flag.label)}</strong>${detected.has(flag.id) ? '<span>Detected</span>' : ''}</div>
      <p><b>Trigger:</b> ${esc(flag.trigger)}</p><p>${esc(flag.why)}</p><code>${esc(flag.example)}</code>
    </li>`).join('')}</ul>
  </section>`;
}

export function showAllRisksPopup(highlightIds = []) {
  document.getElementById('sfvi-allrisks-popup')?.remove();
  const detected = new Set(highlightIds);
  const popup = document.createElement('dialog');
  popup.id = 'sfvi-allrisks-popup';
  popup.setAttribute('aria-labelledby', 'risk-reference-title');
  popup.innerHTML = `<header class="risk-reference-header"><h2 id="risk-reference-title">Risk flag reference</h2>
      <button type="button" id="sfvi-allrisks-close" class="btn-close">Close</button></header>
    <p class="risk-reference-intro">Flags identify operations worth reviewing, not malicious intent. No recognized flags does not prove that code is safe.</p>
    <div class="risk-reference-scroll" tabindex="0" role="region" aria-label="Risk flag descriptions">
      ${[3, 2, 1].map(severity => referenceGroup(severity, detected)).join('')}
    </div>`;
  popup.querySelector('#sfvi-allrisks-close').addEventListener('click', () => popup.close());
  popup.addEventListener('close', () => popup.remove(), { once: true });
  bindDialog(popup);
  document.body.appendChild(popup);
  popup.showModal();
}

function currentFields(context) {
  return executableRuleFields({
    resourceType: context.resourceType, resourceSubtype: context.resourceSubtype,
    request: { type: context.requestType, body: document.getElementById('f-req-modifier')?.value },
    response: { type: context.responseType, body: document.getElementById(context.responseType === 'dynamic' ? 'f-body-dynamic' : 'f-body-static')?.value },
  });
}

function flagButton(risk, field) {
  const first = risk.ranges[0];
  const descriptionId = field.id + '-flag-' + risk.id;
  return `<button type="button" class="risk-flag risk-level-${LEVELS[risk.sev].key}" data-risk-id="${risk.id}"
      aria-label="${LEVELS[risk.sev].label} ${esc(risk.label)} ${countLabel(risk.ranges.length, 'occurrence')}. Go to line ${first.line}, column ${first.column}."
      aria-describedby="${descriptionId}" title="${esc(risk.trigger + '\n' + risk.why)}">
    <span class="risk-flag-level">${LEVELS[risk.sev].label}</span> ${esc(risk.label)} <span class="risk-occurrences">${risk.ranges.length}</span>
  </button><span class="sr-only" id="${descriptionId}">${esc(risk.why)} Activate again to move to the next occurrence.</span>`;
}

function riskSummary(risks, error) {
  if (error) return 'Analysis unavailable';
  if (!risks.length) return LEVELS[0].label;
  const occurrences = risks.reduce((total, risk) => total + risk.ranges.length, 0);
  return LEVELS[riskSeverity(risks)].label + ' · ' + countLabel(risks.length, 'flag') + ' · ' + countLabel(occurrences, 'occurrence');
}

function riskHint(risks, error) {
  if (error) return error;
  if (!risks.length) return 'Static analysis cannot establish that code is safe.';
  return supportsRiskHighlights() ? 'Select a flag to locate its code. Select it again for the next occurrence.' : 'Select a flag to select its source. Inline highlighting is unavailable in this browser.';
}

function bindFlagNavigation(bar, field, risk) {
  const button = bar.querySelector('[data-risk-id="' + risk.id + '"]');
  let index = 0;
  button.addEventListener('click', () => {
    const code = document.getElementById(field.id)?.value || '';
    const current = inspectCode(code).risks.find(item => item.id === risk.id);
    if (!current) { updateRiskBar(); return; }
    index %= current.ranges.length;
    const finding = current.ranges[index];
    if (!focusRiskRange(field.id, code, finding)) return;
    bar.querySelector('.risk-location').textContent = risk.label + ' · ' + (index + 1) + ' of ' + current.ranges.length + ' · line ' + finding.line + ', column ' + finding.column;
    index = (index + 1) % current.ranges.length;
  });
}

function renderRiskField(field) {
  const bar = document.getElementById(FIELD_BARS[field.id]);
  if (!bar) return;
  const { risks, error } = inspectCode(field.code);
  setEditorRisks(field.id, field.code, risks);
  const level = LEVELS[riskSeverity(risks)];
  bar.hidden = !field.code.trim();
  bar.innerHTML = `<div class="risk-panel risk-level-${level.key}">
    <div class="risk-summary"><strong>${riskSummary(risks, error)}</strong><button type="button" class="risk-reference-button">Flag reference</button></div>
    ${risks.length ? '<div class="risk-flags">' + risks.map(risk => flagButton(risk, field)).join('') + '</div>' : ''}
    <p class="risk-hint">${esc(riskHint(risks, error))}</p><p class="risk-location" role="status" aria-live="polite"></p>
  </div>`;
  bar.querySelector('.risk-reference-button').addEventListener('click', () => showAllRisksPopup(risks.map(risk => risk.id)));
  for (const risk of risks) bindFlagNavigation(bar, field, risk);
}

export function updateRiskBar(context = activeContext) {
  clearTimeout(pendingAnalysis);
  if (!context?.body?.isConnected) return;
  activeContext = context;
  const fields = currentFields(context);
  const activeIds = new Set(fields.map(field => field.id));
  for (const [id, barId] of Object.entries(FIELD_BARS)) {
    if (activeIds.has(id)) continue;
    const bar = document.getElementById(barId);
    if (bar) bar.hidden = true;
    setEditorRisks(id, document.getElementById(id)?.value || '', []);
  }
  for (const field of fields) renderRiskField(field);
}

export function scheduleRiskAnalysis(context) {
  clearTimeout(pendingAnalysis);
  activeContext = context;
  for (const field of currentFields(context)) setEditorRisks(field.id, field.code, []);
  pendingAnalysis = setTimeout(() => {
    if (activeContext === context) updateRiskBar(context);
  }, 160);
}

export function showSecurityWarning(risks) {
  return new Promise(resolve => {
    document.getElementById('sfvi-sec-modal')?.close();
    const modal = document.createElement('dialog');
    modal.id = 'sfvi-sec-modal';
    modal.className = 'security-warning';
    modal.setAttribute('aria-labelledby', 'security-warning-title');
    modal.setAttribute('aria-describedby', 'security-warning-description');
    modal.innerHTML = `<h2 id="security-warning-title" tabindex="-1">Review code before saving</h2>
      <p id="security-warning-description">Review these operations and trust the code's source before saving.</p>
      <ul class="security-findings" tabindex="0" aria-label="Operations to review">${risks.map(risk => `<li><strong>${esc(risk.label)}</strong>${risk.fields ? '<span class="security-fields">' + esc(risk.fields.join(' · ')) + '</span>' : ''}<p>${esc(risk.why)}</p></li>`).join('')}</ul>
      <label class="security-accept"><input type="checkbox" id="sfvi-sec-accept"><span>I reviewed these operations and trust this rule</span></label>
      <div class="dialog-actions"><button type="button" class="btn-close" id="sfvi-sec-cancel">Cancel</button><button type="button" class="btn-save" id="sfvi-sec-save" disabled>Save anyway</button></div>`;
    bindDialog(modal);
    modal.querySelector('#sfvi-sec-accept').addEventListener('change', event => { modal.querySelector('#sfvi-sec-save').disabled = !event.target.checked; });
    modal.querySelector('#sfvi-sec-cancel').addEventListener('click', () => modal.close('cancel'));
    modal.querySelector('#sfvi-sec-save').addEventListener('click', () => modal.close('save'));
    modal.addEventListener('close', () => { const accepted = modal.returnValue === 'save'; modal.remove(); resolve(accepted); }, { once: true });
    document.body.appendChild(modal);
    modal.showModal();
    modal.querySelector('#security-warning-title').focus({ preventScroll: true });
  });
}
