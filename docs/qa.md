# Quality checks

The project has Node-based unit tests, syntax and manifest checks, release-package verification, and optional Chromium browser suites. Browser suites use isolated profiles and synthetic fixtures; they do not require accounts, private rules, or access to a personal browser session.

Run the core checks with:

```sh
npm test
npm run check
npm run package
npm run test:release
```

The browser suites cover the dashboard, popup, responsive layouts, keyboard behavior, themes, accessibility scans, response formatting, subscriptions, and page activity:

```sh
npm run test:browser
npm run test:ui
npm run test:popup
npm run test:formatter
npm run test:activity
npm run test:toasts
npm run test:compact
npm run test:security
```

Browser checks require the development dependencies and a local Playwright Chromium installation. See [development setup](development.md) for details. Automated accessibility scans help catch regressions but do not replace manual assistive-technology testing.

## Code review flags — 2026-10-17

The scoped review corrected missing reference-dialog insets, singular counts, low-contrast secondary flag text, and custom-theme editor line numbers. It also corrected save review opening at its bottom when many flags were present: the heading and actions now stay visible while only findings scroll. Screenshots are inspected in addition to automated geometry checks; a previous scan passed despite the reference text touching the dialog edge.

| Check | Evidence / result |
| --- | --- |
| All 16 flags, individually | Positive triggers, independent expected source spans, every occurrence, severity paint, accessible labels and nearby negative examples passed; `.artifacts/security/flag-matrix.json`. |
| All flags together | Default, light and custom themes at 1440px and 320px; reference start/end and save review. |
| Reference layout | 20px desktop / 16px narrow insets; no outer or horizontal scroll; one scrollable catalog; keyboard reaches its last item. |
| Save-review layout | Heading receives initial focus; heading, consent and actions remain visible while findings scroll; no outer or horizontal scroll. |
| Dashboard root scroll | Hidden flag descriptions stay contained by their risk panel. A 900px-high fixture previously produced a 1552px document (652px empty root scroll); after containment the document remains 900px. Request/response, static JS, read-only, narrow layouts and zoom retain a visible footer and zero root scroll. |
| Real browser zoom | 150% and 200%; reference stays within the viewport with reachable close control. |
| Accessibility | 30 axe scans, zero violations within flag panels, code editors and reference/save dialogs; raw results retain outside-scope findings. |
| Measured contrast | Minimum badge text 5.38:1; sampled highlighted code 5.51:1 across tested themes. |
| Behavior | 117 Node tests and 16 security-browser scenarios passed; no page errors or failed extension requests. The broader UI regression suite also passed. |

Reproduce with `npm test`, `npm run check`, `npm run test:security`, and `npm run test:ui`. The security suite writes `results.json`, `flag-matrix.json`, axe output and screenshots under `.artifacts/security/`. Useful visual samples are `reference-all-default-1440-top.png`, `reference-all-light-320-top.png`, `reference-zoom-1.5-top.png`, and `reference-zoom-2-bottom.png`.

These results cover synthetic fixtures in Chromium, not arbitrary custom colors, a screen reader, or every possible JavaScript spelling. Existing custom-theme contrast findings in navigation metadata, subtitles and editor hints outside the changed scope remain recorded. This is not a claim of whole-application WCAG conformance or proof that flagged code is malicious.
