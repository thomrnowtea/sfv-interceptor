import { state } from '../core/state.js';
import { esc, msg, showToast } from '../core/utils.js';
import { mountEditor, getEditorValue, setEditorValue, formatJS } from '../editor/editor.js';
import { analyzeCode, riskSeverity, showSecurityWarning, updateRiskBar } from '../core/security.js';
import { hrClass } from './nav.js';

let _cbs = {};

export function initRuleEditor({ renderNav, refresh, selectRule, showEmpty, updateGhost }) {
  _cbs = { renderNav, refresh, selectRule, showEmpty, updateGhost };
}

export function buildPairRow(pair, idx) {
  const op = pair.urlOperator || 'Contains';
  const cs = pair.caseSensitive || false;
  return `
    <div class="pair-row" data-pair-idx="${idx}">
      <div class="pair-input-box">
        <select class="pair-operator" data-idx="${idx}">
          <option value="Contains" ${op === 'Contains' ? 'selected' : ''}>Contains</option>
          <option value="Wildcard" ${op === 'Wildcard' ? 'selected' : ''}>Wildcard</option>
          <option value="Equals"   ${op === 'Equals'   ? 'selected' : ''}>Equals</option>
          <option value="Regex"    ${op === 'Regex'    ? 'selected' : ''}>Regex</option>
        </select>
        <div class="pair-divider"></div>
        <input type="text" class="pair-url" data-idx="${idx}"
               value="${esc(pair.urlPattern || '')}"
               placeholder="e.g. *api/endpoint*  or  *.bundle.js*"
               autocomplete="off" spellcheck="false">
        <select class="pair-method" data-idx="${idx}">
          <option value=""       ${!pair.method             ? 'selected' : ''}>Any</option>
          <option value="GET"    ${pair.method === 'GET'    ? 'selected' : ''}>GET</option>
          <option value="POST"   ${pair.method === 'POST'   ? 'selected' : ''}>POST</option>
          <option value="PUT"    ${pair.method === 'PUT'    ? 'selected' : ''}>PUT</option>
          <option value="PATCH"  ${pair.method === 'PATCH'  ? 'selected' : ''}>PATCH</option>
          <option value="DELETE" ${pair.method === 'DELETE' ? 'selected' : ''}>DELETE</option>
        </select>
        <button type="button" class="pair-cs" data-idx="${idx}" data-cs="${cs}" title="${cs ? 'Case sensitive (click to disable)' : 'Case insensitive (click to enable)'}">
          Aa
        </button>
        ${idx > 0
          ? `<button type="button" class="pair-remove" data-idx="${idx}" title="Remove">✕</button>`
          : ''
        }
      </div>
    </div>
  `;
}

export function buildEditorHTML(rule) {
  const resType  = rule.resourceType || 'rest';
  const resSub   = rule.resourceSubtype || 'html';
  const respType = rule.pairs?.[0]?.responseType || rule.responseType || 'static';
  const isNew    = !rule.id;

  const defStatic = resType === 'html'
    ? '// Return the full file content as a string\n'
    : '{\n  "success": true,\n  "data": []\n}';
  const defDynamic = resType === 'html'
    ? `function modifyResponse(args) {\n  const { url, response } = args;\n  // response = full source text of the JS/CSS/HTML file\n  // Return the modified string\n  return response;\n}`
    : `function modifyResponse(args) {\n  const { method, url, response, responseType, requestHeaders, requestData, responseJSON } = args;\n  return { ...responseJSON, mocked: true };\n}`;

  const pair0       = rule.pairs?.[0] || {};
  const staticBody  = (pair0.responseBody && respType === 'static')  ? pair0.responseBody : defStatic;
  const dynamicBody = (pair0.responseBody && respType === 'dynamic') ? pair0.responseBody : defDynamic;

  return `
<div class="main-header ${rule.enabled !== false ? 'is-active' : 'is-inactive'} ${hrClass(rule.resourceType || 'rest', rule.resourceSubtype)}" id="editor-header">
  <div class="main-title-wrap">
    <div class="main-title-row">
      <input type="text" class="main-title-input" id="f-name"
             placeholder="Untitled Rule" value="${esc(rule.name || '')}"
             autocomplete="off" spellcheck="false">
    </div>
    <div class="main-subtitle">${isNew ? 'New rule' : 'Edit mock rule'}</div>
  </div>
  <div class="main-actions">
    <button class="btn-close" id="btn-close">${isNew ? 'Cancel' : 'Close'}</button>
    <button class="btn-save" id="btn-save" ${isNew ? '' : 'style="display:none"'}>${isNew ? 'Create Rule' : 'Save Changes'}</button>
  </div>
</div>

<div class="editor-body">

  <div class="section">
    <div class="section-header">
      <span class="section-header-icon">⚙</span>
      General
    </div>
    <div class="section-body">
      <div class="field-row">
        <div class="field" style="flex:2">
          <label>Description <span class="label-hint">(optional)</span></label>
          <input type="text" id="f-description" placeholder="Describe what this rule does"
                 value="${esc(rule.description || '')}">
        </div>
        ${!isNew ? `<div class="field" style="flex:0 0 auto;justify-content:flex-end;display:flex;align-items:flex-end">
          <button class="btn-danger" id="btn-delete" style="height:36px">Delete Rule</button>
        </div>` : ''}
      </div>
      <input type="checkbox" id="f-enabled" ${rule.enabled !== false ? 'checked' : ''} style="display:none">
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <span class="section-header-icon">🎯</span>
      If request matches
    </div>
    <div class="section-body">
      <div class="field">
        <label>Resource Type</label>
        <div class="type-selector" id="type-selector">
          <button type="button" class="type-btn ${resType === 'rest' ? 'active' : ''}" data-type="rest"
            style="--btn-color:var(--t-rest-c);--btn-bg:var(--t-rest-bg)">
            <span class="dot" style="background:var(--t-rest-c)"></span> REST API
          </button>
          <button type="button" class="type-btn ${resType === 'graphql' ? 'active t-gql' : ''}" data-type="graphql"
            style="--btn-color:#fb7185;--btn-bg:rgba(251,113,133,0.12)">
            <span class="dot" style="background:#fb7185"></span> GraphQL API
          </button>
          <button type="button" class="type-btn ${resType === 'html' ? 'active t-htm' : ''}" data-type="html"
            style="--btn-color:var(--t-html-c);--btn-bg:var(--t-html-bg)">
            <span class="dot" style="background:var(--t-html-c)"></span> Resource
          </button>
        </div>
        <div id="subtype-selector" style="display:${resType === 'html' ? 'flex' : 'none'};gap:6px;margin-top:8px;">
          <button type="button" class="subtype-btn ${resSub === 'html' ? 'active' : ''}" data-sub="html"
            style="--btn-color:var(--t-html-c);--btn-bg:var(--t-html-bg);padding:4px 12px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;
                   background:${resSub === 'html' ? 'var(--t-html-bg)' : 'var(--surface2)'};
                   color:${resSub === 'html'      ? 'var(--t-html-c)'  : 'var(--muted)'};
                   border:1px solid ${resSub === 'html' ? 'var(--t-html-bd)' : 'var(--border2)'};">HTML</button>
          <button type="button" class="subtype-btn ${resSub === 'css' ? 'active' : ''}" data-sub="css"
            style="--btn-color:var(--t-css-c);--btn-bg:var(--t-css-bg);padding:4px 12px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;
                   background:${resSub === 'css' ? 'var(--t-css-bg)' : 'var(--surface2)'};
                   color:${resSub === 'css'      ? 'var(--t-css-c)'  : 'var(--muted)'};
                   border:1px solid ${resSub === 'css' ? 'var(--t-css-bd)' : 'var(--border2)'};">CSS</button>
          <button type="button" class="subtype-btn ${resSub === 'js' ? 'active' : ''}" data-sub="js"
            style="--btn-color:var(--t-js-c);--btn-bg:var(--t-js-bg);padding:4px 12px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;
                   background:${resSub === 'js' ? 'var(--t-js-bg)' : 'var(--surface2)'};
                   color:${resSub === 'js'      ? 'var(--t-js-c)'  : 'var(--muted)'};
                   border:1px solid ${resSub === 'js' ? 'var(--t-js-bd)' : 'var(--border2)'};">JS</button>
        </div>
      </div>

      <div class="field">
        <label>URL Pattern(s) <span class="label-hint">— rule fires when ANY pattern matches</span></label>
        <div id="pairs-list" style="margin-top:6px">
          ${(rule.pairs && rule.pairs.length ? rule.pairs : [{}]).map((pair, idx) => buildPairRow(pair, idx)).join('')}
        </div>
        <div class="hint" style="margin-top:5px">
          <b>Wildcard</b>: <code>*</code> = any string · <b>Contains</b>: URL substring · <b>Regex</b>: JS regex · <b>Method</b> col: optional HTTP filter
        </div>
        <button type="button" id="btn-add-pair" style="
          margin-top:6px; padding:6px 12px; background:transparent;
          border:1px dashed var(--border2); border-radius:6px;
          color:var(--text3); font-family:inherit; font-size:11.5px;
          cursor:pointer; transition:all .15s; width:100%; text-align:center;
        ">＋ Add another URL pattern</button>
      </div>

      <div id="graphql-fields" style="${resType !== 'graphql' ? 'display:none' : ''}">
        <div class="field">
          <label>GraphQL Operation Name <span class="label-hint">(optional)</span></label>
          <input type="text" id="f-gql-op" placeholder="e.g. GetProducts"
                 value="${esc((rule.pairs && rule.pairs[0] && rule.pairs[0].gqlOperation) || '')}">
        </div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <span class="section-header-icon">📦</span>
      Then respond with
    </div>
    <div class="section-body">
      <div class="field-row">
        <div class="field">
          <label>Status Code</label>
          <input type="number" id="f-status" placeholder="200"
                 value="${esc((rule.pairs?.[0]?.statusCode) || '')}" min="100" max="599">
          <div class="hint">Leave empty → 200 (or original)</div>
        </div>
        <div class="field">
          <label>Delay (ms)</label>
          <input type="number" id="f-delay" placeholder="0"
                 value="${esc((rule.pairs?.[0]?.delay) || '')}" min="0">
          <div class="hint">Simulate latency</div>
        </div>
      </div>

      <div class="field">
        <label>Response Body</label>
        <div class="response-type-tabs">
          <button type="button" class="resp-tab ${respType === 'static'  ? 'active' : ''}" data-resp="static">Static</button>
          <button type="button" class="resp-tab ${respType === 'dynamic' ? 'active' : ''}" data-resp="dynamic">Dynamic (JS)</button>
        </div>
      </div>

      <div id="static-body-field" ${respType !== 'static' ? 'style="display:none"' : ''}>
        <div class="editor-toolbar">
          <span class="editor-lang-badge">JSON / TEXT</span>
          <div class="editor-actions">
            <button type="button" class="btn-format" id="fmt-static" title="Format code">⇥ Format</button>
          </div>
        </div>
        <textarea id="f-body-static" spellcheck="false" style="display:none">${esc(staticBody)}</textarea>
      </div>

      <div id="dynamic-body-field" ${respType !== 'dynamic' ? 'style="display:none"' : ''}>
        <div class="code-hint" id="code-hint-dyn">
          ${resType === 'html'
            ? `<b>args.response</b> = full file source text · <b>args.url</b> = file URL. Return the modified string.`
            : `<b>args.response</b> (string) · <b>args.responseJSON</b> (object) · <b>args.url</b> · <b>args.method</b> · <b>args.requestData</b>`}
        </div>
        <div class="editor-toolbar" style="margin-top:10px">
          <span class="editor-lang-badge">JavaScript</span>
          <div class="editor-actions">
            <button type="button" class="btn-format" id="fmt-dynamic" title="Format code">⇥ Format</button>
          </div>
        </div>
        <textarea id="f-body-dynamic" spellcheck="false" style="display:none">${esc(dynamicBody)}</textarea>
        <div id="sfvi-risk-bar" style="display:none"></div>
      </div>

      <div class="field">
        <label>Custom Response Headers <span class="label-hint">(JSON, optional)</span></label>
        <textarea id="f-headers" rows="2" placeholder='{"X-Mocked": "true"}'
                  spellcheck="false">${esc(rule.customHeaders || '')}</textarea>
      </div>
    </div>
  </div>

</div>

<div class="statusbar">
  <span>ID: <span style="font-family:'JetBrains Mono',monospace;color:var(--text3)">${esc(rule.id || 'unsaved')}</span></span>
  <span class="sep">•</span>
  <span class="status-ok">SFV-Interceptor active</span>
  <span style="margin-left:auto;color:var(--muted);font-size:10px">
    powered by <a href="https://github.com/thomrnowtea" target="_blank"
      class="author-link">thomrnowtea</a>
  </span>
</div>
`;
}

export async function bindEditorEvents(rule, isNew = false) {
  let currentResType  = rule.resourceType || 'rest';
  let currentResSub   = rule.resourceSubtype || 'html';
  let currentRespType = rule.pairs?.[0]?.responseType || rule.responseType || 'static';

  let isDirty = !!(!rule.id);
  const snapshots = {
    name:     rule.name || '',
    enabled:  rule.enabled !== false,
    resType:  currentResType,
    resSub:   currentResSub,
    respType: currentRespType,
    pairs:    JSON.stringify((rule.pairs || []).map(p => ({
      id:            p.id || '',
      urlPattern:    p.urlPattern || '',
      urlOperator:   p.urlOperator || 'Contains',
      method:        p.method || '',
      caseSensitive: p.caseSensitive || false,
    }))),
    body:        (rule.pairs?.[0]?.responseBody) || '',
    status:      String((rule.pairs?.[0]?.statusCode) || ''),
    delay:       String((rule.pairs?.[0]?.delay) || 0),
    description: rule.description || '',
    headers:     rule.customHeaders || '',
  };

  function setDirty(dirty) {
    isDirty = dirty;
    const btnSave  = document.getElementById('btn-save');
    const btnClose = document.getElementById('btn-close');
    if (!btnSave || !btnClose) return;
    if (isNew) {
      btnClose.style.display = '';
      btnSave.style.display  = '';
    } else if (dirty) {
      btnSave.textContent    = 'Save Changes';
      btnClose.textContent   = 'Cancel';
      btnSave.style.display  = '';
      btnClose.style.display = '';
    } else {
      btnSave.style.display  = 'none';
      btnClose.textContent   = 'Close';
      btnClose.style.display = '';
    }
  }
  setDirty(isDirty);

  function getPairsFromDOM() {
    const rows = document.querySelectorAll('.pair-row');
    return Array.from(rows).map((row, idx) => ({
      id:            pairData[idx]?.id || '',
      urlPattern:    row.querySelector('.pair-url')?.value.trim() || '',
      urlOperator:   row.querySelector('.pair-operator')?.value || 'Contains',
      method:        row.querySelector('.pair-method')?.value || '',
      caseSensitive: row.querySelector('.pair-cs')?.dataset.cs === 'true',
    }));
  }
  function checkDirty() {
    if (!rule.id) { setDirty(true); return; }
    const curName    = document.getElementById('f-name')?.value || '';
    const curEnabled = document.getElementById('f-enabled')?.checked ?? true;
    const curStatus  = String(document.getElementById('f-status')?.value || '');
    const curDelay   = String(parseInt(document.getElementById('f-delay')?.value) || 0);
    const curBody    = getEditorValue(currentRespType === 'dynamic' ? 'f-body-dynamic' : 'f-body-static');
    const curPairs   = JSON.stringify(getPairsFromDOM());
    const curDesc    = document.getElementById('f-description')?.value || '';
    const curHeaders = document.getElementById('f-headers')?.value || '';
    const changed =
      curName    !== snapshots.name    ||
      curEnabled !== snapshots.enabled ||
      currentResType  !== snapshots.resType  ||
      currentResSub   !== snapshots.resSub   ||
      currentRespType !== snapshots.respType ||
      curPairs   !== snapshots.pairs   ||
      curBody    !== snapshots.body    ||
      curStatus  !== snapshots.status  ||
      curDelay   !== snapshots.delay   ||
      curDesc    !== snapshots.description ||
      curHeaders !== snapshots.headers;
    setDirty(changed);
  }
  function wirePairDirty() {
    document.querySelectorAll('.pair-url').forEach(el => el.addEventListener('input', checkDirty));
    document.querySelectorAll('.pair-operator, .pair-method').forEach(el => el.addEventListener('change', checkDirty));
    document.querySelectorAll('.pair-cs').forEach(btn => {
      const idx = parseInt(btn.dataset.idx);
      btn.dataset.cs = String(pairData[idx]?.caseSensitive || false);
      btn.addEventListener('click', () => {
        const cs = btn.dataset.cs !== 'true';
        btn.dataset.cs = String(cs);
        btn.title = cs ? 'Case sensitive (click to disable)' : 'Case insensitive (click to enable)';
        checkDirty();
      });
    });
  }
  setTimeout(() => {
    document.getElementById('f-name')?.addEventListener('input', checkDirty);
    document.getElementById('f-enabled')?.addEventListener('change', checkDirty);
    document.getElementById('f-status')?.addEventListener('input', checkDirty);
    document.getElementById('f-delay')?.addEventListener('input', checkDirty);
    document.getElementById('f-description')?.addEventListener('input', checkDirty);
    document.getElementById('f-headers')?.addEventListener('input', checkDirty);
    document.getElementById('f-body-static')?.addEventListener('input', checkDirty);
    document.getElementById('f-body-dynamic')?.addEventListener('input', checkDirty);
    wirePairDirty();
  }, 100);

  let pairData = JSON.parse(JSON.stringify(rule.pairs || [{ id: 'pair_new', urlPattern: '', urlOperator: 'Contains', method: '' }]));

  function refreshPairsDOM() {
    document.getElementById('pairs-list').innerHTML = pairData.map((p, i) => buildPairRow(p, i)).join('');
    document.querySelectorAll('.pair-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        pairData.splice(idx, 1);
        refreshPairsDOM();
      });
      btn.addEventListener('mouseenter', () => btn.style.color = 'var(--danger)');
      btn.addEventListener('mouseleave', () => btn.style.color = 'var(--muted)');
    });
    wirePairDirty();
    checkDirty();
  }

  document.getElementById('btn-add-pair')?.addEventListener('click', () => {
    pairData.push({ id: 'pair_' + Date.now(), urlPattern: '', urlOperator: 'Contains', method: '' });
    refreshPairsDOM();
  });

  document.querySelectorAll('.pair-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      pairData.splice(idx, 1);
      refreshPairsDOM();
    });
    btn.addEventListener('mouseenter', () => btn.style.color = 'var(--danger)');
    btn.addEventListener('mouseleave', () => btn.style.color = 'var(--muted)');
  });

  document.getElementById('f-enabled').addEventListener('change', () => {
    const hdr = document.getElementById('editor-header');
    const on  = document.getElementById('f-enabled').checked;
    if (hdr) { hdr.classList.toggle('is-active', on); hdr.classList.toggle('is-inactive', !on); }
    checkDirty();
  });

  document.querySelectorAll('#type-selector .type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#type-selector .type-btn').forEach(b => b.className = 'type-btn');
      const t = btn.dataset.type;
      btn.classList.add('active');
      if (t === 'graphql') btn.classList.add('t-gql');
      if (t === 'html')    btn.classList.add('t-htm');
      currentResType = t;
      document.getElementById('graphql-fields').style.display   = t === 'graphql' ? '' : 'none';
      document.getElementById('subtype-selector').style.display = t === 'html'    ? 'flex' : 'none';
      const hdr = document.getElementById('editor-header');
      if (hdr) {
        hdr.classList.remove('hr-rest','hr-graphql','hr-js','hr-css','hr-html');
        hdr.classList.add(hrClass(t, currentResSub));
      }
      const hint = document.getElementById('code-hint-dyn');
      if (hint) {
        hint.innerHTML = t === 'html'
          ? `<b>args.response</b> = full file source text · <b>args.url</b> = file URL. Return the modified string.`
          : `<b>args.response</b> (string) · <b>args.responseJSON</b> (object) · <b>args.url</b> · <b>args.method</b> · <b>args.requestData</b>`;
      }
      checkDirty();
      if (_cbs.updateGhost) _cbs.updateGhost();
    });
  });

  const subtypeColors = {
    html: { bg: 'var(--t-html-bg)', color: 'var(--t-html-c)', border: 'var(--t-html-bd)' },
    css:  { bg: 'var(--t-css-bg)',  color: 'var(--t-css-c)',  border: 'var(--t-css-bd)'  },
    js:   { bg: 'var(--t-js-bg)',   color: 'var(--t-js-c)',   border: 'var(--t-js-bd)'   },
  };
  document.querySelectorAll('.subtype-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sub = btn.dataset.sub;
      currentResSub = sub;
      document.querySelectorAll('.subtype-btn').forEach(b => {
        b.style.background  = 'var(--surface2)';
        b.style.color       = 'var(--muted)';
        b.style.borderColor = 'var(--border2)';
        b.classList.remove('active');
      });
      const c = subtypeColors[sub];
      btn.style.background  = c.bg;
      btn.style.color       = c.color;
      btn.style.borderColor = c.border;
      btn.classList.add('active');
      const hdr = document.getElementById('editor-header');
      if (hdr) {
        hdr.classList.remove('hr-rest','hr-graphql','hr-js','hr-css','hr-html');
        hdr.classList.add(hrClass(currentResType, sub));
      }
      checkDirty();
      if (_cbs.updateGhost) _cbs.updateGhost();
    });
  });

  document.querySelectorAll('.resp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.resp-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentRespType = tab.dataset.resp;
      document.getElementById('static-body-field').style.display  = currentRespType === 'static'  ? '' : 'none';
      document.getElementById('dynamic-body-field').style.display = currentRespType === 'dynamic' ? '' : 'none';
      checkDirty();
      updateRiskBar();
    });
  });

  const sv = document.getElementById('f-body-static')?.value  || '';
  const dv = document.getElementById('f-body-dynamic')?.value || '';
  let cmReady = false;
  mountEditor('f-body-static',  sv, () => { if (cmReady) checkDirty(); });
  mountEditor('f-body-dynamic', dv, () => { if (cmReady) { checkDirty(); updateRiskBar(); } });
  setTimeout(() => {
    cmReady = true;
    if (!isNew) setDirty(false);
    updateRiskBar();
  }, 300);

  document.getElementById('fmt-static')?.addEventListener('click', () => {
    const code = getEditorValue('f-body-static');
    try {
      const parsed = JSON.parse(code);
      setEditorValue('f-body-static', JSON.stringify(parsed, null, 2));
    } catch {
      setEditorValue('f-body-static', formatJS(code));
    }
  });

  document.getElementById('fmt-dynamic')?.addEventListener('click', () => {
    setEditorValue('f-body-dynamic', formatJS(getEditorValue('f-body-dynamic')));
  });

  document.getElementById('btn-save').addEventListener('click', async () => {
    const name = document.getElementById('f-name').value.trim();
    if (!name) { showToast('Rule name is required.', true); return; }

    const pairRows = document.querySelectorAll('.pair-row');
    const pairs = [];
    pairRows.forEach((row, idx) => {
      const urlPattern    = row.querySelector('.pair-url')?.value.trim() || '';
      const urlOperator   = row.querySelector('.pair-operator')?.value || 'Contains';
      const method        = row.querySelector('.pair-method')?.value || '';
      const caseSensitive = row.querySelector('.pair-cs')?.dataset.cs === 'true';
      if (!urlPattern && pairRows.length > 1) return;
      const existingPair = (rule.pairs || [])[idx] || {};
      const editorBody = getEditorValue(currentRespType === 'dynamic' ? 'f-body-dynamic' : 'f-body-static');
      pairs.push({
        id:            existingPair.id || ('pair_' + Date.now() + '_' + idx),
        urlPattern,
        urlOperator,
        method,
        caseSensitive,
        responseType: currentRespType,
        responseBody: idx === 0 ? editorBody : (existingPair.responseBody || editorBody),
        statusCode:   document.getElementById('f-status').value,
        delay:        parseInt(document.getElementById('f-delay').value) || 0,
        gqlOperation: document.getElementById('f-gql-op')?.value.trim() || '',
      });
    });

    if (!pairs.length || !pairs[0].urlPattern) {
      showToast('At least one URL pattern is required.', true); return;
    }

    const updated = {
      id:              rule.id || null,
      name,
      enabled:         document.getElementById('f-enabled').checked,
      resourceType:    currentResType,
      resourceSubtype: currentResType === 'html' ? currentResSub : undefined,
      description:     document.getElementById('f-description')?.value.trim() || '',
      customHeaders:   document.getElementById('f-headers')?.value.trim() || '',
      pairs,
    };

    if (currentRespType === 'dynamic') {
      const dynamicCode = pairs.map(p => p.responseBody).join('\n');
      const risks = analyzeCode(dynamicCode);
      if (risks.length > 0) {
        const confirmed = await showSecurityWarning(risks);
        if (!confirmed) return;
      }
    }

    const res = await msg({ type: 'SAVE_RULE', rule: updated }).catch(() => null);
    if (res?.ok) {
      showToast('✓ Rule saved');
      state.ghostRule = null;
      state.currentId = res.rule.id;
      const savedIdx = state.allRules.findIndex(r => r.id === state.currentId);
      if (savedIdx >= 0) state.allRules[savedIdx] = res.rule; else state.allRules.push(res.rule);
      if (!state.customOrder.includes(state.currentId)) {
        state.customOrder.push(state.currentId);
        chrome.storage.local.set({ sfvi_custom_order: state.customOrder });
      }
      if (_cbs.selectRule) _cbs.selectRule(state.currentId, false);
      if (_cbs.refresh) _cbs.refresh();
    } else { showToast('Failed to save.', true); }
  });

  document.getElementById('btn-delete')?.addEventListener('click', async () => {
    if (!confirm('Delete this rule?')) return;
    const deletedId = rule.id;
    await msg({ type: 'DELETE_RULE', id: deletedId });
    showToast('Rule deleted');
    state.customOrder = state.customOrder.filter(id => id !== deletedId);
    chrome.storage.local.set({ sfvi_custom_order: state.customOrder });
    state.currentId = null;
    state.ghostRule = null;
    if (_cbs.refresh) await _cbs.refresh();
    if (_cbs.showEmpty) _cbs.showEmpty();
  });

  document.getElementById('btn-close')?.addEventListener('click', () => {
    state.ghostRule = null;
    state.currentId = null;
    if (_cbs.renderNav) _cbs.renderNav(document.getElementById('search').value);
    if (_cbs.showEmpty) _cbs.showEmpty();
  });
}
