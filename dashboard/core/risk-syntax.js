const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod']);
const BLOCK_SCOPES = new Set(['BlockStatement', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'ClassDeclaration', 'ClassExpression']);
const METADATA = new Set(['loc', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'tokens', 'errors']);

export function* childNodes(node) {
  for (const [key, value] of Object.entries(node)) {
    if (METADATA.has(key)) continue;
    const items = Array.isArray(value) ? value : [value];
    for (const child of items) {
      if (child && typeof child.type === 'string') yield child;
    }
  }
}

export function walkSyntax(node, visit, parent = null) {
  visit(node, parent);
  for (const child of childNodes(node)) walkSyntax(child, visit, node);
}

function propertyName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') return String(node.value);
  return null;
}

function patternBindings(pattern, suffix = [], access = null) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [{ node: pattern, suffix, access: access ?? pattern }];
  if (pattern.type === 'AssignmentPattern') return patternBindings(pattern.left, suffix, access).map(binding => ({ ...binding, readSuffix: binding.suffix, suffix: null }));
  if (pattern.type === 'RestElement') return patternBindings(pattern.argument, null);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap((item, index) => patternBindings(item, suffix && [...suffix, String(index)]));
  if (pattern.type !== 'ObjectPattern') return [];
  return pattern.properties.flatMap(property => {
    if (property.type === 'RestElement') return patternBindings(property.argument, null);
    const key = propertyName(property.key);
    return patternBindings(property.value, key !== null && suffix ? [...suffix, key] : null, property.key);
  });
}

function variableScope(scope) {
  while (scope.parent && scope.kind === 'block') scope = scope.parent;
  return scope;
}

function declarePattern(scope, pattern, kind, init = null) {
  for (const { node, suffix } of patternBindings(pattern)) {
    scope.bindings.set(node.name, { kind, init, suffix, mutated: false });
  }
}

function scopeKind(node) {
  if (FUNCTIONS.has(node.type)) return 'function';
  if (node.type === 'Program') return 'program';
  return BLOCK_SCOPES.has(node.type) ? 'block' : null;
}

function declareFunction(node, scope, parentScope) {
  const owner = node.type === 'FunctionDeclaration' ? parentScope : scope;
  if (node.id) declarePattern(owner, node.id, 'function');
  for (const parameter of node.params) declarePattern(scope, parameter, 'parameter');
}

function declareVariables(node, scope) {
  const owner = node.kind === 'var' ? variableScope(scope) : scope;
  for (const declaration of node.declarations) declarePattern(owner, declaration.id, node.kind, declaration.init);
}

const DECLARATIONS = {
  VariableDeclaration: declareVariables,
  CatchClause: (node, scope) => declarePattern(scope, node.param, 'catch'),
  ImportDeclaration: (node, scope) => {
    for (const specifier of node.specifiers) declarePattern(scope, specifier.local, 'import');
  },
  ClassDeclaration: (node, scope, parentScope) => declarePattern(parentScope, node.id, 'class'),
  ClassExpression: (node, scope) => declarePattern(scope, node.id, 'class'),
};

function declareNode(node, scope, parentScope) {
  if (FUNCTIONS.has(node.type)) declareFunction(node, scope, parentScope);
  DECLARATIONS[node.type]?.(node, scope, parentScope);
}

function findBinding(scope, name) {
  while (scope) {
    if (scope.bindings.has(name)) return scope.bindings.get(name);
    scope = scope.parent;
  }
  return null;
}

function writtenPattern(node) {
  if (node.type === 'AssignmentExpression') return node.left;
  if (node.type === 'UpdateExpression') return node.argument;
  if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') return node.left;
  return null;
}

function makeScopes(ast) {
  const scopes = new WeakMap();
  const root = { kind: 'program', bindings: new Map(), parent: null };
  function assign(node, parentScope) {
    const kind = scopeKind(node);
    const scope = kind ? { kind, bindings: new Map(), parent: parentScope } : parentScope;
    scopes.set(node, scope);
    declareNode(node, scope, parentScope);
    for (const child of childNodes(node)) {
      const childScope = FUNCTIONS.has(node.type) && node.computed && child === node.key ? parentScope : scope;
      assign(child, childScope);
    }
  }
  assign(ast, root);
  walkSyntax(ast, node => {
    for (const { node: identifier } of patternBindings(writtenPattern(node))) {
      const binding = findBinding(scopes.get(node), identifier.name);
      if (binding) binding.mutated = true;
    }
  });
  return scopes;
}

function canonicalPath(path) {
  if (!path) return null;
  while (path.length > 1 && ['window', 'self', 'globalThis'].includes(path[0])) path = path.slice(1);
  if (path.length === 1 && ['self', 'globalThis'].includes(path[0])) return ['window'];
  return path;
}

export function syntaxContext(ast) {
  const scopes = makeScopes(ast);

  function alias(node, seen, resolve) {
    const binding = findBinding(scopes.get(node), node.name);
    if (!binding) return undefined;
    if (binding.kind !== 'const' || binding.mutated || !binding.init || !binding.suffix || seen.has(binding)) return null;
    const visited = new Set(seen).add(binding);
    return resolve(binding, visited);
  }

  function text(node, seen = new Set()) {
    if (!node) return null;
    if (node.type === 'StringLiteral') return node.value;
    if (node.type === 'Identifier') return alias(node, seen, (binding, visited) => binding.suffix.length ? null : text(binding.init, visited)) ?? null;
    if (node.type === 'BinaryExpression' && node.operator === '+') return joinedText(node, seen);
    if (node.type === 'TemplateLiteral') return templateText(node, seen);
    return null;
  }

  function joinedText(node, seen) {
    const left = text(node.left, seen), right = text(node.right, seen);
    return left !== null && right !== null ? left + right : null;
  }

  function templateText(node, seen) {
    const expressions = node.expressions.map(expression => text(expression, seen));
    if (expressions.includes(null)) return null;
    return node.quasis.map((quasi, index) => (quasi.value.cooked ?? quasi.value.raw) + (expressions[index] ?? '')).join('');
  }

  function identifierPath(node, seen) {
    const resolved = alias(node, seen, (binding, visited) => {
      const base = path(binding.init, visited);
      return base ? [...base, ...binding.suffix] : null;
    });
    if (resolved === undefined) return [node.name];
    return resolved ?? ['@local', node.name];
  }

  function memberPath(node, seen) {
    const base = path(node.object, seen);
    const property = node.computed ? text(node.property, seen) : propertyName(node.property);
    return base && property !== null ? [...base, property] : null;
  }

  function callResult(node, seen) {
    const callee = path(node.callee, seen);
    if (!callee) return null;
    if (callee.join('.') === 'document.createElement') return ['@element', text(node.arguments[0], seen)?.toLowerCase() ?? 'unknown'];
    return elementResult(callee, node, seen);
  }

  function elementResult(callee, node, seen) {
    if (callee[0] === 'document' && ['querySelector', 'getElementById'].includes(callee.at(-1))) return ['@element', 'unknown'];
    if (callee[0] !== '@element') return null;
    if (callee.at(-1) === 'querySelector') return ['@element', 'unknown'];
    if (callee[1] === 'canvas' && callee.at(-1) === 'getContext') return ['@context', text(node.arguments[0], seen) ?? 'unknown'];
    return null;
  }

  const paths = {
    Identifier: identifierPath,
    MemberExpression: memberPath,
    OptionalMemberExpression: memberPath,
    CallExpression: callResult,
    OptionalCallExpression: callResult,
    SequenceExpression: (node, seen) => path(node.expressions.at(-1), seen),
    ParenthesizedExpression: (node, seen) => path(node.expression, seen),
    ObjectExpression: () => ['@object'],
    ArrayExpression: () => ['@array'],
    NewExpression: (node, seen) => { const target = path(node.callee, seen); return target && ['@instance', ...target]; },
  };

  function path(node, seen = new Set()) {
    if (!node) return null;
    return canonicalPath(paths[node.type]?.(node, seen) ?? null);
  }

  return { path, text, bindings: patternBindings };
}
