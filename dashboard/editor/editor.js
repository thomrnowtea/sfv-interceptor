let cmEditors = {};

export function initCodeMirror() { return !!window.CM6; }

export function mountEditor(textareaId, code, onChange) {
  const textarea = document.getElementById(textareaId);
  if (!textarea) return null;

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
    '&': { background: 'var(--cm-editor)', color: 'var(--cm-text)', height: 'auto' },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: '12.5px', lineHeight: '1.65',
      minHeight: '200px', maxHeight: '500px', overflow: 'auto',
    },
    '.cm-content':  { padding: '12px 0', caretColor: 'var(--accent)' },
    '.cm-line':     { padding: '0 14px' },
    '.cm-gutters':  { background: 'var(--cm-gutter)', borderRight: '1px solid var(--cm-border)', color: 'var(--cm-gutter-text)', paddingRight: '4px' },
    '.cm-gutterElement': { minWidth: '28px' },
    '.cm-activeLineGutter': { background: 'var(--accent-dim)', color: 'var(--accent)' },
    '.cm-activeLine': { background: 'var(--accent-dim)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'var(--accent-dim2)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '.cm-matchingBracket': { background: 'var(--accent-dim)', outline: '1px solid var(--accent-dim2)' },
    '.cm-tooltip': { background: 'var(--cm-toolbar)', border: '1px solid var(--cm-border)', borderRadius: '6px', color: 'var(--cm-text)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--accent)', color: 'var(--accent-text)' },
    '.tok-keyword':      { color: '#ff7b72' },
    '.tok-definition.tok-variableName': { color: '#d2a8ff' },
    '.tok-definition.tok-function': { color: '#d2a8ff' },
    '.tok-variableName': { color: '#e6edf3' },
    '.tok-string':       { color: '#a5d6ff' },
    '.tok-string2':      { color: '#a5d6ff' },
    '.tok-number':       { color: '#f2cc60' },
    '.tok-comment':      { color: '#8b949e', fontStyle: 'italic' },
    '.tok-operator':     { color: '#ff7b72' },
    '.tok-punctuation':  { color: 'var(--cm-text)' },
    '.tok-propertyName': { color: '#79c0ff' },
    '.tok-atom':         { color: '#79c0ff' },
    '.tok-bool':         { color: '#79c0ff' },
    '.tok-null':         { color: '#79c0ff' },
    '.tok-typeName':     { color: '#ffa657' },
    '.tok-className':    { color: '#ffa657' },
    '.tok-self':         { color: '#ffa657' },
    '.tok-regexp':       { color: '#a5d6ff' },
  }, { dark: true });

  const edState = EditorState.create({
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
      keymap.of([
        ...defaultKeymap, ...historyKeymap, indentWithTab,
        {
          key: 'Alt-Shift-f',
          run(view) {
            const code      = view.state.doc.toString();
            const formatted = formatJS(code);
            if (formatted === code) return true;
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } });
            return true;
          },
        },
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          textarea.value = update.state.doc.toString();
          if (onChange) onChange();
        }
      }),
      theme,
    ],
  });

  const view = new EditorView({ state: edState, parent: wrap });
  cmEditors[textareaId] = view;
  return view;
}

export function formatJS(code) {
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
      let j = i;
      while (j < code.length && /\s/.test(code[j])) j++;
      if (code[j] === ')' || code[j] === ']' || code[j] === '}') { /* keep inline */ }
      continue;
    }
    if (/\s/.test(ch)) {
      const trimmed = out.trimEnd();
      if (trimmed.endsWith('\n') || out === '') {
        // skip leading whitespace (indent managed explicitly)
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

export function getEditorValue(id) {
  return cmEditors[id]?.state.doc.toString() ?? document.getElementById(id)?.value ?? '';
}

export function setEditorValue(id, code) {
  const cm = cmEditors[id];
  if (cm) {
    cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: code } });
  } else {
    const el = document.getElementById(id);
    if (el) el.value = code;
  }
}

export function destroyEditors() {
  Object.values(cmEditors).forEach(v => { try { v.destroy(); } catch {} });
  cmEditors = {};
}
