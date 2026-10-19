import { themedHighlightStyle } from './highlight.js';
import { formatSelection } from './formatter.js';
import { showToast } from '../core/utils.js';
import { registerRiskEditor, refreshRiskHighlights, clearRiskHighlights } from './risk-highlights.js';

let cmEditors = {};
const formatting = new WeakSet();
const fallbackEditors = new WeakMap();
const editorValues = new WeakMap();
const PRESENTATION_EVENT = 'format.presentation';

function rememberPresentation(value, visible, backing) {
  value.presentations.set(visible, backing);
}

function editorChanged(textarea, visible, onChange) {
  const value = editorValues.get(textarea);
  value.revision++;
  value.backing = value.presentations.get(visible) ?? visible;
  textarea.value = visible;
  onChange?.();
}

export function initCodeMirror() { return !!window.CM6; }

export function mountEditor(textareaId, code, onChange, {
  readOnly = false, getLanguage = () => 'javascript', contextVersion = () => 0, onVisibleChange,
} = {}) {
  const textarea = document.getElementById(textareaId);
  if (!textarea) return null;

  textarea.value = code;
  textarea.readOnly = readOnly;
  editorValues.set(textarea, { backing: code, revision: 0, presentations: new Map([[code, code]]), onVisibleChange });

  const presentInitialCode = () => {
    void formatEditor(textareaId, { language: getLanguage(), contextVersion, automatic: true });
  };

  if (!window.CM6) {
    textarea.style.display = '';
    const fallback = { revision: 0 };
    fallbackEditors.set(textarea, fallback);
    textarea.addEventListener('input', () => {
      fallback.revision++;
      editorChanged(textarea, textarea.value, onChange);
      onVisibleChange?.();
    });
    presentInitialCode();
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
      fontFamily: 'var(--mono)',
      fontSize: '12.5px', lineHeight: '1.65',
      minHeight: '200px', maxHeight: '500px', overflow: 'auto',
    },
    '.cm-content':  { padding: '12px 0', caretColor: 'var(--accent)' },
    '.cm-line':     { padding: '0 14px' },
    '.cm-gutters':  { background: 'var(--cm-gutter)', borderRight: '1px solid var(--cm-border)', color: 'var(--cm-gutter-text)', paddingRight: '4px' },
    '.cm-gutterElement': { minWidth: '28px' },
    '.cm-activeLineGutter': { background: 'var(--accent-dim)', color: 'var(--accent-link)' },
    '.cm-activeLine': { background: 'var(--accent-dim)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'var(--accent-dim2)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '.cm-matchingBracket': { background: 'var(--accent-dim)', outline: '1px solid var(--accent-dim2)' },
    '.cm-tooltip': { background: 'var(--cm-toolbar)', border: '1px solid var(--cm-border)', borderRadius: '6px', color: 'var(--cm-text)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--accent-action)', color: 'var(--accent-text)' },
  }, { dark: true });

  const edState = EditorState.create({
    doc: code,
    extensions: [
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.contentAttributes.of({ 'aria-label': textarea.getAttribute('aria-label') || 'Code editor', tabindex: '0', ...(readOnly ? { 'aria-readonly': 'true' } : {}) }),
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      autocompletion(),
      foldGutter(),
      history(),
      syntaxHighlighting(themedHighlightStyle(defaultHighlightStyle)),
      javascript(),
      keymap.of([
        ...defaultKeymap, ...historyKeymap, indentWithTab,
        {
          key: 'Alt-Shift-f',
          run() {
            if (readOnly) return false;
            void formatEditor(textareaId, { language: getLanguage(), contextVersion });
            return true;
          },
        },
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          const visible = update.state.doc.toString();
          if (update.transactions.every(transaction => transaction.isUserEvent(PRESENTATION_EVENT))) textarea.value = visible;
          else editorChanged(textarea, visible, onChange);
          onVisibleChange?.();
        }
        if (update.docChanged || update.viewportChanged) refreshRiskHighlights();
      }),
      theme,
    ],
  });

  const view = new EditorView({ state: edState, parent: wrap });
  cmEditors[textareaId] = view;
  registerRiskEditor(textareaId, view);
  presentInitialCode();
  return view;
}

function captureEditor(id, allowReadOnly = false) {
  const textarea = document.getElementById(id);
  if (!textarea || (textarea.readOnly && !allowReadOnly)) return null;
  const value = editorValues.get(textarea);
  const view = cmEditors[id];
  if (view) return { id, textarea, view, target: view, doc: view.state.doc, selection: view.state.selection, value, revision: value.revision,
    code: view.state.doc.toString(), cursorOffset: view.state.selection.main.head,
    anchorOffset: view.state.selection.main.anchor };
  return { id, textarea, target: textarea, value, code: textarea.value,
    cursorOffset: textarea.selectionEnd, anchorOffset: textarea.selectionStart,
    selectionDirection: textarea.selectionDirection, revision: fallbackEditors.get(textarea)?.revision };
}

function sameViewState(snapshot) {
  return snapshot.value.revision === snapshot.revision && cmEditors[snapshot.id] === snapshot.view && snapshot.view.state.doc === snapshot.doc
    && snapshot.view.state.selection === snapshot.selection;
}

function sameTextareaState(snapshot) {
  return fallbackEditors.get(snapshot.textarea)?.revision === snapshot.revision
    && snapshot.textarea.value === snapshot.code && snapshot.textarea.selectionStart === snapshot.anchorOffset
    && snapshot.textarea.selectionEnd === snapshot.cursorOffset && snapshot.textarea.selectionDirection === snapshot.selectionDirection;
}

function isCurrentEditor(snapshot, allowReadOnly = false) {
  if (document.getElementById(snapshot.id) !== snapshot.textarea) return false;
  if (snapshot.textarea.readOnly && !allowReadOnly) return false;
  return snapshot.view ? sameViewState(snapshot) : sameTextareaState(snapshot);
}

function applyFormat(snapshot, result, automatic) {
  rememberPresentation(snapshot.value, snapshot.code, snapshot.value.backing);
  rememberPresentation(snapshot.value, result.formatted, snapshot.value.backing);
  if (snapshot.view) {
    const { scrollTop, scrollLeft } = snapshot.view.scrollDOM;
    // Transaction is part of the bundled EditorState runtime, but not re-exported
    // by this legacy bundle. Keep automatic presentation out of undo history.
    const Transaction = snapshot.view.state.update({}).constructor;
    snapshot.view.dispatch({ changes: { from: 0, to: snapshot.doc.length, insert: result.formatted },
      selection: { anchor: result.anchorOffset, head: result.cursorOffset }, userEvent: PRESENTATION_EVENT,
      annotations: Transaction.addToHistory.of(!automatic) });
    snapshot.view.scrollDOM.scrollTop = scrollTop;
    snapshot.view.scrollDOM.scrollLeft = scrollLeft;
    return;
  }
  const { scrollTop, scrollLeft } = snapshot.textarea;
  snapshot.textarea.value = result.formatted;
  snapshot.textarea.setSelectionRange(result.anchorOffset, result.cursorOffset, snapshot.selectionDirection);
  snapshot.textarea.scrollTop = scrollTop;
  snapshot.textarea.scrollLeft = scrollLeft;
  snapshot.value.onVisibleChange?.();
}

function setFormatButtonBusy(button, snapshot, busy) {
  if (button?.isConnected) button.disabled = busy || snapshot.textarea.readOnly;
}

function reportFormatError(snapshot, contextVersion, version, error) {
  if (contextVersion() === version && isCurrentEditor(snapshot)) {
    showToast(`Format failed: ${error.message.split('\n')[0]}`, true);
  }
}

function canApplyFormat(snapshot, result, contextVersion, version, automatic) {
  return contextVersion() === version && isCurrentEditor(snapshot, automatic) && result.formatted !== snapshot.code;
}

async function runFormat(snapshot, { language, contextVersion, automatic }) {
  const version = contextVersion();
  try {
    const result = await formatSelection(snapshot.code, { language, cursorOffset: snapshot.cursorOffset, anchorOffset: snapshot.anchorOffset });
    if (!canApplyFormat(snapshot, result, contextVersion, version, automatic)) return false;
    applyFormat(snapshot, result, automatic);
    return true;
  } catch (error) {
    if (!automatic) reportFormatError(snapshot, contextVersion, version, error);
    return false;
  }
}

export async function formatEditor(id, { language = 'javascript', contextVersion = () => 0, button, automatic = false } = {}) {
  const snapshot = captureEditor(id, automatic);
  if (!snapshot || formatting.has(snapshot.target)) return false;
  formatting.add(snapshot.target);
  setFormatButtonBusy(button, snapshot, true);
  try {
    return await runFormat(snapshot, { language, contextVersion, automatic });
  } finally {
    formatting.delete(snapshot.target);
    setFormatButtonBusy(button, snapshot, false);
  }
}

export function getEditorValue(id) {
  const textarea = document.getElementById(id);
  return editorValues.get(textarea)?.backing ?? textarea?.value ?? '';
}

export function setEditorValue(id, code) {
  const cm = cmEditors[id];
  if (cm) {
    cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: code } });
  } else {
    const el = document.getElementById(id);
    if (el) { el.value = code; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }
}

export function destroyEditors() {
  clearRiskHighlights();
  Object.values(cmEditors).forEach(v => { try { v.destroy(); } catch {} });
  cmEditors = {};
}
