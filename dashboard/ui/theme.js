export { buildCustomVars } from '../../shared/themes.js';
import { updateRiskBar } from '../core/security.js';

import { THEME_DEFS, completeTheme, buildCustomVars, shiftHexColor as _hexShift } from '../../shared/themes.js';

const SWATCH_META = {
  default: ['#141519','#0f1117','#5b73ff'],
  light:   ['#ededf0','#f5f5f7','#0066cc'],
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

function _schemeOf(vars) {
  const bg = vars?.['--bg'];
  if (!bg?.startsWith('#') || bg.length < 7) return 'dark';
  const r = parseInt(bg.slice(1,3), 16);
  const g = parseInt(bg.slice(3,5), 16);
  const b = parseInt(bg.slice(5,7), 16);
  return (0.299*r + 0.587*g + 0.114*b) / 255 > 0.5 ? 'light' : 'dark';
}

export function applyTheme(themeId, overrideVars) {
  const input = overrideVars || THEME_DEFS[themeId]?.vars;
  if (!input) return;
  const v = completeTheme(input);
  const root = document.documentElement;
  Object.entries(v).forEach(([k, val]) => root.style.setProperty(k, val));
  root.setAttribute('data-theme', themeId);
  root.setAttribute('data-scheme', _schemeOf(v));
  themeState.current = themeId;
  document.querySelectorAll('.theme-swatch').forEach(s => {
    const active = s.dataset.theme === themeId;
    s.classList.toggle('active', active);
    s.setAttribute('aria-pressed', String(active));
  });
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
      <button type="button" class="theme-swatch${themeState.current === id ? ' active' : ''}" data-theme="${id}" aria-pressed="${themeState.current === id}">
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
      `<button type="button" class="palette-dot${themeState.custom.accent === c ? ' active' : ''}"
           style="background:${c}" data-color="${c}" title="${c}" aria-label="Accent color ${c}" aria-pressed="${themeState.custom.accent === c}"></button>`
    ).join('');
    palette.querySelectorAll('.palette-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        themeState.custom.accent = dot.dataset.color;
        const picker = document.getElementById('tc-accent');
        if (picker) picker.value = dot.dataset.color;
        palette.querySelectorAll('.palette-dot').forEach(d => {
          const active = d.dataset.color === dot.dataset.color;
          d.classList.toggle('active', active);
          d.setAttribute('aria-pressed', String(active));
        });
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
  const panelW = 248, panelH = 320;
  if (left + panelW > window.innerWidth  - 8) left = window.innerWidth  - panelW - 8;
  if (top  + panelH > window.innerHeight - 8) top  = rect.top - panelH - 6;
  panel.style.left    = left + 'px';
  panel.style.top     = Math.max(8, top) + 'px';
  panel.style.display = '';
  panel.classList.add('open');
  btn.setAttribute('aria-expanded','true');
  panel.querySelector('button')?.focus({preventScroll:true});
  btn.classList.add('active');
  const cs = document.getElementById('theme-custom-section');
  if (cs) cs.style.display = themeState.current === 'custom' ? '' : 'none';
}

export function closeThemePanel() {
  const panel = document.getElementById('theme-panel');
  const restore = panel?.contains(document.activeElement);
  if (panel) { panel.style.display = 'none'; panel.classList.remove('open'); }
  const trigger=document.getElementById('btn-theme');
  trigger?.classList.remove('active');
  trigger?.setAttribute('aria-expanded','false');
  if(restore) trigger?.focus();
}

export function initTheme() {
  document.getElementById('btn-theme')?.addEventListener('click', e => {
    e.stopPropagation();
    const panel = document.getElementById('theme-panel');
    panel?.style.display === 'none'
      ? openThemePanel()
      : closeThemePanel();
  });

  document.getElementById('theme-panel-close')?.addEventListener('click', closeThemePanel);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeThemePanel();
  });

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
      document.querySelectorAll('.palette-dot').forEach(d => {
        const active = d.dataset.color === themeState.custom.accent;
        d.classList.toggle('active', active);
        d.setAttribute('aria-pressed', String(active));
      });
    });
  });
}
