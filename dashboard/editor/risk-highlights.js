// Keep decorations out of both the source document and CodeMirror's undo history.
// The legacy CodeMirror bundle does not expose Decoration; Chrome's native text
// highlights let us mark its rendered ranges without wrapping or rewriting nodes.
const editors = new Map();
const names = { 1: 'sfvi-risk-medium', 2: 'sfvi-risk-high', 3: 'sfvi-risk-critical' };
let pendingFrame = 0;

export function supportsRiskHighlights() {
  return Boolean(globalThis.CSS?.highlights && globalThis.Highlight);
}

function domRange(view, from, to) {
  const start = view.domAtPos(from), end = view.domAtPos(to);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function visibleRiskRanges({ view, doc, risks }, severity) {
  if (view.state.doc !== doc || !view.dom.isConnected) return [];
  const ranges = [];
  for (const risk of risks.filter(item => item.sev === severity)) {
    for (const finding of risk.ranges) {
      for (const visible of view.visibleRanges) {
        const from = Math.max(finding.from, visible.from), to = Math.min(finding.to, visible.to);
        if (from < to) ranges.push(domRange(view, from, to));
      }
    }
  }
  return ranges;
}

function paintHighlights() {
  pendingFrame = 0;
  if (!supportsRiskHighlights()) return;
  for (const severity of [1, 2, 3]) {
    const highlight = new Highlight();
    highlight.priority = severity;
    for (const editor of editors.values()) {
      for (const range of visibleRiskRanges(editor, severity)) highlight.add(range);
    }
    CSS.highlights.set(names[severity], highlight);
  }
}

export function refreshRiskHighlights() {
  if (!pendingFrame && supportsRiskHighlights()) pendingFrame = requestAnimationFrame(paintHighlights);
}

export function registerRiskEditor(id, view) {
  editors.set(id, { view, doc: null, risks: [] });
  refreshRiskHighlights();
}

export function setEditorRisks(id, source, risks) {
  const editor = editors.get(id);
  if (!editor) return;
  editor.doc = editor.view.state.doc;
  editor.risks = editor.doc.toString() === source ? risks : [];
  refreshRiskHighlights();
}

export function focusRiskRange(id, source, finding) {
  const editor = editors.get(id);
  const textarea = document.getElementById(id);
  if (!textarea || textarea.value !== source) return false;
  if (editor) {
    editor.view.focus();
    editor.view.dispatch({ selection: { anchor: finding.from, head: finding.to }, scrollIntoView: true });
  } else {
    textarea.focus();
    textarea.setSelectionRange(finding.from, finding.to);
  }
  return true;
}

export function clearRiskHighlights() {
  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  pendingFrame = 0;
  editors.clear();
  if (!supportsRiskHighlights()) return;
  for (const name of Object.values(names)) CSS.highlights.delete(name);
}
