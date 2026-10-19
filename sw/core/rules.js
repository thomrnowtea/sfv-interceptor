import { migrateRule, materializeSourceRules, isRemoteRule } from '../../shared/rule-schema.js';
import { parseRuleDocument } from '../../shared/rule-document.js';
import { LOCAL_RULES_KEY, SOURCES_KEY, readList, updateList } from './storage.js';
import { validateFileRules } from './file-rules.js';
import { toggleSourceRule } from './sources.js';

export function generateId() {
  return 'rule_' + crypto.randomUUID();
}

export function generatePairId() {
  return 'pair_' + crypto.randomUUID();
}

export async function getRules() {
  const [local, sources] = await Promise.all([readList(LOCAL_RULES_KEY), readList(SOURCES_KEY)]);
  // Local rules keep precedence when both kinds match a request.
  return [...local.map(migrateRule), ...sources.flatMap(materializeSourceRules)];
}

function assertLocalId(id) {
  if (isRemoteRule({ id })) throw new Error('Remote rules are read-only. Manage their source instead.');
}

function prepareLocalRule(input) {
  assertLocalId(input.id);
  const rule = migrateRule(input);
  if (!rule.id) rule.id = generateId();
  rule.pairs = rule.pairs.map(pair => ({ ...pair, id: pair.id || generatePairId() }));
  return rule;
}

function mutateRules(mutate) {
  return updateList(LOCAL_RULES_KEY, raw => mutate(raw.map(migrateRule)));
}

export function saveRules(input) {
  const rules = parseRuleDocument(input).map(prepareLocalRule);
  return validateFileRules(rules).then(() => mutateRules(() => ({ items: rules })));
}

export function mergeRules(input, strategy = 'skip') {
  if (!['skip', 'overwrite'].includes(strategy)) throw new Error('Invalid import strategy');
  const incoming = parseRuleDocument(input).map(prepareLocalRule);
  return validateFileRules(incoming).then(() => mutateRules(existing => {
    const byId = new Map(existing.map(rule => [rule.id, rule]));
    const counts = { added: 0, updated: 0, skipped: 0 };
    for (const rule of incoming) {
      if (!byId.has(rule.id)) {
        byId.set(rule.id, rule);
        counts.added++;
      } else if (strategy === 'overwrite') {
        byId.set(rule.id, rule);
        counts.updated++;
      } else {
        counts.skipped++;
      }
    }
    return { items: [...byId.values()], result: counts };
  }));
}

export function saveRule(input) {
  assertLocalId(input?.id);
  if (input?.readOnly) throw new Error('Remote rules are read-only. Manage their source instead.');
  const rule = prepareLocalRule(parseRuleDocument([input])[0]);
  return validateFileRules([rule]).then(() => mutateRules(existing => {
    const index = existing.findIndex(item => item.id === rule.id);
    if (index === -1) existing.push(rule);
    else existing[index] = rule;
    return { items: existing, result: rule };
  }));
}

export function deleteRule(id) {
  assertLocalId(id);
  return mutateRules(existing => ({ items: existing.filter(rule => rule.id !== id) }));
}

export function toggleRule(id) {
  if (typeof id !== 'string') throw new Error('Rule id must be text');
  if (isRemoteRule({ id })) return toggleSourceRule(id);
  return mutateRules(existing => {
    const rule = existing.find(item => item.id === id);
    if (!rule) throw new Error('Rule not found');
    rule.enabled = !rule.enabled;
    return { items: existing, result: rule };
  });
}
