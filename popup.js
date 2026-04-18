// popup.js — SFV-Interceptor

let _allRules = [];
let _currentTab = 'all';

async function sendMsg(msg) { return chrome.runtime.sendMessage(msg); }
async function loadRules() { const r = await sendMsg({ type:'GET_RULES' }); return r.rules||[]; }

function typeLabel(t) { return {rest:'REST',graphql:'GraphQL',html:'HTML/JS/CSS'}[t]||'REST'; }
function typeCls(t)   { return {rest:'type-rest',graphql:'type-graphql',html:'type-html'}[t]||'type-rest'; }
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
    ? _allRules.filter(r => r.enabled !== false)
    : _allRules).filter(r => !q || (r.name||'').toLowerCase().includes(q) || (r.urlPattern||'').toLowerCase().includes(q));

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
      <span class="rule-type-badge ${typeCls(r.resourceType)}">${typeLabel(r.resourceType)}</span>
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

function openDashboard(editId, action) {
  let url = chrome.runtime.getURL('pages/dashboard.html');
  if (editId)       url += '?edit=' + editId;
  else if (action)  url += '?action=' + action;
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



// ── Requestly converters ──────────────────────────────────────────────────────

function toRequestlyRule(rule) {
  const now = Date.now();
  const resType = rule.resourceType==='graphql' ? 'graphqlApi'
                : rule.resourceType==='html'    ? 'staticFile' : 'restApi';
  const pairs = (rule.pairs || []).map(p => {
    const op = p.urlOperator || 'Contains';
    return {
      id: p.id || Math.random().toString(36).slice(2,7),
      response: { resourceType:resType, statusCode:p.statusCode||'',
        type:p.responseType==='dynamic'?'code':'static', value:p.responseBody||'' },
      source: { filters:p.method?[{requestMethod:[p.method]}]:[], key:'Url', operator:op, value:p.urlPattern||'' }
    };
  });
  return {
    createdBy:null, creationDate:Date.now(), currentOwner:null,
    description:rule.description||'', groupId:'',
    id:rule.id||('Response_'+Math.random().toString(36).slice(2,8)),
    isSample:false, lastModifiedBy:null, modificationDate:now,
    name:rule.name||'Untitled', objectType:'rule',
    pairs: pairs.length ? pairs : [{ id:'pair_0', response:{resourceType:resType,statusCode:'',type:'static',value:''}, source:{filters:[],key:'Url',operator:'Contains',value:''} }],
    ruleType:'Response', status:rule.enabled!==false?'Active':'Inactive',
  };
}

function fromRequestlyRule(rq) {
  const firstPair = rq.pairs?.[0]||{};
  const firstSrc  = firstPair.source||{};
  const firstResp = firstPair.response||{};
  let rt = 'rest';
  if(firstResp.resourceType==='graphqlApi') rt='graphql';
  else if(firstResp.resourceType==='staticFile') rt='html';
  const pairs = (rq.pairs||[firstPair]).map(p => {
    const s=p.source||{}, r=p.response||{};
    const mf=s.filters?.find(f=>f.requestMethod);
    let rb=r.value||'', rtype=r.type==='code'?'dynamic':'static';
    if(rq.ruleType==='Script'){rb=rq.pairs?.[0]?.scripts?.[0]?.value||'';rtype='dynamic';}
    return {
      id: p.id||('pair_'+Math.random().toString(36).slice(2,8)),
      urlPattern:  s.value||'',
      urlOperator: s.operator==='Wildcard_Matches'?'Wildcard':(s.operator||'Contains'),
      method:      mf?.requestMethod?.[0]||'',
      responseType: rtype, responseBody: rb,
      statusCode: r.statusCode||'', delay: 0,
    };
  });
  return {
    id:   rq.id||('rule_'+Date.now()+'_'+Math.random().toString(36).slice(2,6)),
    name: rq.name||'Imported Rule',
    enabled: rq.status!=='Inactive',
    resourceType: rt,
    description: rq.description||'',
    pairs,
  };
}

document.getElementById('popup-search')?.addEventListener('input', () => renderRules());

// Auto-refresh when rules change from any context (dashboard, another popup)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'RULES_CHANGED') refresh();
});

refresh();
