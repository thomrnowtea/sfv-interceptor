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
```

Browser checks require the development dependencies and a local Playwright Chromium installation. See [development setup](development.md) for details. Automated accessibility scans help catch regressions but do not replace manual assistive-technology testing.
