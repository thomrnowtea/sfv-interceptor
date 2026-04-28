export function urlMatchesPair(url, pair) {
  const pat = pair.urlPattern || '', op = pair.urlOperator || 'Contains';
  const cs  = pair.caseSensitive || false;
  if (!pat) return false;
  const u = cs ? url : url.toLowerCase();
  const p = cs ? pat : pat.toLowerCase();
  if (op === 'Equals')   return u === p;
  if (op === 'Contains') return u.includes(p);
  if (op === 'Regex')    { try { return new RegExp(pat, cs ? '' : 'i').test(url); } catch { return false; } }
  const re = '^' + p.replace(/[.+?^${}()|[\]\\-]/g, '\\$&').replace(/\*/g, '.*') + '$';
  try { return new RegExp(re).test(u); } catch { return false; }
}

export function pairToRegexFilter(pair) {
  const pat = pair.urlPattern || '', op = pair.urlOperator || 'Contains';
  if (!pat) return null;
  if (op === 'Regex')    return pat;
  const escapeNoStar = s => s.replace(/[.+?^${}()|[\]\\-]/g, '\\$&');
  if (op === 'Equals')   return '^' + escapeNoStar(pat) + '$';
  if (op === 'Wildcard') return escapeNoStar(pat).replace(/\*/g, '.*');
  return escapeNoStar(pat);
}
