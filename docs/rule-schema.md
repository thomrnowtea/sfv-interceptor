# Rules, imports, and remote sources

The extension uses JavaScript ES modules and `chrome.storage.local`. The service worker owns all writes. Dashboard and popup operations use runtime messages.

## Canonical rule

```json
{
  "id": "account-response",
  "name": "Account response",
  "version": "1.2.0",
  "enabled": true,
  "resourceType": "rest",
  "description": "Shared development response",
  "pairs": [
    {
      "id": "account-url",
      "urlPattern": "/api/account",
      "urlOperator": "Contains",
      "method": "GET",
      "caseSensitive": false,
      "gqlOperation": "",
      "redirectUrl": ""
    }
  ],
  "request": { "type": "static", "body": "", "customHeaders": "" },
  "response": {
    "type": "static",
    "body": "{\"account\": \"demo\"}",
    "statusCode": "200",
    "delay": 0,
    "customHeaders": ""
  }
}
```

`resourceType` is `rest`, `graphql`, or `html`. HTML resource rules additionally use `resourceSubtype`: `html` for page injection, `js` or `css` for file replacement. Operators are `Contains`, `Equals`, `Wildcard`, and `Regex`. Body types are `static` and `dynamic`; headers are JSON text. Response configuration belongs to the rule, not each pair.

Versions accept a number or numeric string with up to three parts: `1`, `1.2`, `1.2.0`. Runtime versions are strings. Missing versions default to `1.0.0`, including existing stored rules. The editor lets users set local versions explicitly; saving does not increment a version automatically. Remote versions always follow the published document, even if a publisher lowers a version.

Legacy flat rules, old per-pair response fields, and Requestly-style exports are migrated by `shared/rule-schema.js` and `shared/converters.js`.

## One-time import

**Import a copy** accepts a local file or any HTTPS URL responding with a JSON array or `{ "rules": [...] }`. A `.json` suffix and a particular Content-Type are not required. Pretty and compact JSON use the same parser. It validates the entire document and stores editable local rules in `sfvi_rules`. It creates no subscription or alarm. Matching local IDs are skipped by default; overwriting requires the import dialog's explicit conflict confirmation. Source snapshots are never changed by a local import.

Exports retain local identities. Remote snapshots get stable local-copy IDs (`copy:remote:...`) so a combined export remains importable even when several sources and local rules use the same publisher IDs. Exported snapshots have no read-only metadata or live source dependency.

Selected and full file exports share one serializer and contain one physical line of JSON. The dashboard compacts dynamic request/response JavaScript, static JS replacements, valid JSON API/request bodies, and JSON headers on save/import/export. JSON whitespace removal preserves numeric token spellings, key order, duplicate keys, and string escapes. JavaScript uses packaged Terser without compression or name mangling. Meaningful HTML/CSS/plain-text spacing and template literal contents are retained; JSON serialization escapes embedded line breaks. Invalid JavaScript rejects the complete save/import/export before writing storage or producing a download, identifying its rule and field. Skipped import conflicts are not compacted. Historical and programmatic storage is left intact until a dashboard save or actual file export. Private `EXPORT_RULES` messages return portable objects, not the serialized download. See [editor formatting](editor-formatting.md).

## Remote subscriptions

**Remote sources → Add source** subscribes to any HTTPS URL whose HTTP response contains rule JSON. The same GET/parsing path applies to every domain, path, query, MIME type, and filename; there are no provider adapters. The extension does not execute a page, scrape HTML, decrypt a private viewer, or fetch a second discovered file. Browser-only URL fragments are not sent in HTTP requests. A page that renders JSON through client-side code must expose a URL that directly responds with that JSON.

The document uses the same array/envelope format, pretty or compact. Every published rule needs a nonempty stable string `id`. Rule IDs must be unique within a document, and pair IDs must be unique within each rule. Missing pair IDs receive stable positional IDs; publishers should provide IDs when reordering pairs.

Sources are stored separately under `sfvi_sources`:

```js
{
  id: 'source_<uuid>',
  name: 'Team rules',
  url: 'https://example.com/rules.json',
  intervalMinutes: 60,
  createdAt: 0,
  lastCheckedAt: null,
  lastSyncedAt: null,
  lastError: '',
  scheduleError: '',
  etag: '', // optional HTTP validator, committed with a fully valid snapshot
  enabledOverrides: {}, // local boolean preferences keyed by publisher rule ID
  rules: [] // last complete, validated canonical snapshot
}
```

The effective rule list places local rules first, then source snapshots. Remote identities are `remote:<source ID>:<encoded publisher rule ID>`, with derived `readOnly`, `sourceId`, `sourceRuleId`, `sourceName`, and `sourceUrl` fields. Feed-supplied metadata cannot confer local write access.

`SAVE_RULE` and `DELETE_RULE` reject remote identities in the service worker. Descriptions, bodies, patterns, and versions remain publisher-owned and read-only. The dashboard and popup expose inspection plus an activation switch. `TOGGLE_RULE` changes only a local boolean in that source's `enabledOverrides`; it never rewrites the publisher snapshot or local rules. Source summaries omit this internal map; effective rules expose the resulting enabled state.

Before the first local choice, activation inherits the source JSON's `enabled` value. After a toggle, the explicit local boolean wins in either direction, including when a publisher changes its default or version. It persists through successful/failed synchronization, HTTP 304, popup reopening and worker/browser restarts. Missing maps in existing subscriptions require no migration or resubscription. Stable publisher IDs preserve the preference; different sources have independent preferences even when their rule IDs match. A valid new snapshot prunes preferences for removed rules; `[]` clears them, and a removed rule that later returns inherits its new publisher default. Failed/304 checks never prune them. Unsubscribe removes the map with its source.

Toggle and snapshot commits share the source storage write queue. They use the freshly read source and validate effective enabled file rules before persisting, so an incoming snapshot cannot overwrite a simultaneous local choice. A disabled publisher rule that is locally enabled must pass file-pattern validation; an effectively disabled rule does not install a blocker. Abort is checked after queue waits and validation. Publication still occurs after persistence; if DNR application fails, UI refreshes authoritative activation rather than implying the storage write was rolled back. Manage the subscription to change its name or polling interval, sync immediately, or unsubscribe.

Each successful download replaces only that source's complete snapshot. Rules removed from the document disappear locally; `[]` removes all its remote rules while keeping the subscription. Network failures, timeouts, malformed JSON, invalid rules, and unsupported active file-matching expressions preserve the previous snapshot, local preferences and last successful timestamp. The source displays the error. Unsubscribing removes only the source and its rules; late downloads cannot recreate it.

Polling uses a GET with `Accept: application/json`, no cookies or referrer, and cache bypass. When the server supplies an `ETag`, the extension stores its exact quoted value (including a weak `W/` prefix) only after schema, file-rule and storage validation succeeds. Later checks send `If-None-Match` to the same URL. HTTP `304` consumes no response body, preserves the snapshot and `lastSyncedAt`, and updates `lastCheckedAt`. HTTP `200` validates and commits the complete new snapshot and validator together; a successful response without ETag clears the old validator. Failures preserve both old data and old ETag. A first load or one-time import cannot accept `304` without its own saved snapshot. Servers without validators still work through full responses on each check. No separate metadata request is made.

Remote snapshot body text continues to reflect the publisher. Display formatting and compact portable exports never rewrite its stored contents or published version.

Portable exported copies use the effective locally chosen enabled state. They contain no subscription preference map or live dependency.

## Scheduling and application

Intervals are whole minutes from 1 through 10080; the default is 60. Per-source alarms use the `sfvi_source:` prefix. Listeners are registered synchronously. Startup restores missing alarms, removes orphan source alarms, and checks overdue sources. Configuration changes and alarm reconciliation share a queue; downloads run outside it. Storage updates use per-key read/modify/write queues, and overlapping downloads for one source reuse the same request.

Chrome can delay alarms during sleep or browser shutdown; this is periodic checking, not an exact wall-clock scheduler. See [Chrome alarms documentation](https://developer.chrome.com/docs/extensions/reference/api/alarms).

All rule publication, including startup, passes through one queue. Publication rebuilds file blockers, pushes REST rules to open tabs, and notifies dashboard/popup. Local file rules take precedence when several rules target the same asset; page injections remain independent. File replacements only run for patterns actually installed in DNR. Unsupported DNR expressions are rejected before storing incoming file rules. An application failure is visible through `sfvi_apply_error`; obsolete blockers are removed when possible and the next successful publication clears the error. See [Chrome DNR documentation](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest).

Lifecycle reconciliation reapplies stored rules while preserving any originals prepared by concurrent navigation. Other publications, including saves, imports and source updates, invalidate resource caches after successfully applying file blockers. This prevents a delayed startup rebuild from erasing a freshly downloaded original without weakening invalidation when rule content changes.

REST configuration changes are pushed to open pages. File replacements and page injections run on subsequent navigation; removing a rule cannot undo JavaScript that has already executed in a page.

GraphQL operation filters compare exact names. An explicit `operationName` in POST JSON or GET query parameters takes precedence. Without it, a document must contain a single named operation matching the filter; fields, fragments, comments, string contents and name prefixes do not match. Ambiguous multi-operation documents and batches are not selected by this fallback. This identifies operations without performing schema validation.

Async API request/response modifiers are awaited, including through the CSP sandbox. A modifier failure preserves the original data. Synchronous XHR supports synchronous modifiers; an async result cannot complete in that call and falls back to the original response. Typed XHR replacements convert returned text to the requested JSON, Blob, ArrayBuffer or document; request-only traffic and failed transformations retain the native typed response. Abort, timeout and network failures do not report a successful application. Cancellation suppresses late delivery/activity, but cannot undo JavaScript that has already executed.

Request-only XHRs expose native download progress. Static/dynamic replacements report progress for the completed replacement body after transformation, with intermediate ready states and its resulting byte count; original response chunks are not exposed as replacement text. Upload observers retain native upload lifecycle and CORS preflight behavior through ordinary property handlers and add/remove/once/AbortSignal listener registration. Aborted listener records are pruned before observation and registration changes, including when another handler suppresses abort-event cleanup or sends reentrantly during abort. Changing timeout after send updates the same deadline measured from the original send, including modifier work and configured response delay; zero disables it.

XHR hooks resolve timeout/upload accessors through the captured constructor's prototype chain, supporting existing native XHR subclasses. The first descriptor wins; an override is not bypassed to force native accessors onto an incompatible wrapper. If the required accessors or a safely mutable prototype are unavailable, that constructor's XHR behavior is preserved without installing partial hooks; fetch interception remains available. This is not general support for arbitrary upload facades or proxies. Hook updates require a fresh page document: reinjection cannot repair broken nonconfigurable accessors installed by an older hook.

## Runtime messages

Extension pages can call `GET_TAB_ACTIVITY`, `GET_RULES`, `EXPORT_RULES`, `IMPORT_RULES`, `MERGE_RULES`, `SAVE_RULE`, `DELETE_RULE`, `TOGGLE_RULE`, `GET_SOURCES`, `ADD_SOURCE`, `UPDATE_SOURCE`, `DELETE_SOURCE`, and `SYNC_SOURCE`. Private messages verify the sender's extension ID and origin. Content scripts use `GET_API_RULES` and `RULE_APPLIED`.

Replies contain `{ ok: true, ... }`, rule/source data, or `{ error: message }`. `GET_RULES` returns effective rules, source summaries, and the latest application error. `RULES_CHANGED` notifies extension views. `ACTIVITY_CHANGED` updates current-tab applied indicators; [rule activity](rule-activity.md) documents its independent session storage and cycle lifecycle. `IMPORT_RULES` replaces local storage only; the UI uses `MERGE_RULES` to preserve unrelated local rules.
