# Applied rules on the current page

The popup distinguishes **enabled** from **applied on this page**. Enabled rules remain eligible for matching. A solid green row with black text, a black type badge with green text, a black switch track with a green thumb, and a named check mark indicate at least one successful application in the active tab's current execution cycle. This highlight is consistent in light and dark themes. Remote rules receive the same indicator while remaining read-only. Failures never remove an earlier success in that cycle.

`sw/core/activity.js` owns the state and serializes reads, configuration changes, navigation resets, and applied-ID unions. It persists `sfvi_activity` in `chrome.storage.session`:

```js
{
  fingerprint: '<SHA-256 of enabled effective rules>',
  revision: '<configuration UUID>',
  generation: 1,
  tabs: {
    '<tab ID>': {
      documentId: '<top-level Chrome document ID>',
      cycleId: '<activation UUID>',
      commitStamp: 0,
      appliedRuleIds: ['<parent rule ID>']
    }
  }
}
```

Session storage preserves the union across popup reopening and service worker reevaluation. Browser/extension restart clears it. No additional manifest permission is needed.

The worker caches one immutable effective rule list and its fingerprint while configuration is unchanged. Local rule and source writes invalidate it before and after persistence, including failed writes; `storage.onChanged` and publication also invalidate it. This internal revision is independent of editable rule versions. Reads or hashes that overlap a change cannot populate the current cache, and returned execution snapshots retain their captured epoch across asynchronous work. Each activity report still validates the sender, document, active frame ancestry, cycle, enabled rule and pair. Worker restart begins with an empty cache and recomputes the same persisted fingerprint, preserving activity when the effective configuration is identical. User-code results and original resources do not use this cache.

## Cycle boundaries

Top-level `webNavigation.onCommitted` starts a new activation. A handshake that reaches the active frame first creates the same activation; the subsequent commit reconciles it once. Reloading the same URL still has a different document identity. Frame navigation does not reset the parent's union. Same-document history/hash changes retain it. A canceled navigation that never commits retains the visible document's state. Removed and replaced tabs are forgotten.

Configuration publication changes the revision only when enabled effective rule content changes. Worker startup, unchanged source downloads, and source polling timestamps do not clear the union. A changed version, body, enabled state, or effective rule list starts a new configuration cycle. The fingerprint is persisted so startup reconciliation cannot accidentally reset activity.

This includes local activation switches for remote rules. Their content remains read-only, but the effective enabled state includes the per-source local preference. Turning one off removes it from API descriptors/file blockers and starts a new configuration cycle; old completions cannot mark it active. Turning it back on makes it eligible again and does not claim it already ran. Synchronization that only preserves the same effective activation does not reset activity merely because a preference map exists.

Back/forward activation must not revive the previous visit's successes. On persisted `pageshow`, MAIN drops its old descriptors and isolated content requests a fresh envelope. Pending operations retain their old captured envelope.

## Identity and completion

API descriptors carry explicit `ruleId`, `pairId`, resource color, configuration revision/generation, and a captured document/cycle envelope. The composite compatibility ID is never split: parent and pair IDs may themselves contain `|`. At `document_start`, the authenticated Chrome `documentId` binds the page immediately; injection does not wait for `getAllFrames` to list the new frame. Descriptors still require their captured cycle, and older configuration generations cannot overwrite newer descriptors.

## Page asset timing

`onBeforeNavigate` prepares matching HTML/JS/CSS rules, DNR blockers, and any required original source while the document request is in flight. `onCommitted` reuses the commit activity snapshot and starts injections without one activity transaction per asset. Static replacements skip downloading the original; when page policy permits, the replacement runs synchronously as an inserted inline script, with the existing Blob load path as a CSP fallback.

Completed asset bodies and page-discovery results retain their LRU limits of 40 and 60 entries respectively. Concurrent callers share an unfinished download until it settles, independently of those limits. Clearing a cache invalidates its pending entries: existing callers may still finish, but their old completions cannot repopulate the cache or remove a newer download. Failed downloads remain retryable.

Asset execution normalizes omitted `original`/`staticBody` fields to `null` and validates source and replacement values before insertion. Cached-source modifiers can return synchronous strings, promises or thenables; nullish results retain the original source. A script that starts and then throws is never retried through the Blob path.

Page/file executors return success independently of notification readiness. The worker validates and records each completed operation, then ensures the MAIN hook and delivers its notice with the resolved theme. It rechecks the document/configuration snapshot after the hook wait; obsolete successes do not notify a successor page or changed configuration. Each asset application has a bounded, document-local deduplication token. Hook readiness, theme loading and another asset's slow modifier never gate the patch or faster successes. API notices continue through their existing MAIN interception path.

Injection is best effort, without a parser-order guarantee. `scripting.executeScript({ injectImmediately: true })` can still run after the page loads, and DNR supports blocking/redirecting requests rather than replacing response bodies. Sites that require a replacement before the parser's next statement may still race. See [Chrome scripting timing](https://developer.chrome.com/docs/extensions/reference/api/scripting) and [DNR actions](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest).

Content forwards each successful operation's identity. The worker verifies sender extension/tab/frame/document, current active frame ancestry, configuration/cycle, and enabled parent/pair identity, then unions the parent ID. Duplicate reports are idempotent. Injection targets use `documentIds`, and injection completion results must match the captured document before recording.

| Path | Recorded success boundary |
| --- | --- |
| Static fetch | Mock `Response` construction and configured delay complete without cancellation |
| Dynamic fetch | Original response, transform, replacement `Response` construction and configured delay complete without cancellation |
| Request-only fetch | A configured mutation/redirect is sent and native fetch returns a response |
| XHR | Mock properties/headers are installed and delivery occurs, after configured delay; request-only no-ops and failed transforms are excluded |
| HTML/page injection | The modifier completes without throwing/rejecting |
| CSS replacement | Replacement selection/transform succeeds and the inserted style has a stylesheet |
| JS replacement | Synchronous inline insertion succeeds or the CSP Blob fallback loads without a correlated script error; load failure, timeout, and transform failure are excluded |

XHR network errors, aborts, timeouts and failed transforms are not reported as successful applications. Modifier failures preserve original data without announcing a successful transformation. JS acceptance does not guarantee later asynchronous application behavior. MAIN events are page-visible UI telemetry and can be spoofed by a host page; they are not a security audit log.

## Messages and UI

Extension views read `GET_TAB_ACTIVITY` with a tab ID; the sender must belong to this extension's origin. Popup reads the active tab and listens for `ACTIVITY_CHANGED` for that tab. The extension icon derives from the same persisted union.

`ACTIVITY_CYCLE_CHANGED` asks content scripts to rebind their descriptors after a cycle/configuration reset. Content responses and pending operations never gain a newer cycle merely because they completed later. Rules remain enabled independently of the green check. The current cycle's union clears on refresh/navigation or configuration change, not when a toast expires.

Run `npm test` and `npm run test:activity` for concurrency, isolation, navigation, identity, interception boundaries, popup accessibility and stale-result handling. `npm run test:popup` also verifies the applied row inside a native toolbar panel.
