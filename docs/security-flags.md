# Code review flags

Flags identify operations that deserve review. They do not determine whether a rule is malicious or safe, and do not intercept execution. The catalog in `dashboard/core/risk-catalog.js` owns the labels, severity, trigger descriptions, and examples shown by **Flag reference**.

## Coverage and presentation

The editor reviews dynamic request JavaScript, dynamic response JavaScript (including JS/CSS transformers), and static JS replacement bodies. Read-only remote editors expose the same navigable flags. Static API bodies, CSS, HTML documents, and headers are not interpreted as JavaScript. Source synchronization and imports do not become runtime security gates.

The locally bundled Prettier Babel parser supplies actual syntax nodes and source offsets. Comments, regular expressions, inert strings, and template text do not count as executable code; expressions inside template interpolations do. String timers are identified as text execution without evaluating or decoding their payload. The bundled HTML parser distinguishes executable literal markup from text or quoted examples at HTML insertion sinks.

Binding analysis predeclares local variables, parameters, destructuring bindings, functions, classes, imports, and catch bindings. It recognizes simple immutable aliases, optional calls, and literal computed property names. Reassigned or mutable aliases are not assumed to remain browser APIs.

Each flag contains exact UTF-16 source offsets with exclusive ends, line, and column. Highlight analysis always uses the displayed document; save review uses the backing source. Formatting remains presentation only. Highlight ranges are rebuilt after document and viewport changes and removed when the editor is destroyed. They do not insert markup into the source, change a rule, or create undo entries.

Background tints and underlines use the same severity color as the badges. Higher severity takes precedence for overlapping ranges. Clicking a badge selects its source; repeated activation cycles occurrences. Names, severity, counts, and accessible descriptions accompany color. Browsers without native text highlights retain source selection through the badges.

Each risk panel is a positioned containing block for its visually hidden accessible descriptions. Without this containment, absolute-positioned descriptions below the editor viewport can enlarge the root document despite the editor's own overflow clipping. Browser geometry checks require the document height to stay within the viewport, reject root scrolling, and keep the status bar at the viewport edge for request/response, static-JS and read-only editors, narrow layouts, and browser zoom.

## Catalog

| Flag | Severity | Trigger |
| --- | --- | --- |
| Dynamic code execution | Critical | `eval`, `Function` with or without `new`, and known string timers. |
| Additional script loading | High | Dynamic import, `importScripts`, or script element creation. Creating an element alone does not execute it. |
| Cookie read | High | Reading `document.cookie`, including destructuring, or cookie store reads. HttpOnly cookies remain inaccessible. |
| Page storage access | High | Web Storage entry operations and IndexedDB open/delete operations. Mere availability checks are omitted. |
| Clipboard / device data | High | Clipboard reads, credential requests, geolocation, and media/display capture APIs. |
| Page-wide input listener | High | Keyboard, input, change, and submit listeners on `window`/`document`. Individual control listeners are omitted. |
| HTML insertion | High | Dynamic or active markup written through HTML parsing sinks; literal markup that cannot be parsed also requires review. |
| Worker setup | High | Worker construction or service worker registration; no inference about mining. |
| Extension API access | High | Calls into recognized extension API namespaces; this does not imply those APIs are available to page code. |
| Native API / prototype change | High | Browser API overrides, known built-in prototype changes, or `__proto__` writes. |
| Network access | Medium | Fetch, XMLHttpRequest construction, or sendBeacon; no inference about exfiltration. |
| Persistent connection | Medium | WebSocket, EventSource, and WebRTC construction. |
| Cookie change | Medium | Cookie writes/deletes. A plain assignment is separate from reading cookies. Compound assignments can produce both flags. |
| Unrestricted message target | Medium | Window/frame messaging explicitly targeting `*`, including options-object syntax. |
| Navigation / embedded page | Medium | Location changes, opening windows, or iframe creation. Reload and History API routing are omitted. |
| Canvas readback | Medium | Pixel/parameter readback or canvas export from an identifiable rendering source; no inference about fingerprinting. |

Saving a local rule asks for review of High/Critical operations across all executable fields. Medium operations stay visible without blocking routine saves. Syntax errors still prevent saving through normal code validation. No recognized flags is explicitly not presented as a clean bill of health.

## Limits

This is a syntax-based capability review, not whole-program or data-flow analysis. It can report unreachable code and legitimate uses of sensitive operations. Indirect mutation, mutable aliases, arbitrary property computation, opaque helper functions, encoded payloads, and code loaded later can evade recognition. It cannot establish whether a network request leaks sensitive information. DOM-like properties on objects of unknown type can still require manual interpretation.

Incomplete/invalid syntax and sources exceeding 1,000,000 UTF-16 code units show **Analysis unavailable**, with no stale highlights. Analysis is debounced during editing and cached for a small number of exact source documents. Badge activation resolves against the latest displayed code so a pending analysis or automatic formatting cannot navigate to stale offsets.

## Verification

Run `npm test` for trigger detection and source-offset checks, and `npm run test:security` for editor highlights, occurrence navigation, save review and read-only behavior. The browser suite includes themes, narrow layouts, keyboard navigation and scoped accessibility scans. Each catalog entry has an expected trigger and a nearby negative example.

Automated scans do not replace manual screen-reader or custom-theme contrast checks. The implementation uses the [Prettier parser interface](https://prettier.io/docs/plugins#parsers) and the [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API). See [quality checks](qa.md).
