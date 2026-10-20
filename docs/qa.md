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

It also exercises MAIN and sandbox execution contexts, including request/response modifiers, page rules, file transformers, inline and Blob replacements. It checks that rule code cannot access privileged Chrome methods, that the CSP fallback uses the sandbox and cannot read the parent DOM, and that content scripts cannot invoke private configuration operations.

The performance runner uses disposable profiles and writes results under `.artifacts/performance/`. Run it without competing test suites or heavy tasks. It compares median and p95 timings for cold navigation, follow-up navigation, and warm resources. The `--confirm-cold` option runs 20 fresh-browser pairs with balanced execution order. `SFVI_BENCH_ROUNDS` and `SFVI_BENCH_WARM_SAMPLES` can shorten a harness check. Passing applies to the measured fixtures and thresholds; it does not guarantee exact timings or compatibility with every website.
