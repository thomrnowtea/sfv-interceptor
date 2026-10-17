const parsers = { javascript: 'babel', json: 'json', html: 'html', css: 'css' };
let runtime;

function loadPrettier() {
  if (!runtime) {
    runtime = Promise.all([
      import('../../shared/vendor/prettier/standalone.mjs'),
      import('../../shared/vendor/prettier/plugins/babel.mjs'),
      import('../../shared/vendor/prettier/plugins/estree.mjs'),
      import('../../shared/vendor/prettier/plugins/html.mjs'),
      import('../../shared/vendor/prettier/plugins/postcss.mjs'),
    ]).then(([prettier, ...plugins]) => ({ prettier, plugins }));
  }
  return runtime;
}

export function bodyLanguage(id, { resourceType, resourceSubtype }) {
  if (id === 'f-body-dynamic' || id === 'f-req-modifier') return 'javascript';
  if (id === 'f-req-body-static' || resourceType !== 'html') return 'json';
  return { js: 'javascript', css: 'css', html: 'html' }[resourceSubtype] || 'html';
}

export async function formatCode(code, { language = 'javascript', cursorOffset = 0 } = {}) {
  const parser = parsers[language];
  if (!parser) throw new Error(`Unsupported formatting language: ${language}`);
  if (!code.trim()) return { formatted: code, cursorOffset };
  // Raw API bodies may be plain text. Never reinterpret them as JavaScript.
  if (language === 'json' && code.trim()) JSON.parse(code);
  const { prettier, plugins } = await loadPrettier();
  return prettier.formatWithCursor(code, {
    parser,
    plugins,
    cursorOffset,
    tabWidth: 2,
    useTabs: false,
    printWidth: 80,
    endOfLine: 'lf',
  });
}

export async function formatSelection(code, { language, cursorOffset, anchorOffset = cursorOffset }) {
  const result = await formatCode(code, { language, cursorOffset });
  if (anchorOffset === cursorOffset) return { ...result, anchorOffset: result.cursorOffset };
  const anchor = await formatCode(code, { language, cursorOffset: anchorOffset });
  if (anchor.formatted !== result.formatted) throw new Error('Could not preserve the selection');
  return { ...result, anchorOffset: anchor.cursorOffset };
}

export async function formatJS(code) {
  return (await formatCode(code)).formatted;
}
