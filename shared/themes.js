export const DARK_TYPE_VARS = {
  '--t-rest-c':'#22d3ee','--t-rest-bg':'rgba(34,211,238,0.12)', '--t-rest-bd':'rgba(34,211,238,0.25)',
  '--t-gql-c': '#fb7185','--t-gql-bg': 'rgba(251,113,133,0.12)','--t-gql-bd': 'rgba(251,113,133,0.25)',
  '--t-html-c':'#9cb7ff','--t-html-bg':'rgba(91,115,255,0.14)', '--t-html-bd':'rgba(91,115,255,0.25)',
  '--t-js-c':  '#fbbf24','--t-js-bg':  'rgba(251,191,36,0.12)', '--t-js-bd':  'rgba(251,191,36,0.30)',
  '--t-css-c': '#a78bfa','--t-css-bg': 'rgba(167,139,250,0.12)','--t-css-bd': 'rgba(167,139,250,0.30)',
  '--cm-toolbar':'#171923','--cm-border':'#2a2d3e','--cm-editor':'#12141c','--cm-gutter':'#0e1018','--cm-text':'#cdd9e5','--cm-gutter-text':'#939bb5',
};
export const LIGHT_TYPE_VARS = {
  // An opaque tint keeps small REST labels readable over selected rows.
  '--t-rest-c':'#0e7490','--t-rest-bg':'color-mix(in srgb, #0e7490 8%, var(--surface))', '--t-rest-bd':'rgba(14,116,144,0.12)',
  '--t-gql-c':'#8c254c','--t-gql-bg':'rgba(173,58,100,0.08)', '--t-gql-bd':'rgba(173,58,100,0.12)',
  '--t-html-c':'#0053a6','--t-html-bg':'rgba(0,102,204,0.08)', '--t-html-bd':'rgba(0,102,204,0.12)',
  '--t-js-c':'#735000','--t-js-bg':'rgba(150,100,0,0.08)', '--t-js-bd':'rgba(150,100,0,0.12)',
  '--t-css-c':'#60428f','--t-css-bg':'rgba(116,86,168,0.08)', '--t-css-bd':'rgba(116,86,168,0.12)',
  '--cm-toolbar':'#f1f1f3','--cm-border':'rgba(30,30,40,0.12)','--cm-editor':'#fbfbfc','--cm-gutter':'#f5f5f7','--cm-text':'#242429','--cm-gutter-text':'#67676c',
};

export const THEME_DEFS = {
  default: {
    label: 'Original',
    vars: {
      '--bg':'#0f1117','--sidebar':'#141519','--surface':'#1c1e26',
      '--surface2':'#22252f','--surface3':'#292c38',
      '--border':'#2a2d3e','--border2':'#363b52',
      '--accent':'#5b73ff','--accent-h':'#4a60f0','--accent-action':'#4a60dd','--accent-link':'#a4b2ff',
      '--accent-dim':'rgba(91,115,255,0.14)','--accent-dim2':'rgba(91,115,255,0.28)',
      '--accent-text':'#fff',
      '--text':'#e2e4f0','--text2':'#c0c4d8','--text3':'#939bb5','--muted':'#939bb5',
      ...DARK_TYPE_VARS,
    },
  },
  light: {
    label: 'Light',
    vars: {
      '--bg':'#f5f5f7','--sidebar':'#ededf0','--surface':'#fdfdfe',
      '--surface2':'#f1f1f3','--surface3':'#e7e7eb',
      '--border':'rgba(30,30,40,0.09)','--border2':'rgba(30,30,40,0.18)',
      '--accent':'#0066cc','--accent-h':'#0056b2','--accent-action':'#0066cc','--accent-link':'#005bb8',
      '--accent-dim':'rgba(0,102,204,0.08)','--accent-dim2':'rgba(0,102,204,0.17)',
      '--accent-text':'#fff',
      '--text':'#1d1d1f','--text2':'#424245','--text3':'#5c5c60','--muted':'#67676c',
      ...LIGHT_TYPE_VARS,
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
      ...DARK_TYPE_VARS,
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
      ...DARK_TYPE_VARS,
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
      ...DARK_TYPE_VARS,
      '--cm-toolbar':'#170f0f','--cm-border':'#2e1a1a','--cm-editor':'#130e0e','--cm-gutter':'#0f0a0a',
      '--cm-text':'#cbb5b5','--cm-gutter-text':'#402424',
    },
  },
  custom: { label: 'Custom', vars: null },
};

export function completeTheme(vars) {
  return { ...vars, '--accent-action': vars['--accent-action'] || vars['--accent'], '--accent-link': vars['--accent-link'] || vars['--accent'] };
}

export function resolveTheme(stored = {}) {
  const id = stored.sfvi_theme || 'default';
  if (id === 'custom' && stored.sfvi_theme_custom) {
    const {bg,accent,surface}=stored.sfvi_theme_custom;
    return completeTheme(buildCustomVars(bg,accent,surface));
  }
  return completeTheme(THEME_DEFS[id]?.vars || stored.sfvi_theme_vars || THEME_DEFS.default.vars);
}

function bestTextColor(hex) {
  const [r,g,b]=hex.match(/[a-f\d]{2}/gi).map(part=>parseInt(part,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  return .2126*r+.7152*g+.0722*b > .179 ? '#000' : '#fff';
}
export function shiftHexColor(hex, amt) {
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
  const isDark   = (0.299*r  + 0.587*g  + 0.114*b)  / 255 < 0.5;
  const step = isDark ? 7 : -7;
  const typeVars = isDark ? DARK_TYPE_VARS : LIGHT_TYPE_VARS;
  return {
    '--bg':          bgHex,
    '--sidebar':     shiftHexColor(bgHex, step),
    '--surface':     surfaceHex,
    '--surface2':    shiftHexColor(surfaceHex, step),
    '--surface3':    shiftHexColor(surfaceHex, step * 2),
    '--border':      shiftHexColor(bgHex, step * 4),
    '--border2':     shiftHexColor(bgHex, step * 6),
    '--accent':      accentHex,
    '--accent-h':    shiftHexColor(accentHex, -20),
    '--accent-action': accentHex,
    '--accent-link': accentHex,
    '--accent-dim':  _hexRgba(accentHex, 0.14),
    '--accent-dim2': _hexRgba(accentHex, 0.28),
    '--accent-text': bestTextColor(accentHex),
    '--text':        isDark ? '#e2e4f0' : '#1a1d2e',
    '--text2':       isDark ? '#c0c4d8' : '#3a4060',
    '--text3':       isDark ? '#8890aa' : '#6068a0',
    '--muted':       isDark ? '#575d7a' : '#9099c0',
    ...typeVars,
    ...codeEditorColors(bgHex, isDark),
  };
}


function codeEditorColors(bgHex, isDark) {
  return {
    // CM editor vars derived from actual bg — not inherited from DARK_TYPE_VARS/LIGHT_TYPE_VARS defaults
    '--cm-editor':      isDark ? shiftHexColor(bgHex, -2)  : bgHex,
    '--cm-toolbar':     isDark ? shiftHexColor(bgHex,  2)  : shiftHexColor(bgHex, -8),
    '--cm-gutter':      isDark ? shiftHexColor(bgHex, -5)  : shiftHexColor(bgHex, -12),
    '--cm-border':      isDark ? shiftHexColor(bgHex,  14) : shiftHexColor(bgHex, -22),
    '--cm-text':        isDark ? '#cdd9e5' : '#24292f',
    '--cm-gutter-text': isDark ? shiftHexColor(bgHex, 40)  : shiftHexColor(bgHex, -60),
  };
}
