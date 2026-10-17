import { esc } from '../core/utils.js';
import { buildRuleEditor } from './editor-template.js';
import { bindRuleEditor } from './editor-events.js';

let _cbs = {};

export function initRuleEditor({ renderNav, refresh, selectRule, showEmpty, updateGhost, showSources }) {
  _cbs = { renderNav, refresh, selectRule, showEmpty, updateGhost, showSources };
}

function options(values, current) {
  return values.map(value => `<option value="${value}" ${current === value ? 'selected' : ''}>${value || 'Any'}</option>`).join('');
}

export function buildPairRow(pair, idx) {
  const op  = pair.urlOperator || 'Contains';
  const cs  = pair.caseSensitive || false;
  const hasRedirect = !!(pair.redirectUrl);
  return `
    <div class="pair-row" data-pair-idx="${idx}">
      <div class="pair-input-box">
        <select class="pair-operator" name="operator-${idx}" aria-label="URL match operator ${idx + 1}" data-idx="${idx}">
          ${options(['Contains', 'Wildcard', 'Equals', 'Regex'], op)}
        </select>
        <div class="pair-divider"></div>
        <input type="text" class="pair-url" name="pattern-${idx}" aria-label="URL pattern ${idx + 1}" data-idx="${idx}"
               value="${esc(pair.urlPattern || '')}"
               placeholder="e.g. *api/endpoint*  or  *.bundle.js*"
               autocomplete="off" spellcheck="false">
        <select class="pair-method" name="method-${idx}" aria-label="HTTP method ${idx + 1}" data-idx="${idx}">
          ${options(['', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'], pair.method || '')}
        </select>
        <button type="button" class="pair-cs" data-idx="${idx}" data-cs="${cs}" aria-label="Aa: Case-sensitive matching for pattern ${idx + 1}" title="${cs ? 'Case sensitive (click to disable)' : 'Case insensitive (click to enable)'}">Aa</button>
        <button type="button" class="pair-redirect-btn ${hasRedirect ? 'active' : ''}" data-idx="${idx}" title="Redirect URL" aria-label="Redirect for pattern ${idx + 1}" aria-expanded="${hasRedirect}"><span aria-hidden="true">↪</span></button>
        ${idx > 0
          ? `<button type="button" class="pair-remove" data-idx="${idx}" title="Remove" aria-label="Remove URL pattern ${idx + 1}">✕</button>`
          : ''
        }
      </div>
      <div class="pair-redirect-wrap" ${hasRedirect ? '' : 'style="display:none"'}>
        <span class="redirect-label">↪ redirect to</span>
        <input type="text" class="pair-redirect-url" name="redirect-${idx}" aria-label="Redirect URL ${idx + 1}" data-idx="${idx}"
               value="${esc(pair.redirectUrl || '')}"
               placeholder="https://other-api.com/same/path"
               autocomplete="off" spellcheck="false">
      </div>
    </div>
  `;
}

export function buildEditorHTML(rule) {
  return buildRuleEditor(rule, buildPairRow);
}

export function bindEditorEvents(rule, isNew = false) {
  bindRuleEditor(rule, isNew, _cbs, buildPairRow);
}
