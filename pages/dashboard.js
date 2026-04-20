// dashboard.js — SFV-Interceptor (Requestly-styled)

let cmEditors = {};

// ── CodeMirror 6 setup ────────────────────────────────────────────────────────

function initCodeMirror() { return !!window.CM6; }

function mountEditor(textareaId, code, onChange) {
  const textarea = document.getElementById(textareaId);
  if (!textarea) return null;

  // Always set the textarea value (fallback if CM6 fails)
  textarea.value = code;

  if (!window.CM6) {
    textarea.style.display = '';
    if (onChange) textarea.addEventListener('input', onChange);
    return null;
  }

  const {
    EditorView, EditorState, keymap, lineNumbers, highlightActiveLine,
    drawSelection, javascript, defaultKeymap, history, historyKeymap,
    indentWithTab, syntaxHighlighting, defaultHighlightStyle,
    bracketMatching, indentOnInput, closeBrackets, autocompletion, foldGutter,
  } = window.CM6;

  textarea.style.display = 'none';

  const wrap = document.createElement('div');
  wrap.className = 'cm-wrap';
  textarea.parentNode.insertBefore(wrap, textarea);

  const theme = EditorView.theme({
    '&': { background: '#1e2130', color: '#cdd9e5', height: 'auto' },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: '12.5px', lineHeight: '1.65',
      minHeight: '200px', maxHeight: '500px', overflow: 'auto',
    },
    '.cm-content':  { padding: '12px 0', caretColor: '#00b4d8' },
    '.cm-line':     { padding: '0 14px' },
    '.cm-gutters':  { background: '#181b27', borderRight: '1px solid #2d3146', color: '#3d4a68', paddingRight: '4px' },
    '.cm-gutterElement': { minWidth: '28px' },
    '.cm-activeLineGutter': { background: 'rgba(62,95,255,0.12)', color: '#7ea5ff' },
    '.cm-activeLine': { background: 'rgba(62,95,255,0.07)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'rgba(62,95,255,0.35)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#00b4d8', borderLeftWidth: '2px' },
    '.cm-matchingBracket': { background: 'rgba(0,180,216,0.18)', outline: '1px solid rgba(0,180,216,0.5)' },
    '.cm-tooltip': { background: '#22262e', border: '1px solid #2d3146', borderRadius: '6px', color: '#cdd9e5' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#3e5fff', color: '#fff' },
    '.tok-keyword':      { color: '#ff7b72' },
    '.tok-definition.tok-variableName': { color: '#d2a8ff' },
    '.tok-definition.tok-function': { color: '#d2a8ff' },
    '.tok-variableName': { color: '#e6edf3' },
    '.tok-string':       { color: '#a5d6ff' },
    '.tok-string2':      { color: '#a5d6ff' },
    '.tok-number':       { color: '#f2cc60' },
    '.tok-comment':      { color: '#8b949e', fontStyle: 'italic' },
    '.tok-operator':     { color: '#ff7b72' },
    '.tok-punctuation':  { color: '#cdd9e5' },
    '.tok-propertyName': { color: '#79c0ff' },
    '.tok-atom':         { color: '#79c0ff' },
    '.tok-bool':         { color: '#79c0ff' },
    '.tok-null':         { color: '#79c0ff' },
    '.tok-typeName':     { color: '#ffa657' },
    '.tok-className':    { color: '#ffa657' },
    '.tok-self':         { color: '#ffa657' },
    '.tok-regexp':       { color: '#a5d6ff' },
  }, { dark: true });

  const state = EditorState.create({
    doc: code,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      autocompletion(),
      foldGutter(),
      history(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      javascript(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          textarea.value = update.state.doc.toString();
          if (onChange) onChange();
        }
      }),
      theme,
    ],
  });

  const view = new EditorView({ state, parent: wrap });
  cmEditors[textareaId] = view;
  return view;
}

// ── Format (prettify) JS code — simple state machine ────────────────────────
function formatJS(code) {
  code = code.trim();
  const TAB = '  ';
  let out = '', indent = 0;
  let i = 0, inString = false, stringChar = '', inComment = false, inLineComment = false;

  function pad() { return TAB.repeat(Math.max(0, indent)); }

  while (i < code.length) {
    const ch = code[i], nx = code[i + 1];

    if (inLineComment) {
      out += ch;
      if (ch === '\n') { inLineComment = false; out += pad(); }
      i++; continue;
    }
    if (inComment) {
      out += ch;
      if (ch === '*' && nx === '/') { out += '/'; i += 2; inComment = false; continue; }
      i++; continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') { out += nx; i += 2; continue; }
      if (ch === stringChar) inString = false;
      i++; continue;
    }
    if (ch === '/' && nx === '/') { inLineComment = true; out += '//'; i += 2; continue; }
    if (ch === '/' && nx === '*') { inComment = true; out += '/*'; i += 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inString = true; stringChar = ch; out += ch; i++; continue; }

    if (ch === '{') { out += '{\n'; indent++; out += pad(); i++; continue; }
    if (ch === '}') {
      indent--;
      out = out.replace(/[ \t]+$/, '');
      if (!out.endsWith('\n')) out += '\n';
      out += pad() + '}'; i++;
      if (nx && !/[;,.)\]}\s]/.test(nx)) { out += '\n' + pad(); }
      continue;
    }
    if (ch === ';') { out += ';\n' + pad(); i++; continue; }
    if (ch === ',' && indent > 0) {
      out += ',';
      i++;
      // If next non-ws is `)` or `]` or `}`, don't break line
      let j = i;
      while (j < code.length && /\s/.test(code[j])) j++;
      if (code[j] === ')' || code[j] === ']' || code[j] === '}') { /* keep inline */ }
      continue;
    }
    if (/\s/.test(ch)) {
      const trimmed = out.trimEnd();
      if (trimmed.endsWith('\n') || out === '') {
        // skip leading whitespace (we handle indent)
      } else {
        out += ' ';
      }
      while (i < code.length && /\s/.test(code[i])) i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function getEditorValue(id) {
  return cmEditors[id]?.state.doc.toString() ?? document.getElementById(id)?.value ?? '';
}
function setEditorValue(id, code) {
  const cm = cmEditors[id];
  if (cm) {
    cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: code } });
  } else {
    const el = document.getElementById(id);
    if (el) el.value = code;
  }
}
function destroyEditors() {
  Object.values(cmEditors).forEach(v => { try { v.destroy(); } catch {} });
  cmEditors = {};
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let allRules    = [];
let sortKey     = 'none';   // 'none' | 'name' | 'type'
let sortDir     = 'asc';    // 'asc' | 'desc'
let currentId   = null;
let selectMode  = false;
let selectedIds = new Set();
let ghostRule   = null; // live preview while creating a new rule

const _subOrder = { html: 0, css: 1, js: 2 };

function sortedRules() {
  if (sortKey === 'none') return [...allRules];
  const typeOrder = { rest: 0, graphql: 1, html: 2 };
  return [...allRules].sort((a, b) => {
    let va, vb;
    if (sortKey === 'name') {
      va = (a.name || '').toLowerCase();
      vb = (b.name || '').toLowerCase();
    } else {
      // type sort: primary = resourceType, secondary = resourceSubtype
      va = (typeOrder[a.resourceType] ?? 99) * 10 + (_subOrder[a.resourceSubtype] ?? 9);
      vb = (typeOrder[b.resourceType] ?? 99) * 10 + (_subOrder[b.resourceSubtype] ?? 9);
    }
    if (va < vb) return sortDir === 'asc' ? -1 :  1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });
}
async function msg(d) { return chrome.runtime.sendMessage(d); }
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(text, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2800);
}

// ── Requestly converters ──────────────────────────────────────────────────────

function toRQ(rule) {
  const now = Date.now();
  const resType = rule.resourceType === 'graphql' ? 'graphqlApi'
                : rule.resourceType === 'html'    ? 'staticFile' : 'restApi';
  const pairs = (rule.pairs || []).map(p => ({
    id: p.id || Math.random().toString(36).slice(2, 7),
    response: {
      resourceType: resType, statusCode: p.statusCode || '',
      type: p.responseType === 'dynamic' ? 'code' : 'static',
      value: p.responseBody || '',
    },
    source: {
      filters: p.method ? [{ requestMethod: [p.method] }] : [],
      key: 'Url', operator: p.urlOperator || 'Contains', value: p.urlPattern || '',
    },
  }));
  return {
    createdBy: null, creationDate: now, currentOwner: null,
    description: rule.description || '', groupId: '',
    id: rule.id || ('Response_' + Math.random().toString(36).slice(2, 8)),
    isSample: false, lastModifiedBy: null, modificationDate: now,
    name: rule.name || 'Untitled', objectType: 'rule',
    pairs: pairs.length ? pairs : [{ id:'p0', response:{resourceType:resType,statusCode:'',type:'static',value:''}, source:{filters:[],key:'Url',operator:'Contains',value:''} }],
    ruleType: 'Response',
    status: rule.enabled !== false ? 'Active' : 'Inactive',
  };
}

function fromRQ(rq) {
  const firstPair = rq.pairs?.[0] || {};
  const firstSrc  = firstPair.source  || {};
  const firstResp = firstPair.response || {};
  let rt = 'rest';
  if (firstResp.resourceType === 'graphqlApi') rt = 'graphql';
  else if (firstResp.resourceType === 'staticFile') rt = 'html';
  const pairs = (rq.pairs || [firstPair]).map(p => {
    const s = p.source || {}, r = p.response || {};
    const mf = s.filters?.find(f => f.requestMethod);
    let rb = r.value || '', rtype = r.type === 'code' ? 'dynamic' : 'static';
    if (rq.ruleType === 'Script') { rb = rq.pairs?.[0]?.scripts?.[0]?.value || ''; rtype = 'dynamic'; }
    return {
      id:           p.id || ('pair_' + Math.random().toString(36).slice(2, 8)),
      urlPattern:   s.value || '',
      urlOperator:  s.operator === 'Wildcard_Matches' ? 'Wildcard' : (s.operator || 'Contains'),
      method:       mf?.requestMethod?.[0] || '',
      responseType: rtype, responseBody: rb,
      statusCode:   r.statusCode || '', delay: 0,
    };
  });
  return {
    id:           rq.id || ('rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
    name:         rq.name || 'Imported',
    enabled:      rq.status !== 'Inactive',
    resourceType: rt,
    description:  rq.description || '',
    pairs,
  };
}

// ── Sidebar nav ───────────────────────────────────────────────────────────────

function navRuleClass(t, sub) {
  if (t === 'html') return { js: 'nr-js', css: 'nr-css', html: 'nr-html' }[sub] || 'nr-html';
  return { rest: 'nr-rest', graphql: 'nr-graphql' }[t] || 'nr-rest';
}

function hrClass(t, sub) {
  if (t === 'html') return { js: 'hr-js', css: 'hr-css', html: 'hr-html' }[sub] || 'hr-html';
  return { rest: 'hr-rest', graphql: 'hr-graphql' }[t] || 'hr-rest';
}

function typeClass(t, sub) {
  if (t === 'html') {
    return { js: 't-js', css: 't-css', html: 't-htm-sub' }[sub] || 't-html';
  }
  return { rest: 't-rest', graphql: 't-graphql', html: 't-html' }[t] || 't-rest';
}
function typeLabel(t, sub) {
  if (t === 'html') {
    return { js: 'JS', css: 'CSS', html: 'HTML' }[sub] || 'RES';
  }
  return { rest: 'API', graphql: 'GQL' }[t] || 'API';
}

function renderNav(filter = '') {
  const nav = document.getElementById('rules-nav');
  const q = filter.toLowerCase();
  const list = sortedRules().filter(r => {
    if (!q) return true;
    if ((r.name || '').toLowerCase().includes(q)) return true;
    return (r.pairs || []).some(p => (p.urlPattern || '').toLowerCase().includes(q));
  });

  // Build ghost entry HTML if creating a new rule
  const ghostHTML = ghostRule ? `
    <div class="nav-rule ghost active">
      <span class="nav-rule-type ${typeClass(ghostRule.resourceType || 'rest', ghostRule.resourceSubtype)}">${typeLabel(ghostRule.resourceType || 'rest', ghostRule.resourceSubtype)}</span>
      <div class="nav-rule-info">
        <div class="nav-rule-name">${esc(ghostRule.name || 'Untitled Rule')}</div>
        <div class="nav-rule-url">${esc(ghostRule.urlPattern || '—')}</div>
      </div>
    </div>` : '';

  if (!list.length && !ghostHTML) {
    nav.innerHTML = `<div style="padding:18px 12px;color:var(--muted);font-size:11.5px;text-align:center">${allRules.length ? 'No matches.' : 'No rules yet.'}</div>${ghostHTML}`;
    return;
  }
  nav.innerHTML = list.map(r => `
    <div class="nav-rule ${navRuleClass(r.resourceType, r.resourceSubtype)} ${r.id === currentId && !selectMode ? 'active' : ''} ${r.enabled !== false ? '' : 'disabled'} ${selectMode && selectedIds.has(r.id) ? 'nav-selected' : ''}" data-id="${esc(r.id)}">
      ${selectMode
        ? `<input type="checkbox" class="nav-checkbox" data-id="${esc(r.id)}" ${selectedIds.has(r.id) ? 'checked' : ''}
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
      ${!selectMode ? `<label class="toggle-sm" data-stop-prop="1">
        <input type="checkbox" ${r.enabled !== false ? 'checked' : ''} data-toggle="${esc(r.id)}">
        <div class="toggle-sm-track"><div class="toggle-sm-thumb"></div></div>
      </label>` : ''}
    </div>`).join('') + ghostHTML;
  nav.querySelectorAll('.nav-rule').forEach(el =>
    el.addEventListener('click', e => {
      if (selectMode) {
        // toggle the checkbox of this row
        const cb = el.querySelector('.nav-checkbox');
        if (cb && e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
        return;
      }
      selectRule(el.dataset.id);
    })
  );

  // Wire checkboxes in select mode
  nav.querySelectorAll('.nav-checkbox').forEach(cb => {
    cb.addEventListener('change', e => {
      e.stopPropagation();
      if (cb.checked) selectedIds.add(cb.dataset.id);
      else            selectedIds.delete(cb.dataset.id);
      updateSelectButtons();
      // Update selected highlight without full re-render
      el.classList.toggle('nav-selected', cb.checked);
    });
  });
  nav.querySelectorAll('[data-stop-prop]').forEach(label => {
    label.addEventListener('click', e => e.stopPropagation());
  });
  nav.querySelectorAll('[data-toggle]').forEach(el =>
    el.addEventListener('change', async e => {
      e.stopPropagation();
      const ruleId = el.dataset.toggle;
      const res = await msg({ type: 'TOGGLE_RULE', id: ruleId });
      // Update editor pill immediately if this rule is open
      const enabled = res?.enabled ?? false;
      if (ruleId === currentId) {
        const toggle = document.getElementById('f-enabled');
        if (toggle) toggle.checked = enabled;
        const hdr = document.getElementById('editor-header');
        if (hdr) { hdr.classList.toggle('is-active', enabled); hdr.classList.toggle('is-inactive', !enabled); }
      }
      // refresh() will be called by RULES_CHANGED — no need to call it here
      // (calling it here AND from RULES_CHANGED causes the double-refresh race)
    })
  );
}


// ── Pair row builder ──────────────────────────────────────────────────────────
function buildPairRow(pair, idx) {
  const op = pair.urlOperator || 'Contains';
  const cs = pair.caseSensitive || false;
  return `
    <div class="pair-row" data-pair-idx="${idx}" style="
      display:grid;
      grid-template-columns: 120px 1fr auto 100px 28px;
      gap:6px; align-items:center;
      margin-bottom:5px;
    ">
      <select class="pair-operator" data-idx="${idx}">
        <option value="Contains" ${op === 'Contains' ? 'selected' : ''}>Contains</option>
        <option value="Wildcard" ${op === 'Wildcard' ? 'selected' : ''}>Wildcard</option>
        <option value="Equals"   ${op === 'Equals'   ? 'selected' : ''}>Equals</option>
        <option value="Regex"    ${op === 'Regex'    ? 'selected' : ''}>Regex</option>
      </select>
      <input type="text" class="pair-url" data-idx="${idx}"
             value="${esc(pair.urlPattern || '')}"
             placeholder="e.g. *api/endpoint*  or  *.bundle.js*"
             autocomplete="off" spellcheck="false">
      <button type="button" class="pair-cs" data-idx="${idx}" title="${cs ? 'Case sensitive (click to disable)' : 'Case insensitive (click to enable)'}"
        style="height:30px;padding:0 8px;border-radius:5px;border:1px solid ${cs ? 'var(--accent)' : 'var(--border2)'};
               background:${cs ? 'var(--accent-dim)' : 'var(--surface2)'};color:${cs ? 'var(--accent)' : 'var(--muted)'};
               font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .15s;font-family:inherit;">
        Aa
      </button>
      <select class="pair-method" data-idx="${idx}">
        <option value=""       ${!pair.method             ? 'selected' : ''}>Any</option>
        <option value="GET"    ${pair.method === 'GET'    ? 'selected' : ''}>GET</option>
        <option value="POST"   ${pair.method === 'POST'   ? 'selected' : ''}>POST</option>
        <option value="PUT"    ${pair.method === 'PUT'    ? 'selected' : ''}>PUT</option>
        <option value="PATCH"  ${pair.method === 'PATCH'  ? 'selected' : ''}>PATCH</option>
        <option value="DELETE" ${pair.method === 'DELETE' ? 'selected' : ''}>DELETE</option>
      </select>
      ${idx > 0
        ? `<button type="button" class="pair-remove" data-idx="${idx}"
             style="background:none;border:none;color:var(--muted);cursor:pointer;
                    padding:0;font-size:15px;line-height:1;text-align:center;
                    border-radius:4px;transition:color .15s;" title="Remove">✕</button>`
        : `<div></div>`
      }
    </div>
  `;
}


// ── Editor HTML ───────────────────────────────────────────────────────────────

function buildEditorHTML(rule) {
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

  <!-- ── General ────────────────────────────────────────────────────── -->
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

  <!-- ── Source condition ────────────────────────────────────────────── -->
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
            style="--btn-color:var(--green);--btn-bg:var(--green-dim)">
            <span class="dot" style="background:var(--green)"></span> API
          </button>
          <button type="button" class="type-btn ${resType === 'graphql' ? 'active t-gql' : ''}" data-type="graphql"
            style="--btn-color:#fb7185;--btn-bg:rgba(251,113,133,0.12)">
            <span class="dot" style="background:#fb7185"></span> GraphQL
          </button>
          <button type="button" class="type-btn ${resType === 'html' ? 'active t-htm' : ''}" data-type="html"
            style="--btn-color:var(--accent);--btn-bg:var(--accent-dim)">
            <span class="dot" style="background:var(--accent)"></span> Resource
          </button>
        </div>
        <div id="subtype-selector" style="display:${resType === 'html' ? 'flex' : 'none'};gap:6px;margin-top:8px;">
          <button type="button" class="subtype-btn ${resSub === 'html' ? 'active' : ''}" data-sub="html"
            style="--btn-color:var(--accent);--btn-bg:rgba(91,115,255,0.15);padding:4px 12px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;
                   background:${resSub === 'html' ? 'rgba(91,115,255,0.15)'   : 'var(--surface2)'};
                   color:${resSub === 'html'      ? 'var(--accent)'           : 'var(--muted)'};
                   border:1px solid ${resSub === 'html' ? 'rgba(91,115,255,0.35)' : 'var(--border2)'};">
            HTML
          </button>
          <button type="button" class="subtype-btn ${resSub === 'css' ? 'active' : ''}" data-sub="css"
            style="--btn-color:#a78bfa;--btn-bg:rgba(167,139,250,0.15);padding:4px 12px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;
                   background:${resSub === 'css' ? 'rgba(167,139,250,0.15)'  : 'var(--surface2)'};
                   color:${resSub === 'css'      ? '#a78bfa'                 : 'var(--muted)'};
                   border:1px solid ${resSub === 'css' ? 'rgba(167,139,250,0.35)' : 'var(--border2)'};">
            CSS
          </button>
          <button type="button" class="subtype-btn ${resSub === 'js' ? 'active' : ''}" data-sub="js"
            style="--btn-color:#fbbf24;--btn-bg:rgba(251,191,36,0.15);padding:4px 12px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;
                   background:${resSub === 'js' ? 'rgba(251,191,36,0.15)'   : 'var(--surface2)'};
                   color:${resSub === 'js'      ? '#fbbf24'                 : 'var(--muted)'};
                   border:1px solid ${resSub === 'js' ? 'rgba(251,191,36,0.35)' : 'var(--border2)'};">
            JS
          </button>
        </div>
      </div>

      <!-- URL Pattern pairs list — one row per pattern, all sharing same responseBody -->
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

  <!-- ── Response ─────────────────────────────────────────────────────── -->
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
      style="color:var(--text3);text-decoration:none;font-weight:500;transition:color .15s"
      onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text3)'">thomrnowtea</a>
  </span>
</div>
`;
}

// ── Bind editor events ────────────────────────────────────────────────────────

async function bindEditorEvents(rule, isNew = false) {
  let currentResType  = rule.resourceType || 'rest';
  let currentResSub   = rule.resourceSubtype || 'html';
  let currentRespType = rule.pairs?.[0]?.responseType || rule.responseType || 'static';

  // ── Dirty tracking: show Save only when changes exist ────────────────────
  let isDirty = !!(!rule.id); // new rules start dirty
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
      // new rule: Cancel always visible, Create Rule always visible
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

  // Wire dirty detection on all inputs
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
    if (!rule.id) { setDirty(true); return; } // new rule always dirty
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
      // Init dataset from pairData
      const idx = parseInt(btn.dataset.idx);
      btn.dataset.cs = String(pairData[idx]?.caseSensitive || false);
      btn.addEventListener('click', () => {
        const cs = btn.dataset.cs !== 'true';
        btn.dataset.cs = String(cs);
        btn.style.borderColor  = cs ? 'var(--accent)'    : 'var(--border2)';
        btn.style.background   = cs ? 'var(--accent-dim)': 'var(--surface2)';
        btn.style.color        = cs ? 'var(--accent)'    : 'var(--muted)';
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
    // CodeMirror changes: hook via textarea change events (CM updates textarea on change)
    document.getElementById('f-body-static')?.addEventListener('input', checkDirty);
    document.getElementById('f-body-dynamic')?.addEventListener('input', checkDirty);
    wirePairDirty();
  }, 100);

  // ── Pairs list: add/remove URL patterns ──────────────────────────────────
  let pairData = JSON.parse(JSON.stringify(rule.pairs || [{ id: 'pair_new', urlPattern: '', urlOperator: 'Contains', method: '' }]));

  function refreshPairsDOM() {
    document.getElementById('pairs-list').innerHTML = pairData.map((p, i) => buildPairRow(p, i)).join('');
    // Wire up remove buttons
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

  // Initial wire-up of remove buttons (first render already in DOM)
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

      // Update header type color
      const hdr = document.getElementById('editor-header');
      if (hdr) {
        hdr.classList.remove('hr-rest','hr-graphql','hr-js','hr-css','hr-html');
        hdr.classList.add(hrClass(t, currentResSub));
      }

      // Update dynamic code hint
      const hint = document.getElementById('code-hint-dyn');
      if (hint) {
        hint.innerHTML = t === 'html'
          ? `<b>args.response</b> = full file source text · <b>args.url</b> = file URL. Return the modified string.`
          : `<b>args.response</b> (string) · <b>args.responseJSON</b> (object) · <b>args.url</b> · <b>args.method</b> · <b>args.requestData</b>`;
      }
      checkDirty();
      updateGhost();
    });
  });

  // Subtype buttons (JS / CSS / HTML under Resource)
  const subtypeColors = {
    html: { bg: 'rgba(91,115,255,0.15)',  color: 'var(--accent)', border: 'rgba(91,115,255,0.35)'  },
    css:  { bg: 'rgba(167,139,250,0.15)', color: '#a78bfa',       border: 'rgba(167,139,250,0.35)' },
    js:   { bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24',       border: 'rgba(251,191,36,0.35)'  },
  };
  document.querySelectorAll('.subtype-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sub = btn.dataset.sub;
      currentResSub = sub;
      document.querySelectorAll('.subtype-btn').forEach(b => {
        const c = subtypeColors[b.dataset.sub];
        b.style.background   = 'var(--surface2)';
        b.style.color        = 'var(--muted)';
        b.style.borderColor  = 'var(--border2)';
        b.classList.remove('active');
      });
      const c = subtypeColors[sub];
      btn.style.background  = c.bg;
      btn.style.color       = c.color;
      btn.style.borderColor = c.border;
      btn.classList.add('active');
      // Update header type color
      const hdr = document.getElementById('editor-header');
      if (hdr) {
        hdr.classList.remove('hr-rest','hr-graphql','hr-js','hr-css','hr-html');
        hdr.classList.add(hrClass(currentResType, sub));
      }
      checkDirty();
      updateGhost();
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
    });
  });

  // Mount CM6 editors — delay onChange wiring to avoid spurious dirty trigger on initial mount
  const sv = document.getElementById('f-body-static')?.value  || '';
  const dv = document.getElementById('f-body-dynamic')?.value || '';
  let cmReady = false;
  mountEditor('f-body-static',  sv, () => { if (cmReady) checkDirty(); });
  mountEditor('f-body-dynamic', dv, () => { if (cmReady) checkDirty(); });
  setTimeout(() => {
    cmReady = true;
    // For existing rules, re-assert clean state after CM6 has fully mounted
    if (!isNew) setDirty(false);
  }, 300);

  // Format buttons
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
    const code = getEditorValue('f-body-dynamic');
    setEditorValue('f-body-dynamic', formatJS(code));
  });

  // Save
  document.getElementById('btn-save').addEventListener('click', async () => {
    const name = document.getElementById('f-name').value.trim();
    if (!name) { showToast('Rule name is required.', true); return; }

    // Read current pair URLs from DOM
    const pairRows = document.querySelectorAll('.pair-row');
    const pairs = [];
    pairRows.forEach((row, idx) => {
      const urlPattern = row.querySelector('.pair-url')?.value.trim() || '';
      const urlOperator = row.querySelector('.pair-operator')?.value || 'Contains';
      const method = row.querySelector('.pair-method')?.value || '';
      const caseSensitive = row.querySelector('.pair-cs')?.dataset.cs === 'true';
      if (!urlPattern && pairRows.length > 1) return; // skip empty rows (keep if only one)
      const existingPair = (rule.pairs || [])[idx] || {};
      pairs.push({
        id:            existingPair.id || ('pair_' + Date.now() + '_' + idx),
        urlPattern,
        urlOperator,
        method,
        caseSensitive,
        responseType: currentRespType,
        responseBody: getEditorValue(currentRespType === 'dynamic' ? 'f-body-dynamic' : 'f-body-static'),
        statusCode:   document.getElementById('f-status').value,
        delay:        parseInt(document.getElementById('f-delay').value) || 0,
        gqlOperation: document.getElementById('f-gql-op')?.value.trim() || '',
      });
    });

    if (!pairs.length || !pairs[0].urlPattern) {
      showToast('At least one URL pattern is required.', true); return;
    }

    const updated = {
      id:           rule.id || null,
      name,
      enabled:      document.getElementById('f-enabled').checked,
      resourceType:    currentResType,
      resourceSubtype: currentResType === 'html' ? currentResSub : undefined,
      description:  document.getElementById('f-description')?.value.trim() || '',
      pairs,
    };
    const res = await msg({ type: 'SAVE_RULE', rule: updated }).catch(() => null);
    if (res?.ok) {
      showToast('✓ Rule saved');
      ghostRule = null;
      currentId = res.rule.id;
      await refresh();
      selectRule(currentId, false);
    } else { showToast('Failed to save.', true); }
  });

  document.getElementById('btn-delete')?.addEventListener('click', async () => {
    if (!confirm('Delete this rule?')) return;
    await msg({ type: 'DELETE_RULE', id: rule.id });
    showToast('Rule deleted');
    currentId = null;
    ghostRule = null;
    await refresh();
    showEmpty();
  });

  document.getElementById('btn-close')?.addEventListener('click', () => {
    ghostRule = null;
    currentId = null;
    renderNav(document.getElementById('search').value);
    showEmpty();
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────

function showEmpty() {
  ghostRule = null;
  destroyEditors();
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="empty-main">
      <div class="empty-icon">🛰️</div>
      <h2>No rule selected</h2>
      <p>Select a rule from the sidebar, or create a new one to start intercepting requests.</p>
      <button class="btn-new-sidebar" style="max-width:200px;margin-top:4px" id="btn-new-empty">+ New Rule</button>
    </div>`;
  document.getElementById('btn-new-empty').addEventListener('click', newRule);
}

function selectRule(id, scroll = true) {
  const rule = allRules.find(r => r.id === id);
  if (!rule) return;
  ghostRule = null;
  currentId = id;
  renderNav(document.getElementById('search').value);
  destroyEditors();
  document.getElementById('main').innerHTML = buildEditorHTML(rule);
  bindEditorEvents(rule, false);
  if (scroll) {
    const eb = document.querySelector('.editor-body');
    if (eb) eb.scrollTop = 0;
  }
}

function updateGhost() {
  if (!ghostRule) return;
  ghostRule.name            = document.getElementById('f-name')?.value || '';
  ghostRule.resourceType    = document.querySelector('#type-selector .type-btn.active')?.dataset.type || 'rest';
  ghostRule.resourceSubtype = document.querySelector('.subtype-btn.active')?.dataset.sub || 'js';
  ghostRule.urlPattern      = document.querySelector('.pair-url')?.value || '';
  renderNav(document.getElementById('search').value);
}

function newRule() {
  currentId = null;
  ghostRule = { name: '', resourceType: 'rest', urlPattern: '' };
  renderNav(document.getElementById('search').value);
  destroyEditors();
  const blank = { enabled: true, resourceType: 'rest', responseType: 'static' };
  document.getElementById('main').innerHTML = buildEditorHTML(blank);
  bindEditorEvents(blank, true);
  // Wire ghost live updates
  setTimeout(() => {
    document.getElementById('f-name')?.addEventListener('input', updateGhost);
    document.querySelector('.pair-url')?.addEventListener('input', updateGhost);
    document.querySelectorAll('#type-selector .type-btn').forEach(btn =>
      btn.addEventListener('click', updateGhost)
    );
  }, 50);
}

let _refreshing = false;
let _refreshPending = false;

async function refresh() {
  if (_refreshing) {
    // Queue one pending refresh — discard duplicates
    _refreshPending = true;
    return;
  }
  _refreshing = true;
  try {
    const res = await msg({ type: 'GET_RULES' });
    allRules = res.rules || [];
    renderNav(document.getElementById('search').value);
    const selectBtn = document.getElementById('btn-select-rules');
    if (selectBtn) selectBtn.disabled = allRules.length === 0;
  } finally {
    _refreshing = false;
    if (_refreshPending) {
      _refreshPending = false;
      refresh(); // run the queued refresh once
    }
  }
}

// ── Global events ─────────────────────────────────────────────────────────────

document.getElementById('btn-new').addEventListener('click', newRule);
document.getElementById('search').addEventListener('input', e => renderNav(e.target.value));

// ── Sort controls ─────────────────────────────────────────────────────────────

function updateSortUI() {
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === sortKey);
  });
  const dirBtn = document.getElementById('sort-dir');
  if (dirBtn) {
    dirBtn.textContent = sortDir === 'asc' ? 'A→Z' : 'Z→A';
    dirBtn.classList.toggle('active', sortKey !== 'none');
  }
  // Persist so popup can mirror
  chrome.storage.local.set({ sfvi_sort_key: sortKey, sfvi_sort_dir: sortDir });
}

document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    sortKey = btn.dataset.sort;
    updateSortUI();
    renderNav(document.getElementById('search').value);
  });
});

document.getElementById('sort-dir')?.addEventListener('click', () => {
  sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  updateSortUI();
  renderNav(document.getElementById('search').value);
});

// ── Select mode ───────────────────────────────────────────────────────────────
function updateSelectButtons() {
  const count     = selectedIds.size;
  const exportBtn = document.getElementById('export-selected');
  const deleteBtn = document.getElementById('delete-selected');
  const allBtn    = document.getElementById('select-all-rules');
  if (exportBtn) exportBtn.textContent = count ? `↑ Export (${count})` : '↑ Export';
  if (deleteBtn) deleteBtn.textContent = count ? `🗑 Delete (${count})` : '🗑 Delete';
  if (allBtn) {
    const allSelected = allRules.length > 0 && allRules.every(r => selectedIds.has(r.id));
    allBtn.textContent = allSelected ? '☐ None' : '☑ All';
  }
}

document.getElementById('btn-select-rules').addEventListener('click', () => {
  selectMode  = true;
  selectedIds = new Set();
  document.getElementById('btn-select-rules').style.display   = 'none';
  document.getElementById('btn-deselect-rules').style.display = '';
  document.getElementById('select-all-rules').style.display   = '';
  document.getElementById('select-actions').style.display     = '';
  updateSelectButtons();
  renderNav(document.getElementById('search').value);
});

document.getElementById('btn-deselect-rules').addEventListener('click', () => {
  selectMode  = false;
  selectedIds = new Set();
  document.getElementById('btn-select-rules').style.display   = '';
  document.getElementById('btn-deselect-rules').style.display  = 'none';
  document.getElementById('select-all-rules').style.display    = 'none';
  document.getElementById('select-actions').style.display      = 'none';
  updateSelectButtons();
  renderNav(document.getElementById('search').value);
});

document.getElementById('select-all-rules').addEventListener('click', () => {
  const allSelected = allRules.length > 0 && allRules.every(r => selectedIds.has(r.id));
  if (allSelected) {
    selectedIds = new Set();
  } else {
    selectedIds = new Set(allRules.map(r => r.id));
  }
  updateSelectButtons();
  renderNav(document.getElementById('search').value);
});

document.getElementById('export-selected').addEventListener('click', () => {
  if (!selectedIds.size) { showToast('No rules selected', true); return; }
  const toExport = sortedRules().filter(r => selectedIds.has(r.id));
  const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'sfv-interceptor-rules.json'; a.click();
  URL.revokeObjectURL(url);
  showToast(`↑ Exported ${toExport.length} rule(s)`);
});

document.getElementById('delete-selected').addEventListener('click', async () => {
  if (!selectedIds.size) return;
  if (!confirm(`Delete ${selectedIds.size} rule(s)? This cannot be undone.`)) return;
  for (const id of selectedIds) {
    await msg({ type: 'DELETE_RULE', id });
  }
  selectedIds = new Set();
  selectMode  = false;
  document.getElementById('btn-select-rules').style.display   = '';
  document.getElementById('btn-deselect-rules').style.display  = 'none';
  document.getElementById('select-all-rules').style.display    = 'none';
  document.getElementById('select-actions').style.display      = 'none';
  updateSelectButtons();
  await refresh();
  showEmpty();
  showToast('Rules deleted');
});

// export handled by select mode



document.getElementById('import-all').addEventListener('click', () =>
  document.getElementById('import-file').click()
);

document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return; e.target.value = '';
  let raw;
  try { raw = JSON.parse(await file.text()); } catch { showToast('Invalid JSON', true); return; }
  if (!Array.isArray(raw)) { showToast('Expected array', true); return; }
  const isRQ   = raw.length === 0 || raw[0].objectType === 'rule' || raw[0].ruleType;
  const incoming = isRQ ? raw.map(fromRQ) : raw;
  if (!incoming.length) { showToast('No rules in file', true); return; }

  // Detect conflicts
  const existingIds = new Set(allRules.map(r => r.id));
  const conflicts   = incoming.filter(r => existingIds.has(r.id)).length;
  const fresh       = incoming.length - conflicts;

  let strategy = 'skip';
  if (conflicts > 0) {
    // Ask only if there are conflicts
    const overwrite = confirm(
      `Importing ${incoming.length} rule(s):\n` +
      `  • ${fresh} new\n` +
      `  • ${conflicts} already exist (same ID)\n\n` +
      `OK → overwrite existing\nCancel → keep existing, import only new`
    );
    strategy = overwrite ? 'overwrite' : 'skip';
  }

  const res = await msg({ type: 'MERGE_RULES', rules: incoming, strategy });
  await refresh();
  showToast(`✓ ${res.added} added · ${res.updated} updated · ${res.skipped} skipped`);
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  initCodeMirror();
  // Load persisted sort prefs before first render
  await new Promise(res => chrome.storage.local.get(['sfvi_sort_key','sfvi_sort_dir'], d => {
    if (d.sfvi_sort_key) sortKey = d.sfvi_sort_key;
    if (d.sfvi_sort_dir) sortDir = d.sfvi_sort_dir;
    res();
  }));
  await refresh();
  updateSortUI();
  const params = new URLSearchParams(location.search);
  const editId = params.get('edit');
  const action = params.get('action');
  if (editId && allRules.find(r => r.id === editId)) selectRule(editId);
  else if (action === 'new') newRule();
  else showEmpty();
  document.getElementById('btn-new-empty')?.addEventListener('click', newRule);
  // Auto-open export modal if opened from popup export button
  if (action === 'export') showExportModal(allRules);
})();

// ── Auto-sync: re-render when rules change from any context ──────────────────
// This keeps the sidebar nav, editor pill, and toggle states in sync with the
// popup and any other dashboard tabs.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'RULES_CHANGED') return;
  (async () => {
    await refresh();
    if (currentId) {
      const updated = allRules.find(r => r.id === currentId);
      if (updated) {
        const toggle = document.getElementById('f-enabled');
        if (toggle) toggle.checked = updated.enabled !== false;
        const hdr = document.getElementById('editor-header');
        if (hdr) {
          hdr.classList.toggle('is-active',   updated.enabled !== false);
          hdr.classList.toggle('is-inactive', updated.enabled === false);
        }
      }
    }
    sendResponse({});
  })();
  return true; // keep message channel open for async response
});
