# SFVInterceptor

> A Chrome extension for intercepting and mocking HTTP requests — override REST API responses, modify JS/CSS files, and inject custom code, all without touching your backend. No account, no server, no proxy required.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Usage](#usage)
  - [Popup](#popup)
  - [Dashboard](#dashboard)
  - [Rule Types](#rule-types)
  - [Response Modes](#response-modes)
  - [URL Pattern Operators](#url-pattern-operators)
- [How It Works](#how-it-works)
- [Import & Export](#import--export)
- [Compatibility with Requestly](#compatibility-with-requestly)
- [Permissions](#permissions)
- [Project Structure](#project-structure)
- [Known Limitations](#known-limitations)

---

## Overview

SFVInterceptor is a Manifest V3 Chrome extension that lets you intercept outgoing network requests and return custom responses — all from the browser, without a proxy or external tool. It supports three interception modes: **REST API mocking**, **GraphQL mocking**, and **HTML/JS/CSS file patching**.

Rules are managed through a full-featured dashboard with a CodeMirror 6 editor, live dirty-state detection, import/export, and real-time push to all open tabs.

---

## Features

- **REST API & GraphQL mocking** — intercept `fetch` and `XMLHttpRequest` calls and return static or dynamically computed responses
- **Static response** — return a fixed JSON/text body; the real network request is still made so DevTools Network tab stays populated
- **Dynamic response (JS)** — write a `modifyResponse(args)` function that receives the original response and returns a transformed one
- **HTML/JS/CSS file patching** — replace or modify loaded JavaScript and CSS files via script injection at `document_start`
- **Multiple URL patterns per rule** — each rule can match on multiple URL patterns (pairs), each with its own response body
- **URL operators** — `Contains`, `Equals`, `Wildcard` (`*`), and `Regex`
- **HTTP method filter** — optionally restrict a rule to `GET`, `POST`, `PUT`, `DELETE`, etc.
- **Status code & delay** — set a custom HTTP status code and simulate latency (ms)
- **Custom response headers** — inject arbitrary response headers as JSON
- **Live rule push** — toggling or saving a rule immediately propagates to all open tabs without a page reload
- **Real-time dirty tracking** — the Save/Cancel buttons only appear when something actually changed
- **Ghost rule preview** — while creating a new rule, a live preview appears in the sidebar reflecting the name, type, and URL as you type
- **Import / Export** — rules are stored as JSON and are fully compatible with Requestly's export format
- **Green icon indicator** — the extension icon turns green on any tab where a rule was successfully applied
- **No account required** — everything runs locally using `chrome.storage.local`

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  background.js                  │
│  Service Worker — rule storage, DNR management, │
│  icon updates, push to tabs                     │
└────────────┬──────────────────┬─────────────────┘
             │ chrome.scripting │ chrome.tabs
             ▼                  ▼
┌────────────────┐   ┌──────────────────────────┐
│  content.js    │   │  pages/dashboard.html     │
│  ISOLATED world│   │  Full rule editor (CM6)   │
│  document_start│   └──────────────────────────┘
└──────┬─────────┘
       │ postMessage
       ▼
┌────────────────┐
│  page-hook.js  │
│  MAIN world    │
│  Patches fetch │
│  and XHR       │
└────────────────┘
```

**background.js** is the service worker. It owns all rule storage (`chrome.storage.local`), manages `declarativeNetRequest` (DNR) rules for blocking original JS/CSS files, warms caches on navigation, and pushes rule updates to all open tabs.

**content.js** runs in the isolated world at `document_start`. It retrieves the current API rules from the background and injects `page-hook.js` into the MAIN world, then forwards rule updates received from the background via `postMessage`.

**page-hook.js** runs in the MAIN world. It captures the native `window.fetch` and `XMLHttpRequest` before any page code runs, then overrides them. When a request matches a rule, it either returns a static body (while still making the real network request in the background) or passes the real response through a user-defined `modifyResponse` function.

**dashboard.js + dashboard.html** is the full rule editor. It communicates with the background exclusively via `chrome.runtime.sendMessage`.

---

## Installation

SFVInterceptor is not yet published to the Chrome Web Store. Load it as an unpacked extension:

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the root folder of this repository (the one containing `manifest.json`)

The SFVInterceptor icon will appear in your toolbar.

---

## Usage

### Popup

Click the extension icon to open the popup. From here you can:

- See all your rules and their enabled/disabled state
- Toggle individual rules on or off
- Edit a rule (opens the dashboard)
- Delete a rule
- Create a new rule (opens the dashboard directly on the new rule form)
- Search rules by name or URL pattern
- Filter to show only active rules

### Dashboard

The dashboard is a full-page editor accessible from the popup. It has two panels:

**Sidebar** — lists all rules with their type badge, URL pattern, and toggle switch. Supports search and bulk select (select all, export selected, delete selected). Import rules via the Import button at the bottom.

**Editor** — opens when you select or create a rule. Contains:

- Rule name (editable inline at the top)
- Cancel / Save Changes / Create Rule / Close buttons — shown contextually based on whether there are unsaved changes
- **General section** — description field and Delete Rule button (existing rules only)
- **If Request Matches section** — resource type selector, URL pattern pairs, method filter
- **Then Respond With section** — status code, delay, response body (Static or Dynamic), custom response headers

The header background has a subtle blue gradient when the rule is active and a neutral grey gradient when inactive, giving an at-a-glance status without a separate badge.

### Rule Types

| Type | What it does |
|------|-------------|
| **REST API** | Intercepts `fetch` / `XHR` calls matching the URL pattern |
| **GraphQL** | Same mechanism as REST, with an optional GraphQL operation name filter |
| **HTML/JS/CSS** | Patches JavaScript or CSS files at load time via script injection; uses DNR to block the original file and re-executes a patched version |

### Response Modes

**Static** — The response body you type is returned verbatim. The real network request is still made (visible in DevTools Network), but the page receives your custom body.

**Dynamic (JS)** — Write a JavaScript function body. It receives an `args` object and must return the modified response:

```js
function modifyResponse(args) {
  const { method, url, response, responseJSON, requestHeaders, requestData } = args;
  // responseJSON is already parsed if the original was JSON
  return { ...responseJSON, mocked: true, timestamp: Date.now() };
}
```

Available `args` fields:

| Field | Type | Description |
|-------|------|-------------|
| `method` | string | HTTP method (`GET`, `POST`, …) |
| `url` | string | Full request URL |
| `response` | string | Original response body as text |
| `responseJSON` | object \| null | Parsed JSON, or `null` if not valid JSON |
| `responseType` | string | `content-type` header of the original response |
| `requestHeaders` | object | Request headers sent |
| `requestData` | any | Request body (for POST/PUT) |

For HTML/JS/CSS rules in dynamic mode, `args.response` is the full source text of the file being patched.

### URL Pattern Operators

| Operator | Behavior |
|----------|----------|
| `Contains` | Matches if the URL contains the pattern string |
| `Equals` | Exact URL match |
| `Wildcard` | `*` matches any sequence of characters |
| `Regex` | Full JavaScript regular expression (case-insensitive) |

A rule fires if **any** of its pairs matches the request URL.

---

## How It Works

### API Interception (REST / GraphQL)

1. When a page loads, `content.js` (isolated world) asks the background for all enabled API rules
2. If there are rules, `page-hook.js` is injected into the MAIN world via `chrome.scripting.executeScript`
3. `page-hook.js` captures the native `fetch` and `XMLHttpRequest` before any page script runs
4. On each request, the hook checks if the URL matches any rule:
   - **Static**: makes the real request, discards its response, returns the configured body
   - **Dynamic**: makes the real request, passes the response to your `modifyResponse` function, returns the result
5. When a rule is saved or toggled, the background re-injects the hook into all open tabs and pushes the updated rule set via `chrome.tabs.sendMessage`

### JS/CSS File Patching (HTML type)

1. On `onBeforeNavigate`, the background pre-fetches the page HTML and discovers all `<script src="">` URLs
2. On `onCommitted`, it uses `declarativeNetRequest` to block the original file(s) and executes a script in the MAIN world that either replaces or `eval()`s the patched version

---

## Import & Export

Rules can be exported as a JSON file from the dashboard sidebar (select rules → Export). The format is fully compatible with **Requestly** rule exports, so you can:

- Import your existing Requestly rules into SFVInterceptor
- Export SFVInterceptor rules and import them into Requestly

The importer supports both single-rule objects and arrays. Merge strategy on import: skip duplicates (by ID) or overwrite, selectable at import time.

---

## Compatibility with Requestly

SFVInterceptor reads and writes Requestly's `Response` rule format. Supported fields:

- `name`, `status`, `ruleType: "Response"`
- `pairs[].source` — `key: "Url"`, `operator`, `value`, `filters[].requestMethod`
- `pairs[].response` — `type: "static" | "code"`, `value`, `statusCode`, `resourceType`

Unsupported Requestly rule types (`Redirect`, `Headers`, `Script`, `QueryParam`, etc.) are skipped on import.

---

## Permissions

| Permission | Reason |
|------------|--------|
| `declarativeNetRequest` | Block original JS/CSS files for patching |
| `declarativeNetRequestWithHostAccess` | Required for dynamic DNR rules on all hosts |
| `storage` | Persist rules in `chrome.storage.local` |
| `scripting` | Inject `page-hook.js` into page MAIN world |
| `tabs` | Query tabs to push rule updates; update extension icon per tab |
| `webNavigation` | Detect page navigations to pre-warm caches and inject at the right moment |
| `host_permissions: <all_urls>` | Allow interception on any website |

---

## Project Structure

```
sfv-interceptor/
├── manifest.json               # MV3 manifest
├── background.js               # Service worker: storage, DNR, cache, push
├── content.js                  # Isolated world bridge: injects page-hook, forwards updates
├── page-hook.js                # MAIN world: fetch + XHR override
├── popup.html / popup.js       # Toolbar popup UI
├── pages/
│   ├── dashboard.html          # Full rule editor shell + CSS
│   ├── dashboard.js            # Editor logic, dirty tracking, CodeMirror wiring
│   ├── codemirror-bundle.js    # Bundled CodeMirror 6 (offline, no CDN)
│   └── sidebar-interactions.js # Sidebar collapse/resize behaviour
└── icons/
    ├── icon16/48/128.png       # Default (blue) icons
    └── icon16/48/128g.png      # Active (green) icons
```

---

## Known Limitations

- **DevTools Network shows the original response**, not the mocked one. This is a fundamental browser constraint — DevTools reflects what the network layer received, not what JS delivered to the page. The page itself always receives the mocked response correctly.
- **JS/CSS patching requires a page reload** after enabling a rule, because files are fetched and blocked at navigation time.
- **Service worker sleep**: Chrome may suspend the background service worker after inactivity. Rule pushes on toggle/save wake it automatically, but very long idle periods between navigations may cause a brief delay on the first interception.
- **CSP on extension pages**: `page-hook.js` bypasses page CSP because it is injected via the `scripting` API (extension files are CSP-exempt). However, inline `eval()` used by dynamic rules runs in the MAIN world and may be subject to the page's own CSP if it disallows `eval`.

---

## Credits

Built by **thomrnowtea** — [github.com/thomrnowtea](https://github.com/thomrnowtea)
