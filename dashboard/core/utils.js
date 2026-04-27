export async function msg(d) { return chrome.runtime.sendMessage(d); }

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function showToast(text, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2800);
}
