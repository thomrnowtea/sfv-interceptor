import { esc } from '../core/utils.js';
import { isRemoteRule } from '../../shared/rule-schema.js';
import { icon } from '../../shared/icons.js';

function section(title, content) {
  return `<section class="section"><h2 class="section-header">${title}</h2><div class="section-body">${content}</div></section>`;
}

function inputField(id, label, value = '', type = 'text', attributes = '') {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" value="${esc(value)}" ${attributes}></div>`;
}

function headersField(id, label, value = '') {
  return `<div class="field"><label for="${id}">${label} <span class="label-hint">(optional JSON)</span></label>
    <textarea id="${id}" name="${id}" rows="2" placeholder='{"X-Example": "value"}' spellcheck="false">${esc(value)}</textarea></div>`;
}

function bodyFor(body, type) {
  return body?.type === type ? (body.body || '') : '';
}

function codeEditor(id, value, kind, controls) {
  return `<div class="editor-toolbar"><span class="editor-lang-badge">${kind}</span><div class="editor-actions">
    <button type="button" class="btn-tpl" id="tpl-${controls}">Template</button>
    <button type="button" class="btn-format" id="fmt-${controls}">Format</button>
  </div></div><textarea id="${id}" name="${id}" aria-label="${id.startsWith('f-req') ? 'Request' : 'Response'} ${kind} body" spellcheck="false" style="display:none">${esc(value)}</textarea>`;
}

function tabs(kind, type, label) {
  const request = kind === 'req';
  const wrap = request ? 'req-type-tabs' : 'response-type-tabs';
  const tab = request ? 'req-tab' : 'resp-tab';
  const data = request ? 'req-body' : 'resp';
  return `<div class="field"><span class="field-label">${label}</span><div class="${wrap}" role="group" aria-label="${label} type">
    <button type="button" class="${tab} ${type === 'static' ? 'active' : ''}" data-${data}="static" aria-pressed="${type === 'static'}">Static</button>
    <button type="button" class="${tab} ${type === 'dynamic' ? 'active' : ''}" data-${data}="dynamic" aria-pressed="${type === 'dynamic'}">Dynamic JavaScript</button>
  </div></div>`;
}

function header(rule) {
  const isNew = !rule.id;
  const remote = isRemoteRule(rule);
  const subtitle = ruleSubtitle(rule);
  return `<header class="main-header ${rule.enabled === false ? 'is-inactive' : 'is-active'}" id="editor-header">
    <h1 class="sr-only">${remote ? 'Remote rule' : 'Local rule'} editor</h1>
    <div class="main-title-wrap"><div class="main-title-row">
      <input type="text" class="main-title-input" id="f-name" name="name" aria-label="Rule name" placeholder="Untitled rule" value="${esc(rule.name || '')}" autocomplete="off" spellcheck="false" ${remote ? 'readonly' : ''}>
    </div><div class="main-subtitle">${subtitle}<span class="status-chip">${rule.enabled === false ? 'Disabled' : 'Enabled'}</span></div></div>
    <div class="main-actions"><button type="button" class="btn-close" id="btn-close">${isNew ? 'Cancel' : 'Close'}</button>
      <button type="button" class="btn-save" id="btn-save" ${isNew ? '' : 'style="display:none"'} ${remote ? 'disabled' : ''}>${isNew ? 'Create rule' : 'Save changes'}</button>
    </div></header>`;
}

function ruleSubtitle(rule) {
  if (isRemoteRule(rule)) return `<span class="readonly-badge">${icon('lock')} Remote · read-only</span>`;
  return rule.id ? 'Local rule · editable' : 'New local rule';
}

function general(rule) {
  return section('General', `<div class="field-row">
    <div class="field" style="flex:2"><label for="f-description">Description <span class="label-hint">(optional)</span></label>
      <input type="text" id="f-description" name="description" placeholder="What does this rule do?" value="${esc(rule.description || '')}"></div>
    <div class="field version-field"><label for="f-version">Version</label><input type="text" id="f-version" name="version" value="${esc(rule.version || '1.0.0')}" pattern="[0-9]+([.][0-9]+){0,2}" maxlength="32" placeholder="1.0.0" required></div>
  </div><input type="checkbox" id="f-enabled" name="enabled" aria-label="Rule enabled" ${rule.enabled !== false ? 'checked' : ''} hidden>`);
}

function deleteAction(rule) {
  if (!rule.id || isRemoteRule(rule)) return '';
  return '<div class="section rule-footer"><button type="button" class="btn-danger" id="btn-delete">Delete rule</button></div>';
}

function resourceTypes(rule) {
  const type = rule.resourceType || 'rest';
  const options = [['rest', 'REST API', 'rest'], ['graphql', 'GraphQL API', 'gql'], ['html', 'Resource', 'html']];
  return `<div class="field"><span class="field-label">Resource type</span><div class="type-selector" id="type-selector" role="group" aria-label="Resource type">
    ${options.map(([value, label, color]) => `<button type="button" class="type-btn ${type === value ? 'active' : ''}" data-type="${value}" aria-pressed="${type === value}"><span class="dot" style="background:var(--t-${color}-c)"></span>${label}</button>`).join('')}
    </div><div id="subtype-selector" role="group" style="display:${type === 'html' ? 'flex' : 'none'};gap:6px;margin-top:4px" aria-label="Resource subtype">
      ${['html', 'css', 'js'].map(sub => `<button type="button" class="subtype-btn ${(rule.resourceSubtype || 'html') === sub ? 'active' : ''}" data-sub="${sub}" aria-pressed="${(rule.resourceSubtype || 'html') === sub}">${sub.toUpperCase()}</button>`).join('')}
    </div></div>`;
}

function requestOverrides(rule) {
  const request = rule.request || {};
  const type = request.type || 'static';
  const open = Boolean(request.body || request.customHeaders);
  return `<details class="advanced-request" ${open ? 'open' : ''}><summary>Request overrides <span class="label-hint">· optional</span></summary><div class="advanced-request-content">
    ${tabs('req', type, 'Request body')}
    <div id="req-static-body-field" ${type === 'static' ? '' : 'style="display:none"'}>${codeEditor('f-req-body-static', bodyFor(request, 'static'), 'JSON / TEXT', 'req-static')}</div>
    <div id="req-dynamic-body-field" ${type === 'dynamic' ? '' : 'style="display:none"'}>
      <div class="code-hint">Use <code>args.requestJSON</code>, <code>args.requestData</code>, <code>args.url</code>, <code>args.method</code>, and <code>args.requestHeaders</code>. Return a string or object to replace the outgoing body.</div>
      ${codeEditor('f-req-modifier', bodyFor(request, 'dynamic'), 'JavaScript', 'req-modifier')}
    </div>
    ${headersField('f-req-headers', 'Request headers', request.customHeaders)}
  </div></details>`;
}

function matching(rule, buildPairRow) {
  const pairs = rule.pairs?.length ? rule.pairs : [{}];
  return section('If the request matches', `${resourceTypes(rule)}
    <div class="field"><span class="field-label">URL patterns <span class="label-hint">· match any pattern</span></span>
      <div id="pairs-list">${pairs.map(buildPairRow).join('')}</div>
      <div class="hint"><b>Wildcard</b>: * matches any string · <b>Contains</b>: part of a URL · <b>Regex</b>: JavaScript expression</div>
      <button type="button" id="btn-add-pair" class="btn-add-pattern">${icon('plus')} Add URL pattern</button>
    </div>
    <div id="graphql-fields" ${rule.resourceType === 'graphql' ? '' : 'style="display:none"'}>
      ${inputField('f-gql-op', 'GraphQL operation name <span class="label-hint">(optional)</span>', pairs[0].gqlOperation, 'text', 'placeholder="GetProducts"')}
    </div>
    ${requestOverrides(rule)}`);
}

function response(rule) {
  const body = rule.response || {};
  const type = body.type || 'static';
  return section('Then respond with', `<div class="field-row">
      ${inputField('f-status', 'Status code', body.statusCode, 'number', 'placeholder="200" min="100" max="599"')}
      ${inputField('f-delay', 'Delay in milliseconds', body.delay, 'number', 'placeholder="0" min="0"')}
    </div>
    ${tabs('resp', type, 'Response body')}
    <div id="static-body-field" ${type === 'static' ? '' : 'style="display:none"'}>${codeEditor('f-body-static', bodyFor(body, 'static'), 'JSON / TEXT', 'static')}</div>
    <div id="dynamic-body-field" ${type === 'dynamic' ? '' : 'style="display:none"'}>
      <div class="code-hint" id="code-hint-dyn">Transform <code>args.responseJSON</code> or <code>args.response</code>, using the request URL and method.</div>
      ${codeEditor('f-body-dynamic', bodyFor(body, 'dynamic'), 'JavaScript', 'dynamic')}
      <div id="sfvi-risk-bar" style="display:none"></div>
    </div>
    ${headersField('f-headers', 'Response headers', body.customHeaders)}`);
}

function remoteBanner(rule) {
  if (!isRemoteRule(rule)) return '';
  return `<div class="readonly-banner">${icon('lock')}<div>
    <p>Published by <strong>${esc(rule.sourceName)}</strong></p>
    <div class="hint">Content and version follow the source JSON. Activation is your local choice.</div>
  </div><button type="button" id="btn-source-details">Manage source</button></div>`;
}

function statusbar(rule) {
  return `<div class="statusbar"><span>ID: <span style="font-family:var(--mono)">${esc(rule.sourceRuleId || rule.id || 'unsaved')}</span></span>
    <span class="sep">·</span><span class="status-ok">${isRemoteRule(rule) ? 'Remote snapshot' : 'Stored on this device'}</span>
    <span style="margin-left:auto">by <a href="https://github.com/thomrnowtea" target="_blank" rel="noopener noreferrer" class="author-link">thomrnowtea</a></span></div>`;
}

export function buildRuleEditor(rule, buildPairRow) {
  return `${header(rule)}<div class="editor-body ${isRemoteRule(rule) ? 'readonly-editor' : ''}">
    ${remoteBanner(rule)}${general(rule)}${matching(rule, buildPairRow)}${response(rule)}${deleteAction(rule)}
  </div>${statusbar(rule)}`;
}
