# Quality checks

Tests use synthetic rules and isolated Chromium profiles. They require no accounts, private rules or access to a personal browser session.

Run the core checks before a release:

```sh
npm test
npm run check
npm run package
npm run test:release
```

The browser suites cover separate parts of the extension:

| Command | Coverage |
| --- | --- |
| `npm run test:browser` | Editing, imports, subscriptions, activation, themes and narrow layouts |
| `npm run test:ui` | Layout, focus, dialogs, zoom and toast presentation |
| `npm run test:popup` | Native toolbar popup sizing and actions; requires a desktop display |
| `npm run test:formatter` | Prettier, editor state and read-only presentation |
| `npm run test:compact` | Compact exports, import validation and conditional source requests |
| `npm run test:security` | Flag triggers, source highlights, navigation and review dialogs |
| `npm run test:activity` | Applied-rule state and navigation lifecycle |
| `npm run test:toasts` | Notification delivery, expiry and recovery |
| `npm run test:interception` | Fetch/XHR, modifiers, CSP, matching, cancellation and wrapper compatibility |
| `npm run test:upgrade -- <previous-release.zip>` | Same-folder update preserving rules, sources, activation and preferences |
| `npm run test:performance -- <baseline.zip> <candidate.zip>` | Checksum-verified archives, alternating runs, stopped service workers and warm preloads, hidden tabs, 64 KiB/4 MiB JS, background workers, page/CSS rules, and dynamic fetch/sync XHR |

See [development setup](development.md) for Chromium installation and executable overrides, and [releases](releases.md) for archive verification.

Automated accessibility scans supplement manual keyboard, screen-reader and device testing. Synthetic fixtures do not establish compatibility with every website, JavaScript pattern or custom theme.

The extracted release check also covers the visible extension version, appearance controls and keyboard focus, light/dark accessibility scans and narrow layouts.

It also exercises the real MAIN and sandbox execution contexts, including request/response modifiers, page rules, file transformers, inline and Blob replacements. It checks that privileged Chrome methods are unavailable, that CSP fallback uses the sandbox and cannot read the parent DOM, and that real content-script senders cannot invoke private configuration operations. These checks support the execution-context disclosure; they do not predict Store acceptance.

For a predeclared confirmation of a first-navigation cold-start timing signal, use `npm run test:performance -- --confirm-cold <baseline.zip> <candidate.zip>`. It runs exactly 20 fresh-browser pairs with balanced order, retains the normal cold-start sequence and thresholds, and records paired timing differences separately from the full suite.

The performance runner uses disposable profiles and leaves raw samples under `.artifacts/performance/`. Run it without other test suites or heavy tasks. It checks median and p95 against limits fixed before measurement (10% or 10 ms at the median, 20% or 20 ms at p95). Passing establishes equivalence only within those limits and fixtures, not exact timings or compatibility with private rules. Defaults are six alternating rounds and four warm samples per cold navigation. Cold navigation, immediate follow-up and steady-warm timings are separate; an explicit priming navigation is retained in the report but excluded from timing comparisons. The published baseline's startup cache-refetch failures remain visible in `startupChecks`; the candidate must avoid them, and every steady-warm sample requires zero original downloads and the same worker as the priming navigation. `SFVI_BENCH_ROUNDS` and `SFVI_BENCH_WARM_SAMPLES` can shorten a harness check; short runs are not release evidence. The parser-boundary result is recorded separately because the existing engine does not guarantee parser-blocking replacement order.
