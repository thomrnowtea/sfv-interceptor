// Flags describe observable capabilities, not a verdict about the author's intent.
export const RISK_FLAGS = [
  {
    id: 'dynamic_eval', sev: 3, label: 'Dynamic code execution',
    trigger: 'Calls eval or Function, or passes a known string to setTimeout/setInterval.',
    why: 'Executes additional code supplied as text. Review that text and where it comes from.',
    example: 'eval(payload); setTimeout("runTask()", 100);',
  },
  {
    id: 'external_code', sev: 2, label: 'Additional script loading',
    trigger: 'Uses import(), importScripts(), or creates a script element.',
    why: 'Can load or prepare JavaScript outside the visible rule. A script element only executes when installed.',
    example: 'import(moduleUrl); document.createElement("script");',
  },
  {
    id: 'cookie_read', sev: 2, label: 'Cookie read',
    trigger: 'Reads document.cookie or calls cookieStore.get/getAll.',
    why: 'Reads cookies available to page JavaScript. HttpOnly cookies are not accessible this way.',
    example: 'const cookies = document.cookie;',
  },
  {
    id: 'storage', sev: 2, label: 'Page storage access',
    trigger: 'Reads/writes Web Storage entries or opens/deletes an IndexedDB database.',
    why: 'Accesses persistent page data, which may include account information. This does not by itself transmit data.',
    example: 'localStorage.getItem("session"); indexedDB.open("app");',
  },
  {
    id: 'navigator_sensors', sev: 2, label: 'Clipboard / device data',
    trigger: 'Reads the clipboard, requests credentials, location, camera, microphone, or display capture.',
    why: 'Requests sensitive browser capabilities. Browser permission and user-gesture requirements still apply.',
    example: 'navigator.clipboard.readText();',
  },
  {
    id: 'input_capture', sev: 2, label: 'Page-wide input listener',
    trigger: 'Registers keyboard, input, change, or submit handlers on window/document.',
    why: 'Can observe input across the page. A listener on one individual control is not flagged by this check.',
    example: 'document.addEventListener("keydown", handleKey);',
  },
  {
    id: 'dom_write', sev: 2, label: 'HTML insertion',
    trigger: 'Uses setHTMLUnsafe, or writes dynamic, active, or unparseable literal markup through an HTML parsing sink.',
    why: 'HTML parsing can create active markup. Plain textContent writes and ordinary literal markup are not flagged.',
    example: 'panel.innerHTML = args.response;',
  },
  {
    id: 'worker', sev: 2, label: 'Worker setup',
    trigger: 'Constructs a Worker/SharedWorker or registers a service worker.',
    why: 'Loads code into a separate execution context. Review its source and lifetime; workers are not evidence of mining.',
    example: 'new Worker(workerUrl);',
  },
  {
    id: 'extension_api', sev: 2, label: 'Extension API access',
    trigger: 'Calls a recognized chrome/browser extension API namespace.',
    why: 'Attempts extension API access. Actual availability and permissions depend on the execution context.',
    example: 'chrome.runtime.sendMessage(message);',
  },
  {
    id: 'prototype_hook', sev: 2, label: 'Native API / prototype change',
    trigger: 'Changes a browser API, a known built-in prototype, or writes __proto__.',
    why: 'Can change how other page code behaves. Defining ordinary object properties or creating a Proxy is not flagged.',
    example: 'Object.defineProperty(window, "fetch", { value: wrappedFetch });',
  },
  {
    id: 'network_fetch', sev: 1, label: 'Network access',
    trigger: 'Calls fetch/sendBeacon or constructs XMLHttpRequest.',
    why: 'Can communicate with a server. This check does not establish that data is being exfiltrated.',
    example: 'fetch("/api/preview");',
  },
  {
    id: 'websocket', sev: 1, label: 'Persistent connection',
    trigger: 'Constructs WebSocket, EventSource, or RTCPeerConnection.',
    why: 'Creates an ongoing network connection. These connections are visible in the appropriate browser developer tools.',
    example: 'new WebSocket("wss://example.net/events");',
  },
  {
    id: 'cookie_write', sev: 1, label: 'Cookie change',
    trigger: 'Writes document.cookie or calls cookieStore.set/delete.',
    why: 'Changes page cookies and can affect the current session. A write alone is not classified as a cookie read.',
    example: 'document.cookie = "preview=1; path=/";',
  },
  {
    id: 'postmessage', sev: 1, label: 'Unrestricted message target',
    trigger: 'Sends a window/frame postMessage with the wildcard targetOrigin "*".',
    why: 'Allows delivery regardless of the receiving document origin. Explicit restricted origins are not flagged.',
    example: 'window.parent.postMessage(message, "*");',
  },
  {
    id: 'location_redirect', sev: 1, label: 'Navigation / embedded page',
    trigger: 'Changes location, opens a window, or creates an iframe.',
    why: 'Can navigate or embed another page. Reload and History API routing alone are not flagged.',
    example: 'location.assign(destination);',
  },
  {
    id: 'canvas_read', sev: 1, label: 'Canvas readback',
    trigger: 'Reads pixels/rendering parameters or exports a canvas whose origin is visible in the rule.',
    why: 'Reads rendered output or rendering metadata. Screenshots and image processing are legitimate uses; this alone does not establish fingerprinting.',
    example: 'const canvas = document.createElement("canvas"); canvas.toDataURL();',
  },
];

export const RISK_BY_ID = new Map(RISK_FLAGS.map(flag => [flag.id, flag]));

export function riskSeverity(risks) {
  return Math.max(0, ...risks.map(risk => risk.sev));
}
