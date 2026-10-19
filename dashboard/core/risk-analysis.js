import { parsers } from '../../shared/vendor/prettier/plugins/babel.mjs';
import { parsers as htmlParsers } from '../../shared/vendor/prettier/plugins/html.mjs';
import { RISK_BY_ID } from './risk-catalog.js';
import { syntaxContext, walkSyntax } from './risk-syntax.js';

const MEMBERS = new Set(['MemberExpression', 'OptionalMemberExpression']);
const CALLS = new Set(['CallExpression', 'OptionalCallExpression', 'NewExpression']);
const STORAGE_METHODS = new Set(['getItem', 'setItem', 'removeItem', 'clear', 'key']);
const STORAGE_ROOTS = new Set(['localStorage', 'sessionStorage']);
const INPUT_EVENTS = new Set(['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'change', 'submit']);
const EXTENSION_NAMESPACES = new Set(['runtime', 'storage', 'tabs', 'scripting', 'userScripts', 'cookies', 'webRequest', 'declarativeNetRequest', 'permissions', 'history', 'bookmarks', 'downloads', 'management', 'identity']);
const BUILT_INS = new Set(['Object', 'Array', 'Function', 'String', 'Number', 'Boolean', 'Promise', 'RegExp', 'Map', 'Set', 'Date', 'EventTarget', 'Node', 'Element', 'HTMLElement', 'XMLHttpRequest', 'WebSocket']);
const HOOKABLE_GLOBALS = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'eval', 'Function']);
const SENSITIVE_CALLS = new Set([
  'navigator.clipboard.read', 'navigator.clipboard.readText', 'navigator.credentials.get',
  'navigator.geolocation.getCurrentPosition', 'navigator.geolocation.watchPosition',
  'navigator.mediaDevices.getUserMedia', 'navigator.mediaDevices.getDisplayMedia', 'navigator.mediaDevices.enumerateDevices',
]);
const DIRECT_CALLS = new Map([
  ['eval', 'dynamic_eval'], ['Function', 'dynamic_eval'], ['Function.prototype.constructor', 'dynamic_eval'],
  ['fetch', 'network_fetch'], ['XMLHttpRequest', 'network_fetch'], ['navigator.sendBeacon', 'network_fetch'],
  ['WebSocket', 'websocket'], ['EventSource', 'websocket'], ['RTCPeerConnection', 'websocket'],
  ['Worker', 'worker'], ['SharedWorker', 'worker'], ['navigator.serviceWorker.register', 'worker'],
  ['cookieStore.get', 'cookie_read'], ['cookieStore.getAll', 'cookie_read'],
  ['cookieStore.set', 'cookie_write'], ['cookieStore.delete', 'cookie_write'],
  ['indexedDB.open', 'storage'], ['indexedDB.deleteDatabase', 'storage'],
  ['importScripts', 'external_code'], ['location.assign', 'location_redirect'], ['location.replace', 'location_redirect'], ['open', 'location_redirect'],
]);
const analyses = new Map();
const HTML_HANDLERS = new Set('abort,animationcancel,animationend,animationiteration,animationstart,auxclick,beforeinput,beforetoggle,blur,cancel,change,click,close,contextmenu,copy,cut,dblclick,drag,dragend,dragenter,dragleave,dragover,dragstart,drop,error,focus,focusin,focusout,input,invalid,keydown,keypress,keyup,load,mousedown,mouseenter,mouseleave,mousemove,mouseout,mouseover,mouseup,paste,pointercancel,pointerdown,pointerenter,pointerleave,pointermove,pointerout,pointerover,pointerup,reset,resize,scroll,securitypolicyviolation,select,slotchange,submit,toggle,touchcancel,touchend,touchmove,touchstart,transitioncancel,transitionend,transitionrun,transitionstart,wheel'.split(','));

function callDetails(node, context) {
  let path = context.path(node.callee) ?? [];
  let args = node.arguments ?? [];
  if (path.at(-1) === 'call') { path = path.slice(0, -1); args = args.slice(1); }
  if (path.at(-1) === 'apply') { path = path.slice(0, -1); args = args[1]?.elements ?? []; }
  return { path, key: path.join('.'), args, target: node.callee };
}

function knownString(node, context) {
  if (!node) return false;
  if (context.text(node) !== null || node.type === 'TemplateLiteral') return true;
  return node.type === 'BinaryExpression' && node.operator === '+' && (knownString(node.left, context) || knownString(node.right, context));
}

function canvasRead(path) {
  if (path[0] === '@element' && path[1] === 'canvas') return ['toDataURL', 'toBlob'].includes(path.at(-1));
  return path[0] === '@context' && ['getImageData', 'readPixels', 'getParameter'].includes(path.at(-1));
}

function objectProperty(node, name, context) {
  if (node?.type !== 'ObjectExpression') return null;
  return node.properties.find(property => {
    const key = property.computed ? context.text(property.key) : property.key?.name ?? property.key?.value;
    return property.type === 'ObjectProperty' && key === name;
  })?.value;
}

function unrestrictedMessage({ path, args }, context) {
  if (path.at(-1) !== 'postMessage') return false;
  if (!['postMessage', 'parent', 'top', 'opener', 'frames'].includes(path[0])) return false;
  const target = objectProperty(args[1], 'targetOrigin', context) ?? args[1];
  return context.text(target) === '*';
}

function isPlainData(path) {
  if (['@object', '@array'].includes(path[0])) return true;
  return path[0] === '@local' && path.some(part => part === 'responseJSON' || part === 'requestJSON');
}

function activeMarkup(text) {
  try {
    return activeMarkupNode(htmlParsers.html.parse(text, { parser: 'html' }));
  } catch {
    // A literal that cannot be inspected as markup still merits review at a sink.
    return true;
  }
}

function executableAttribute(attribute) {
  const name = attribute.name.toLowerCase();
  if (name.startsWith('on') && HTML_HANDLERS.has(name.slice(2))) return true;
  if (!['href', 'src', 'action', 'formaction', 'xlink:href'].includes(name)) return false;
  return /^(?:javascript|vbscript):|^data:text\/html/i.test((attribute.value || '').replace(/[\u0000-\u0020]/g, ''));
}

function executableScript(node) {
  if (node.name?.toLowerCase() !== 'script') return false;
  const type = node.attrs?.find(attribute => attribute.name.toLowerCase() === 'type')?.value?.toLowerCase().trim() || '';
  return !type || type === 'module' || type === 'importmap' || /^(?:text|application)\/(?:java|ecma)script(?:;|$)/.test(type);
}

function activeMarkupNode(node) {
  if (executableScript(node) || ['iframe', 'object', 'embed'].includes(node.name?.toLowerCase())) return true;
  if (node.attrs?.some(executableAttribute)) return true;
  return node.children?.some(activeMarkupNode) ?? false;
}

function reviewHtml(node, context) {
  const literal = context.text(node);
  return literal === null || activeMarkup(literal);
}

function nativePrototype(path) {
  return BUILT_INS.has(path[0]) && path.includes('prototype');
}

function nativeProperty(target, property) {
  if (nativePrototype(target)) return true;
  if (target.join('.') === 'window') return HOOKABLE_GLOBALS.has(property);
  return target.join('.') === 'document' && property === 'cookie';
}

function changesNativeApi({ key, args }, context) {
  const target = context.path(args[0]) ?? [];
  if (['Object.defineProperty', 'Reflect.defineProperty', 'Reflect.set'].includes(key)) return nativeProperty(target, context.text(args[1]));
  if (['Object.setPrototypeOf', 'Reflect.setPrototypeOf'].includes(key)) return target[0] === 'window' || BUILT_INS.has(target[0]);
  if (!['Object.assign', 'Object.defineProperties'].includes(key)) return false;
  return args.slice(1).some(argument => {
    if (argument.type !== 'ObjectExpression') return false;
    return argument.properties.some(property => nativeProperty(target, property.key?.name ?? property.key?.value));
  });
}

function inspectHtmlCall(details, context, emit) {
  const { path, key, args, target } = details;
  if (isPlainData(path)) return;
  if (path.at(-1) === 'insertAdjacentHTML' && reviewHtml(args[1], context)) emit('dom_write', target);
  if (['document.write', 'document.writeln'].includes(key) && args.some(argument => reviewHtml(argument, context))) emit('dom_write', target);
  if (path.at(-1) === 'setHTMLUnsafe') emit('dom_write', target);
}

function inspectElementCall(details, node, context, emit) {
  if (!['document.createElement', 'document.createElementNS'].includes(details.key)) return;
  const tag = context.text(details.args[details.key.endsWith('NS') ? 1 : 0])?.toLowerCase();
  if (tag === 'script') emit('external_code', node);
  if (tag === 'iframe') emit('location_redirect', node);
}

function inspectInputCall({ key, args, target }, context, emit) {
  if (!['addEventListener', 'document.addEventListener'].includes(key)) return;
  if (INPUT_EVENTS.has(context.text(args[0]))) emit('input_capture', target);
}

function inspectCall(node, context, emit) {
  if (node.callee?.type === 'Import') { emit('external_code', node.callee); return; }
  const details = callDetails(node, context);
  const { key, args, target } = details;
  const direct = DIRECT_CALLS.get(key);
  if (direct) emit(direct, target);
  if (['setTimeout', 'setInterval'].includes(key) && knownString(args[0], context)) emit('dynamic_eval', target);
  inspectDataCalls(details, emit);
  inspectCallEffects(details, node, context, emit);
}

function inspectDataCalls({ key, path, target }, emit) {
  if (SENSITIVE_CALLS.has(key)) emit('navigator_sensors', target);
  if (STORAGE_ROOTS.has(path[0]) && path.length === 2 && STORAGE_METHODS.has(path[1])) emit('storage', target);
  if (['chrome', 'browser'].includes(path[0]) && EXTENSION_NAMESPACES.has(path[1])) emit('extension_api', target);
}

function inspectCallEffects(details, node, context, emit) {
  if (canvasRead(details.path)) emit('canvas_read', details.target);
  if (unrestrictedMessage(details, context)) emit('postmessage', details.target);
  if (changesNativeApi(details, context)) emit('prototype_hook', details.target);
  inspectInputCall(details, context, emit);
  inspectHtmlCall(details, context, emit);
  inspectElementCall(details, node, context, emit);
}

function writeOnly(node, parent) {
  if (parent?.type === 'AssignmentExpression') return parent.left === node && parent.operator === '=';
  return parent?.type === 'UnaryExpression' && parent.operator === 'delete' && parent.argument === node;
}

function inspectRead(path, node, emit) {
  if (path.join('.') === 'document.cookie') emit('cookie_read', node);
  if (STORAGE_ROOTS.has(path[0]) && path.length === 2 && !STORAGE_METHODS.has(path[1]) && path[1] !== 'length') emit('storage', node);
}

function inspectMember(node, parent, context, emit) {
  if (writeOnly(node, parent)) return;
  inspectRead(context.path(node) ?? [], node, emit);
}

function inspectDestructuring(node, context, emit) {
  if (!node.init || node.id.type !== 'ObjectPattern') return;
  const base = context.path(node.init);
  if (!base) return;
  for (const { access, suffix, readSuffix } of context.bindings(node.id)) {
    const properties = readSuffix ?? suffix;
    if (properties) inspectRead([...base, ...properties], access, emit);
  }
}

function inspectWrite(node, context, emit) {
  const target = node.left ?? node.argument;
  const path = context.path(target) ?? [];
  const key = path.join('.');
  if (key === 'document.cookie') emit('cookie_write', target);
  if (STORAGE_ROOTS.has(path[0]) && path.length > 1) emit('storage', target);
  if (['location', 'location.href', 'location.protocol', 'location.host', 'location.hostname', 'location.pathname', 'location.search', 'location.hash'].includes(key)) emit('location_redirect', target);
  inspectWriteEffects(node, path, target, context, emit);
}

function inspectWriteEffects(node, path, target, context, emit) {
  if (nativeWrite(path)) emit('prototype_hook', target);
  if (['innerHTML', 'outerHTML', 'srcdoc'].includes(path.at(-1)) && !isPlainData(path) && reviewHtml(node.right, context)) emit('dom_write', target);
  inspectInputWrite(path, target, emit);
}

function nativeWrite(path) {
  return nativePrototype(path) || path.at(-1) === '__proto__' || (path.length === 1 && HOOKABLE_GLOBALS.has(path[0]));
}

function inspectInputWrite(path, target, emit) {
  const event = path.at(-1)?.replace(/^on/, '');
  const isPage = path.length === 1 || (path.length === 2 && path[0] === 'document');
  if (isPage && INPUT_EVENTS.has(event) && path.at(-1).startsWith('on')) emit('input_capture', target);
}

function collectFindings(ast) {
  const context = syntaxContext(ast);
  const flags = new Map();
  const seen = new Set();
  function emit(id, node) {
    const key = id + ':' + node.start + ':' + node.end;
    if (seen.has(key)) return;
    seen.add(key);
    const flag = flags.get(id) ?? { ...RISK_BY_ID.get(id), ranges: [] };
    flag.ranges.push({ from: node.start, to: node.end, line: node.loc.start.line, column: node.loc.start.column + 1 });
    flags.set(id, flag);
  }
  walkSyntax(ast, (node, parent) => {
    if (CALLS.has(node.type)) inspectCall(node, context, emit);
    if (MEMBERS.has(node.type)) inspectMember(node, parent, context, emit);
    if (node.type === 'VariableDeclarator') inspectDestructuring(node, context, emit);
    if (['AssignmentExpression', 'UpdateExpression'].includes(node.type)) inspectWrite(node, context, emit);
    if (node.type === 'UnaryExpression' && node.operator === 'delete') inspectWrite(node, context, emit);
    if (node.type === 'ImportExpression') emit('external_code', node);
  });
  for (const flag of flags.values()) flag.ranges.sort((a, b) => a.from - b.from);
  return [...flags.values()].sort((a, b) => b.sev - a.sev || a.ranges[0].from - b.ranges[0].from);
}

function parseAnalysis(code) {
  if (!code.trim()) return { risks: [], error: null };
  try {
    if (code.length > 1_000_000) throw new Error('Code exceeds the 1,000,000-character analysis limit.');
    const ast = parsers.babel.parse(code, {});
    if (ast.errors?.length) throw ast.errors[0];
    return { risks: collectFindings(ast), error: null };
  } catch (error) {
    return { risks: [], error: String(error.message).split('\n')[0] };
  }
}

export function inspectCode(code = '') {
  if (analyses.has(code)) return analyses.get(code);
  const result = parseAnalysis(code);
  analyses.set(code, result);
  if (analyses.size > 6) analyses.delete(analyses.keys().next().value);
  return result;
}

export function executableRuleFields(rule) {
  const fields = [];
  if (rule.request?.type === 'dynamic') fields.push({ id: 'f-req-modifier', label: 'Request JavaScript', code: rule.request.body || '' });
  const staticScript = rule.response?.type === 'static' && rule.resourceType === 'html' && rule.resourceSubtype === 'js';
  if (rule.response?.type === 'dynamic' || staticScript) {
    fields.push({ id: staticScript ? 'f-body-static' : 'f-body-dynamic', label: 'Response JavaScript', code: rule.response.body || '' });
  }
  return fields;
}

export function inspectRuleCode(rule) {
  const findings = new Map();
  for (const field of executableRuleFields(rule)) {
    const analysis = inspectCode(field.code);
    // Review availability must not become an additional source-language or
    // size restriction. The existing compactor validates syntax before storage.
    if (analysis.error) continue;
    for (const risk of analysis.risks) {
      const combined = findings.get(risk.id) ?? { ...risk, fields: [] };
      combined.fields.push(field.label);
      findings.set(risk.id, combined);
    }
  }
  return [...findings.values()].sort((a, b) => b.sev - a.sev);
}
