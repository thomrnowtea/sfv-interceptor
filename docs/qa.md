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

See [development setup](development.md) for Chromium installation and executable overrides, and [releases](releases.md) for archive verification.

Automated accessibility scans supplement manual keyboard, screen-reader and device testing. Synthetic fixtures do not establish compatibility with every website, JavaScript pattern or custom theme.
