import { updateRiskBar } from '../core/security.js';

const _TV = {
  '--t-rest-c':'#34d399','--t-rest-bg':'rgba(52,211,153,0.12)', '--t-rest-bd':'rgba(52,211,153,0.25)',
  '--t-gql-c': '#fb7185','--t-gql-bg': 'rgba(251,113,133,0.12)','--t-gql-bd': 'rgba(251,113,133,0.25)',
  '--t-html-c':'#5b73ff','--t-html-bg':'rgba(91,115,255,0.14)', '--t-html-bd':'rgba(91,115,255,0.25)',
  '--t-js-c':  '#fbbf24','--t-js-bg':  'rgba(251,191,36,0.12)', '--t-js-bd':  'rgba(251,191,36,0.30)',
  '--t-css-c': '#a78bfa','--t-css-bg': 'rgba(167,139,250,0.12)','--t-css-bd': 'rgba(167,139,250,0.30)',
  '--cm-toolbar':'#12141c','--cm-border':'#252838','--cm-editor':'#12141c','--cm-gutter':'#0e1018','--cm-text':'#cdd9e5','--cm-gutter-text':'#3a3f58',
};
const _LTV = {
  '--t-rest-c':'#047857','--t-rest-bg':'rgba(4,120,87,0.12)',    '--t-rest-bd':'rgba(4,120,87,0.30)',
  '--t-gql-c': '#be123c','--t-gql-bg': 'rgba(190,18,60,0.10)',   '--t-gql-bd': 'rgba(190,18,60,0.28)',
  '--t-html-c':'#3451c7','--t-html-bg':'rgba(52,81,199,0.12)',   '--t-html-bd':'rgba(52,81,199,0.30)',
  '--t-js-c':  '#92400e','--t-js-bg':  'rgba(146,64,14,0.13)',   '--t-js-bd':  'rgba(146,64,14,0.32)',
  '--t-css-c': '#6d28d9','--t-css-bg': 'rgba(109,40,217,0.11)',  '--t-css-bd': 'rgba(109,40,217,0.28)',
  '--cm-toolbar':'#e8eaf6','--cm-border':'#c8cce0','--cm-editor':'#f8f9fc','--cm-gutter':'#eef0f8','--cm-text':'#24292f','--cm-gutter-text':'#8c959f',
};

const THEME_DEFS = {
  default: {
    label: 'Default',
    vars: {
      '--bg':'#0f1117','--sidebar':'#141519','--surface':'#1c1e26',
      '--surface2':'#22252f','--surface3':'#292c38',
      '--border':'#2a2d3e','--border2':'#363b52',
      '--accent':'#5b73ff','--accent-h':'#4a60f0',
      '--accent-dim':'rgba(91,115,255,0.14)','--accent-dim2':'rgba(91,115,255,0.28)',
      '--accent-text':'#fff',
      '--text':'#e2e4f0','--text2':'#c0c4d8','--text3':'#8890aa','--muted':'#575d7a',
      ..._TV,
    },
  },
  light: {
    label: 'Light',
    vars: {
      '--bg':'#f0f2f8','--sidebar':'#e6e9f4','--surface':'#ffffff',
      '--surface2':'#f4f5fb','--surface3':'#eceef8',
      '--border':'#d4d8ec','--border2':'#bec4dc',
      '--accent':'#5b73ff','--accent-h':'#4a60f0',
      '--accent-dim':'rgba(91,115,255,0.10)','--accent-dim2':'rgba(91,115,255,0.20)',
      '--accent-text':'#fff',
      '--text':'#1a1d2e','--text2':'#3a4060','--text3':'#6068a0','--muted':'#9099c0',
      ..._LTV,
    },
  },
  neon: {
    label: 'Neon',
    vars: {
      '--bg':'#050907','--sidebar':'#0a0f0d','--surface':'#0f1510',
      '--surface2':'#141c15','--surface3':'#18231a',
      '--border':'#1c2b1e','--border2':'#243428',
      '--accent':'#39ff82','--accent-h':'#20e86a',
      '--accent-dim':'rgba(57,255,130,0.12)','--accent-dim2':'rgba(57,255,130,0.25)',
      '--accent-text':'#000',
      '--text':'#c6ffd8','--text2':'#7ecb92','--text3':'#488858','--muted':'#285034',
      ..._TV,
      '--cm-toolbar':'#0e1710','--cm-border':'#1a2e1c','--cm-editor':'#0b130c','--cm-gutter':'#080e09',
      '--cm-text':'#9dc8a8','--cm-gutter-text':'#2a4a2e',
    },
  },
  pink: {
    label: 'Pink',
    vars: {
      '--bg':'#0f1117','--sidebar':'#141519','--surface':'#1c1e26',
      '--surface2':'#22252f','--surface3':'#292c38',
      '--border':'#2a2d3e','--border2':'#363b52',
      '--accent':'#bb66a7','--accent-h':'#a84f96',
      '--accent-dim':'rgba(187,102,167,0.14)','--accent-dim2':'rgba(187,102,167,0.28)',
      '--accent-text':'#fff',
      '--text':'#e2e4f0','--text2':'#c0c4d8','--text3':'#8890aa','--muted':'#575d7a',
      ..._TV,
      '--cm-toolbar':'#131118','--cm-border':'#231e30','--cm-editor':'#110f1a','--cm-gutter':'#0d0c14',
      '--cm-text':'#ccc0d8','--cm-gutter-text':'#3d3450',
    },
  },
  red: {
    label: 'Red',
    vars: {
      '--bg':'#110d0d','--sidebar':'#160f0f','--surface':'#1e1515',
      '--surface2':'#251a1a','--surface3':'#2d2020',
      '--border':'#3a2424','--border2':'#4c2e2e',
      '--accent':'#ff4d6d','--accent-h':'#e53557',
      '--accent-dim':'rgba(255,77,109,0.14)','--accent-dim2':'rgba(255,77,109,0.28)',
      '--accent-text':'#fff',
      '--text':'#f0dfe2','--text2':'#d0acb0','--text3':'#a07278','--muted':'#6a4448',
      ..._TV,
      '--cm-toolbar':'#170f0f','--cm-border':'#2e1a1a','--cm-editor':'#130e0e','--cm-gutter':'#0f0a0a',
      '--cm-text':'#cbb5b5','--cm-gutter-text':'#402424',
    },
  },
  custom: { label: 'Custom', vars: null },
};

const SWATCH_META = {
  default: ['#141519','#0f1117','#5b73ff'],
  light:   ['#e6e9f4','#f0f2f8','#5b73ff'],
  neon:    ['#0a0f0d','#050907','#39ff82'],
  pink:    ['#141519','#0f1117','#bb66a7'],
  red:     ['#160f0f','#110d0d','#ff4d6d'],
  custom:  ['#22252f','#0f1117','#888888'],
};

const PALETTE_COLORS = [
  '#5b73ff','#4a9eff','#22d3ee','#06b6d4',
  '#39ff82','#34d399','#84cc16','#a3e635',
  '#a78bfa','#bb66a7','#f472b6','#ec4899',
  '#ff4d6d','#fb923c','#fbbf24','#f97316',
];

export const themeState = {
  current: 'default',
  custom:  { bg: '#0f1117', accent: '#5b73ff', surface: '#1c1e26' },
};

function _hexShift(hex, amt) {
  const clamp = n => Math.min(255, Math.max(0, n));
  const r = clamp(parseInt(hex.slice(1,3), 16) + amt);
  const g = clamp(parseInt(hex.slice(3,5), 16) + amt);
  const b = clamp(parseInt(hex.slice(5,7), 16) + amt);
  return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
}
function _hexRgba(hex, a) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function buildCustomVars(bgHex, accentHex, surfaceHex) {
  const r = parseInt(bgHex.slice(1,3), 16);
  const g = parseInt(bgHex.slice(3,5), 16);
  const b = parseInt(bgHex.slice(5,7), 16);
  const ar = parseInt(accentHex.slice(1,3), 16);
  const ag = parseInt(accentHex.slice(3,5), 16);
  const ab = parseInt(accentHex.slice(5,7), 16);
  const isDark   = (0.299*r  + 0.587*g  + 0.114*b)  / 255 < 0.5;
  const acBright = (0.299*ar + 0.587*ag + 0.114*ab) / 255 > 0.6;
  const step = isDark ? 7 : -7;
  const typeVars = isDark ? _TV : _LTV;
  return {
    '--bg':          bgHex,
    '--sidebar':     _hexShift(bgHex, step),
    '--surface':     surfaceHex,
    '--surface2':    _hexShift(surfaceHex, step),
    '--surface3':    _hexShift(surfaceHex, step * 2),
    '--border':      _hexShift(bgHex, step * 4),
    '--border2':     _hexShift(bgHex, step * 6),
    '--accent':      accentHex,
    '--accent-h':    _hexShift(accentHex, -20),
    '--accent-dim':  _hexRgba(accentHex, 0.14),
    '--accent-dim2': _hexRgba(accentHex, 0.28),
    '--accent-text': acBright ? '#000' : '#fff',
    '--text':        isDark ? '#e2e4f0' : '#1a1d2e',
    '--text2':       isDark ? '#c0c4d8' : '#3a4060',
    '--text3':       isDark ? '#8890aa' : '#6068a0',
    '--muted':       isDark ? '#575d7a' : '#9099c0',
    ...typeVars,
    // CM editor vars derived from actual bg — not inherited from _TV/_LTV defaults
    '--cm-editor':      isDark ? _hexShift(bgHex, -2)  : bgHex,
    '--cm-toolbar':     isDark ? _hexShift(bgHex,  2)  : _hexShift(bgHex, -8),
    '--cm-gutter':      isDark ? _hexShift(bgHex, -5)  : _hexShift(bgHex, -12),
    '--cm-border':      isDark ? _hexShift(bgHex,  14) : _hexShift(bgHex, -22),
    '--cm-text':        isDark ? '#cdd9e5' : '#24292f',
    '--cm-gutter-text': isDark ? _hexShift(bgHex, 40)  : _hexShift(bgHex, -60),
  };
}

function _schemeOf(vars) {
  const bg = vars?.['--bg'];
  if (!bg?.startsWith('#') || bg.length < 7) return 'dark';
  const r = parseInt(bg.slice(1,3), 16);
  const g = parseInt(bg.slice(3,5), 16);
  const b = parseInt(bg.slice(5,7), 16);
  return (0.299*r + 0.587*g + 0.114*b) / 255 > 0.5 ? 'light' : 'dark';
}

export function applyTheme(themeId, overrideVars) {
  const v = overrideVars || THEME_DEFS[themeId]?.vars;
  if (!v) return;
  const root = document.documentElement;
  Object.entries(v).forEach(([k, val]) => root.style.setProperty(k, val));
  root.setAttribute('data-theme', themeId);
  root.setAttribute('data-scheme', _schemeOf(v));
  themeState.current = themeId;
  document.querySelectorAll('.theme-swatch').forEach(s =>
    s.classList.toggle('active', s.dataset.theme === themeId)
  );
  const cs = document.getElementById('theme-custom-section');
  if (cs) cs.style.display = themeId === 'custom' ? '' : 'none';
  const save = { sfvi_theme: themeId, sfvi_theme_vars: v };
  if (themeId === 'custom') save.sfvi_theme_custom = themeState.custom;
  chrome.storage.local.set(save);
  updateRiskBar();
}

function buildThemePanel() {
  const swatchWrap = document.getElementById('theme-swatches');
  if (!swatchWrap) return;

  swatchWrap.innerHTML = Object.keys(THEME_DEFS).map(id => {
    const [sc, bg, ac] = SWATCH_META[id];
    return `
      <button class="theme-swatch${themeState.current === id ? ' active' : ''}" data-theme="${id}">
        <div class="swatch-preview">
          <div class="sp-side" style="background:${sc}"></div>
          <div class="sp-body" style="background:${bg}">
            <div class="sp-bar"  style="background:${ac}"></div>
            <div class="sp-bar2" style="background:${ac}"></div>
          </div>
        </div>
        <span class="swatch-name">${THEME_DEFS[id].label}</span>
      </button>`;
  }).join('');

  const palette = document.getElementById('theme-palette');
  if (palette) {
    palette.innerHTML = PALETTE_COLORS.map(c =>
      `<div class="palette-dot${themeState.custom.accent === c ? ' active' : ''}"
           style="background:${c}" data-color="${c}" title="${c}"></div>`
    ).join('');
    palette.querySelectorAll('.palette-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        themeState.custom.accent = dot.dataset.color;
        const picker = document.getElementById('tc-accent');
        if (picker) picker.value = dot.dataset.color;
        palette.querySelectorAll('.palette-dot').forEach(d =>
          d.classList.toggle('active', d.dataset.color === dot.dataset.color)
        );
        if (themeState.current === 'custom') {
          applyTheme('custom', buildCustomVars(themeState.custom.bg, themeState.custom.accent, themeState.custom.surface));
        }
      });
    });
  }

  swatchWrap.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.theme;
      if (id === 'custom') {
        const pickerBg  = document.getElementById('tc-bg');
        const pickerAcc = document.getElementById('tc-accent');
        const pickerSur = document.getElementById('tc-surface');
        if (pickerBg)  pickerBg.value  = themeState.custom.bg;
        if (pickerAcc) pickerAcc.value = themeState.custom.accent;
        if (pickerSur) pickerSur.value = themeState.custom.surface;
        applyTheme('custom', buildCustomVars(themeState.custom.bg, themeState.custom.accent, themeState.custom.surface));
      } else {
        applyTheme(id);
      }
    });
  });
}

export function openThemePanel() {
  const panel = document.getElementById('theme-panel');
  const btn   = document.getElementById('btn-theme');
  if (!panel || !btn) return;
  buildThemePanel();
  const rect = btn.getBoundingClientRect();
  let left = rect.left;
  let top  = rect.bottom + 6;
  const panelW = 222, panelH = 280;
  if (left + panelW > window.innerWidth  - 8) left = window.innerWidth  - panelW - 8;
  if (top  + panelH > window.innerHeight - 8) top  = rect.top - panelH - 6;
  panel.style.left    = left + 'px';
  panel.style.top     = top  + 'px';
  panel.style.display = '';
  panel.classList.add('open');
  btn.classList.add('active');
  const cs = document.getElementById('theme-custom-section');
  if (cs) cs.style.display = themeState.current === 'custom' ? '' : 'none';
}

export function closeThemePanel() {
  const panel = document.getElementById('theme-panel');
  if (panel) { panel.style.display = 'none'; panel.classList.remove('open'); }
  document.getElementById('btn-theme')?.classList.remove('active');
}

export function initTheme() {
  document.getElementById('btn-theme')?.addEventListener('click', e => {
    e.stopPropagation();
    const panel = document.getElementById('theme-panel');
    panel?.style.display === 'none' || !panel?.style.display
      ? openThemePanel()
      : closeThemePanel();
  });

  document.getElementById('theme-panel-close')?.addEventListener('click', closeThemePanel);

  document.addEventListener('click', e => {
    const panel = document.getElementById('theme-panel');
    const btn   = document.getElementById('btn-theme');
    if (panel && panel.style.display !== 'none'
        && !panel.contains(e.target) && e.target !== btn) {
      closeThemePanel();
    }
  });

  ['tc-bg', 'tc-accent', 'tc-surface'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', e => {
      const key = { 'tc-bg': 'bg', 'tc-accent': 'accent', 'tc-surface': 'surface' }[id];
      themeState.custom[key] = e.target.value;
      SWATCH_META.custom = [_hexShift(themeState.custom.bg, 7), themeState.custom.bg, themeState.custom.accent];
      applyTheme('custom', buildCustomVars(themeState.custom.bg, themeState.custom.accent, themeState.custom.surface));
      document.querySelectorAll('.palette-dot').forEach(d =>
        d.classList.toggle('active', d.dataset.color === themeState.custom.accent)
      );
    });
  });
}
