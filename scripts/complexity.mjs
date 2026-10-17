import { parse } from 'acorn';
import { readFileSync } from 'node:fs';

const results = [];
const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const decisions = new Set(['IfStatement', 'ConditionalExpression', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement', 'CatchClause']);

function visit(node, current, file) {
  if (!node || typeof node !== 'object') return;
  if (functions.has(node.type)) {
    current = { file, name: node.id?.name ?? `callback@${node.loc.start.line}`, cc: 1 };
    results.push(current);
  }
  if (current && decisions.has(node.type)) current.cc++;
  if (current && node.type === 'LogicalExpression' && node.operator !== '??') current.cc++;
  if (current && node.type === 'SwitchCase' && node.test) current.cc++;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) value.forEach(child => visit(child, current, file));
    else if (value && typeof value === 'object') visit(value, current, file);
  }
}

for (const file of process.argv.slice(2)) {
  const ast = parse(readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  visit(ast, null, file);
}
console.log(JSON.stringify(results.filter(result => result.cc >= 6).sort((a, b) => b.cc - a.cc), null, 2));
