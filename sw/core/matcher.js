function escapeRegex(value) {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
}

function wildcardRegex(value) {
  return '^' + value.split('*').map(escapeRegex).join('.*') + '$';
}

export function urlMatchesPair(url, pair) {
  const pattern = pair.urlPattern || '';
  const operator = pair.urlOperator || 'Contains';
  if (!pattern) return false;
  const candidate = normalizedCase(url, pair.caseSensitive);
  const normalized = normalizedCase(pattern, pair.caseSensitive);
  if (operator === 'Equals') return candidate === normalized;
  if (operator === 'Contains') return candidate.includes(normalized);
  const expression = operator === 'Regex' ? pattern : wildcardRegex(pattern);
  return testRegex(expression, url, pair.caseSensitive);
}

function normalizedCase(value, caseSensitive) {
  return caseSensitive ? value : value.toLowerCase();
}

function testRegex(expression, url, caseSensitive) {
  try { return new RegExp(expression, caseSensitive ? '' : 'i').test(url); }
  catch { return false; }
}

export function pairToRegexFilter(pair) {
  const pattern = pair.urlPattern || '';
  const operator = pair.urlOperator || 'Contains';
  if (!pattern) return null;
  if (operator === 'Regex') return pattern;
  if (operator === 'Equals') return '^' + escapeRegex(pattern) + '$';
  if (operator === 'Wildcard') return wildcardRegex(pattern);
  return escapeRegex(pattern);
}
