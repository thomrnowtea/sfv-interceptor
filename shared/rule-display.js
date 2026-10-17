import { DEFAULT_VERSION, normalizeVersion } from './rule-schema.js';

const COLORS = { rest: '#22d3ee', graphql: '#fb7185', html: '#60a5fa', js: '#fbbf24', css: '#a78bfa' };

export function ruleColor(rule) {
  const type = rule.resourceType === 'html' ? (rule.resourceSubtype || 'html') : rule.resourceType;
  return COLORS[type] || COLORS.rest;
}

export function displayVersion(rule) {
  try { return normalizeVersion(rule?.version ?? DEFAULT_VERSION); }
  catch { return DEFAULT_VERSION; }
}

export function displayPatterns(rule) {
  if (rule.pairs?.length) return rule.pairs;
  return [{ urlPattern: rule.urlPattern || '' }];
}
