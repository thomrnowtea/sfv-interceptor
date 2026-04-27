# SFV Interceptor

Intercept, mock, and modify HTTP requests in real time — directly in Chrome, no account, no proxy, no server required.

---

## Overview

SFV Interceptor is a Manifest V3 Chrome extension that lets developers intercept REST and GraphQL API calls, patch JS and CSS files, and inject code into pages — all from the browser. Rules are created in a full-featured dashboard and take effect immediately across all open tabs without a page reload. It is designed for frontend developers who need to mock APIs, test edge cases, or patch third-party scripts during development.

---

## Features

### API Mocking
- Intercept `fetch` and `XMLHttpRequest` calls for REST and GraphQL endpoints
- Static responses — return a fixed body; the real request still appears in DevTools
- Dynamic responses — write a `modifyResponse(ctx)` JS function to transform the real response
- GraphQL operation name filter — target specific queries or mutations
- HTTP method filter — restrict a rule to `GET`, `POST`, `PUT`, `DELETE`, etc.
- Custom status code and simulated response delay (ms)
- Custom request headers injected per rule

### File Patching
- Replace or modify JS and CSS files before the page executes them
- Inject arbitrary JS or HTML directly into a page at load time
- Uses `declarativeNetRequest` to block the original file and serve the patched version

### Rule Management
- Multiple URL pairs per rule, each with its own response body
- URL match operators: `Contains`, `Equals`, `Wildcard`, `Regex`
- Per-rule and per-pair enable/disable toggle
- Drag-to-reorder rules with custom sort order
- Sort rules by name or resource type
- Bulk select, export, and delete rules
- Import/export rules as JSON — compatible with Requestly export format
- Import from a local file or a remote URL

### Editor & UI
- CodeMirror editor with JavaScript syntax highlighting for dynamic responses
- Security analysis warns on dangerous code patterns before saving
- Custom themes — built-in dark/light presets plus a fully custom color picker
- Popup: search, Active / All Rules tabs, per-rule toggle and quick edit
- Dashboard: sidebar rule list + full rule editor panel

---

## How It Works

When a page loads, `content.js` runs in the isolated world at `document_start` and asks the service worker for any enabled API rules. If rules exist, it injects `page-hook.js` into the page's MAIN world via `chrome.scripting.executeScript`, where it captures the native `fetch` and `XMLHttpRequest` before any page script runs. When a request URL matches a rule, the hook returns the configured static body or passes the real response through the user-defined `modifyResponse` function. For JS and CSS file patching, the service worker uses `declarativeNetRequest` to block the original file on navigation and re-executes a patched version directly in the MAIN world. Saving or toggling a rule triggers an immediate push to all open tabs — no page reload required.

---

## Installation

SFV Interceptor is not published to the Chrome Web Store. Load it as an unpacked extension:

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** using the toggle in the top-right corner
4. Click **Load unpacked**
5. Select the root folder of the repository (the folder containing `manifest.json`)

The SFV Interceptor icon will appear in the Chrome toolbar.

---

## How to Use

### Using the Popup

1. Click the SFV Interceptor icon in the toolbar to open the popup
2. Switch between the **Active** and **All Rules** tabs to filter the list
3. Use the search bar to find a rule by name or URL pattern
4. Toggle the switch on any rule to enable or disable it instantly
5. Click the edit button on a rule to open it in the dashboard
6. Click **+ New Rule** to create a rule and open the dashboard editor

### Using the Dashboard

1. Open the dashboard from the popup via **↗ Dashboard** or by editing any rule
2. Click **+ New Rule** in the sidebar to start a new rule
3. Set a name, select the resource type (REST, GraphQL, JS, CSS, HTML), and enter one or more URL patterns
4. Choose a response type — **Static** for a fixed body, **Dynamic** to write a `modifyResponse` JS function
5. Click **Save** — the rule activates immediately and is pushed to all open tabs
6. To import rules, click **Import** in the sidebar and choose a local JSON file or a remote URL

---

## License

MIT
