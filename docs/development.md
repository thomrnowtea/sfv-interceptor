# Development

Project guidance lives in this directory and works with any assistant or editor. Local agent instructions and personal configuration remain untracked. No personal knowledge vault or editor setup is required to build or test the extension.

## Running

Load the repository root as an unpacked extension in Chrome's extensions page. There is no compilation or server step. Reload the extension after service worker or manifest changes, close and reopen its popup, and reload an existing dashboard tab. Version 1.3 adds the `alarms` permission for background subscriptions. The packaged theme module and Manrope font are explicitly listed as web-accessible resources for content-script presentation; this adds no host permission.

Also reload ordinary host pages after changing `page-hook.js` or `content.js`: an already installed MAIN hook is not replaced by reloading the extension alone.

## Verification

Use Node 22 or later:

```sh
npm ci
npm test
npm run check
npx playwright install chromium
npm run test:browser
npm run test:ui
npm run test:popup
npm run test:formatter
npm run test:activity
npm run test:toasts
npm run test:compact
```

Loading the extension does not require `node_modules`. CodeMirror, Prettier, Terser, and the font are bundled locally. Development dependencies provide their update sources, Chromium automation, axe accessibility checks, and AST inspection. `node scripts/vendor-terser.mjs` regenerates the checked-in minifier for maintenance; it is not a runtime build step. Preserve the adjacent licenses when updating.

`npm test` runs isolated Node tests covering migration, versions, display fallbacks, theme resolution, read-only enforcement, source isolation, snapshot replacement and recovery, concurrent updates, alarms, exports, literal/wildcard file matching, DNR application, and local asset precedence. The Chrome API fake is in `tests/helpers/chrome.js`.

`npm run check` checks JavaScript syntax and the manifest. `node scripts/complexity.mjs <files...>` reports decision counts for functions at or above six; count is one plus branches, loops, catches, ternaries, and `&&`/`||`. Nested functions are counted separately.

`npm run test:browser` loads the real extension into a new isolated headless Chromium profile. It drives editing, remote subscriptions, failures, imports, popup, themes, keyboard/focus behavior, and narrow layouts. Feed responses are deterministic fixtures; no credentials or external account are required.

`npm run test:ui` adds legacy seven-rule fixtures and a remote source with long metadata. It checks bounded popup geometry including an error state, expanded narrow navigation, scoped selection, security and risk dialogs, actual Chrome tab zoom at 150% and 200%, and in-page toast typography, stack bounds, whole-card dismissal, keyboard behavior, the 5-second default, hover expiry, keyboard-focus pause, synchronized progress, five resource colors across seven preset/custom variants, contrast, and reduced motion under strict page CSP. This runner opens the popup document in constrained tabs; native toolbar hosting is covered separately.

`npm run test:popup` requires a desktop display. It launches headful isolated Chromium with no viewport override, calls `chrome.action.openPopup`, and attaches to that native panel through CDP. It verifies `chrome.extension.getViews({type:'popup'})`, initial sizing, reopening, empty/many-rule/theme/error states, an actually applied rule, footer reachability, and the dashboard action. It catches sizing cycles that a fixed-size tab fixture cannot detect.

`npm run test:formatter` loads the real dashboard and local Prettier plugins under MV3 CSP. It checks toolbar and shortcut language selection, separate backing/presentation values, cursor/selection mapping, clean formatting, CodeMirror undo/redo, async races, read-only protection, and fallback presentation without content notifications. See [editor formatting](editor-formatting.md).

`npm run test:compact` verifies pretty pasted saves, file/URL imports, invalid JavaScript preservation, selected/full downloaded JSON, unchanged remote storage, universal suffix-free GET/ETag/304 sources and the resource subtype selector in both themes. It measures six type/theme text contrasts and scans desktop plus 375px layouts with axe. Synthetic feeds and rules require no private links or credentials.

Remote activation regressions in `tests/remote-activation.test.js` cover persistent local choices, publisher defaults, exact/special IDs, concurrent sync/toggle, effective file-pattern validation, timeout/unsubscribe and publication errors. The functional browser runner exercises keyboard switches across dashboard/popup while content stays locked. The compact runner checks 304/reopen persistence, narrow drawer access and authoritative UI state after failed publication. The native popup runner also switches a remote rule off/on and verifies six actual toolbar states.

All runners own isolated profiles and do not attach to a personal browser. On Windows, they can reuse installed Playwright Chromium. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to choose another compatible Chromium binary. `.artifacts/` contains screenshots, axe JSON, measurements, and isolated profiles; it is excluded from Git. See [QA results](qa.md) for coverage limits.

`npm run test:activity` uses a local HTTP fixture server and the actual extension. It verifies fetch/XHR success/failure, delayed delivery, type-colored notices, active-tab popup state, reload/iframe navigation, unchanged/changed configuration, pending stale results, and page/JS/CSS injection. It includes light/dark axe scans. Back/forward evidence records whether Chrome actually restored from BFCache. See [rule activity](rule-activity.md).

## Release packaging

`npm run package` generates the versioned extension ZIP and SHA-256 file under ignored `dist/`. `npm run test:release` verifies and loads the extracted archive in an isolated browser. Only explicitly allowlisted runtime files and license notices ship; agent instructions, developer tooling, tests, documentation, private/test rules and profiles remain outside the ZIP. See [releases](releases.md) for the file policy, version checks, installation/update instructions and automatic GitHub tag workflow.

## Bundled font and optional design tooling

`npm run docs:images` regenerates the README cover and two interface captures under `docs/assets/`. It renders the original logo, bundled Manrope and exact default theme tokens, then captures the actual packaged dashboard/popup in an isolated profile with synthetic `example.com` rules. The cover is static HTML/CSS; CDP verifies the rendered heading uses the custom Manrope face. Supporting measurements stay in `.artifacts/readme/`. Documentation images and the generator remain outside the extension ZIP.

The Latin Manrope asset comes from `@fontsource-variable/manrope`, with its SIL OFL license retained. Update the checked-in WOFF2 and license together when updating the package. The extension loads its assets locally and has no runtime dependency on Fontsource or a font CDN.

Optional design references include [Emil Kowalski's skills repository](https://github.com/emilkowalski/skills). No design skill, assistant plugin, or personal tool installation is required to build, load, or test the extension.
