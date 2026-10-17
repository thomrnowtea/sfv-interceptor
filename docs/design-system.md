# Interface design

SFV Interceptor is a desktop web utility with responsive layouts. Its visual direction uses quiet surfaces, a clear primary action, segmented filters, predictable dialogs, and short feedback transitions. Apple and Emil Kowalski references inform those interaction choices. The extension retains its own original dark palette and uses the user's requested Manrope typography.

## Sources of truth

- `shared/themes.js`: preset definitions, custom color generation, and stored-theme resolution used by dashboard, popup, and content scripts.
- `shared/theme.css`: bundled font, baseline tokens, focus, press feedback, and motion preferences.
- `dashboard/dashboard.css`: workspace, editor, dialogs, and narrow navigation.
- `popup/popup.css`: bounded quick-access panel.
- `page-hook.js`: isolated in-page notification presentation; receives the same normalized theme from `content.js`.

Named presets resolve from their current definitions, ignoring obsolete persisted variable snapshots. Explicit light and custom choices remain supported. A custom choice can resolve in the popup and content script without first opening the dashboard.

## Typography and scale

Manrope variable weights 200-800 are bundled in `shared/fonts/manrope-latin-wght-normal.woff2` (24,836 bytes). Most interface copy uses 400 and 600. The dashboard preloads the font; the popup uses the same local CSS face. The SIL Open Font License is retained as `shared/fonts/Manrope-LICENSE.txt`. There are no external font requests. Code uses the platform monospace stack in `--mono`.

| Role | Value |
| --- | --- |
| Dashboard title | 23px / 600 |
| Section and dialog title | 15-16px / 600 |
| Dashboard rule name and controls | 13px |
| Popup rule name | 12px / 600 |
| URL and secondary copy | 11-12px |
| Compact version badge | 10px, tabular numbers, full value available in title |
| Control radius | 7-9px |
| Dialog radius | 18px |
| Main horizontal inset | 34px desktop; 16-20px narrow |
| Fine-pointer button heights | 28-38px according to role |
| Narrow/coarse main controls | 44px minimum effective target |

Local sidebar rows use two text lines: name, then URL and version. Remote rows add their source and a read-only indicator. Complete ordinary versions are displayed without a dangling `v`. Legacy or malformed display snapshots fall back to `1.0.0`. Names, patterns, versions, and source metadata are escaped; long values have bounded text and recoverable title text.

## Palette

The default matches the original repository's dark palette. Contrast-specific action and link colors are separate from the brand accent so small text stays readable.

| Token | Default dark | Light |
| --- | --- | --- |
| `--bg` | `#0f1117` | `#f5f5f7` |
| `--sidebar` | `#141519` | `#ededf0` |
| `--surface` | `#1c1e26` | `#fdfdfe` |
| `--surface2` | `#22252f` | `#f1f1f3` |
| `--surface3` | `#292c38` | `#e7e7eb` |
| `--accent` | `#5b73ff` | `#0066cc` |
| `--accent-action` | `#4a60dd` | `#0066cc` |
| `--accent-link` | `#a4b2ff` | `#005bb8` |
| `--text` | `#e2e4f0` | `#1d1d1f` |
| `--text2` | `#c0c4d8` | `#424245` |
| `--text3` | `#939bb5` | `#5c5c60` |
| REST type | `#22d3ee` | `#0e7490` |

The main canvas uses `--bg`; the editor header uses `--surface`. CodeMirror retains the original dark surface family, with readable syntax and gutter foregrounds. Resource badge colors communicate type; text labels also identify each type. Selected subtype buttons share the badge tokens: blue HTML, violet CSS and amber JS, including the corresponding light-theme ink/tint. Selected weight and `aria-pressed` accompany color, and hover retains the selected tint. REST uses cyan for badges and toast markers/progress bars, leaving green to indicate successful application on the current page. Applied rows retain their green/black status treatment across all resource types. A checked toggle uses the brand accent. Status text stays neutral and readable; decorative status colors do not carry the message alone.

## Layout and ownership

The popup root supplies explicit intrinsic dimensions of 360 x 500px for Chrome's native size negotiation. Its body then fits the available viewport, bounded by those dimensions. Never constrain the root by a percentage or viewport maximum during negotiation: Chrome initially provides 25 x 25px, creating a sizing cycle. Header, filters, search, error band, and footer do not shrink. Only the remaining rule list scrolls. Narrow/coarse-pointer popup actions wrap deliberately and receive larger targets. Native opening is covered by `npm run test:popup`. Applied rows use a solid green background and black text, black badges with green labels, and black switch tracks with green thumbs in both themes. The named check remains present; enabled state remains independent. See [rule activity](rule-activity.md).

The desktop sidebar defaults to 286px and supports a clamped saved width. At 760px and below, a compact header replaces the permanently expanded sidebar. Browse rules opens a native modal dialog containing the same search, filters, sorting, rules, selection, import, and source controls. Its list receives the remaining height; footer actions remain reachable. Selecting a rule closes the dialog; keyboard selection places focus in the editor. Returning to desktop moves the existing controls back into the sidebar.

Import a copy creates editable local rules once. Sources manages JSON subscriptions with read-only content and configurable background updates. Remote editors expose inspection, source information, and the published version. Both popup and sidebar show a switch for each remote rule; its activation is a persistent local choice. Popup rows only offer activation switches, with no editing or deletion buttons. The existing New rule header action opens creation in the dashboard; Open dashboard leads to rule management and settings. The remote content disclaimer identifies read-only content. Keyboard focus survives switch rerendering, and failed operations reconcile stored truth. Local rules, publisher snapshots and local activation preferences remain separate.

## Interaction and motion

Dialogs have accessible names, contained Tab navigation, Escape, and focus restoration. Security warnings and the risk reference also use native dialogs with bounded content. The reference has 20px desktop / 16px narrow insets around its header and content; only its catalog scrolls while its title and close control remain reachable. CodeMirror has an accessible name and remains keyboard reachable in read-only mode. Appearance choices expose their selected state through `aria-pressed`.

Buttons have brief press feedback; list navigation does not animate. In-page toasts fade in over 180ms and out over 120ms. Hosts do not translate: moving them inside the scroll container created a transient scrollbar even for a single fitting card. The wrapper retains vertical scrolling for tall stacks in short viewports. The default display duration is 5 seconds of unpaused time. The entire card is a named native button: clicking anywhere, Enter, Space, or scoped Escape dismisses it; there is no separate cross. Keyboard dismissal is immediate. A 3px progress bar shows remaining time using the same resource-type token as the marker and a linear transform. Hover does not pause it. Keyboard focus pauses and resumes the progress and expiry budget together. Reduced motion removes transitions and makes countdown updates step once per second. The stack holds at most three cards and retains a focused card. Arrival does not move page focus; a stable polite live region coalesces announcements.

Toast styles live in closed shadow roots with constructable stylesheets. Isolated content loads the packaged font once and passes binary bytes to a fixed `FontFace` in MAIN. Presentation initializes independently of API-rule availability, covering file-only notifications. Theme variables stay on the notification wrapper rather than the host page. REST, GraphQL, HTML, JS, and CSS markers and bars follow their shared theme type tokens; background, text, and border follow the selected preset/custom theme. Page/file execution returns its result immediately; the worker records each success, ensures the hook, and delivers a themed notice in the same document. Notifications use bounded token deduplication and recheck the captured execution snapshot after presentation readiness. A slow modifier does not hold other successes' notices. Transient toast initialization failures do not permanently replace the renderer with a no-op. Strict page CSP and actual rendered Manrope glyphs are covered by the browser probes.

## Verification

Run `npm run test:browser` for functional extension flows, `npm run test:ui` for regression fixtures, and `npm run test:popup` for native toolbar sizing. `npm run test:formatter` verifies the packaged Prettier integration. `npm run test:activity` verifies the green current-page rule state and actual success/failure boundaries. `npm run test:toasts` forces delayed hook readiness, stale configuration/navigation, duplicate deliveries, modifier failure and initialization retry. See [QA results](qa.md) for measurements, captures, review items, and coverage limits. Apple hardware and screen-reader usability require separate verification.

CodeMirror highlighting uses CSS-variable foregrounds. `dashboard/editor/highlight.js` clones the vendored default style's `specs` and uses its constructor's `define` method. Constructor access depends on the checked-in bundle; the adapter validates that shape and never mutates the default instance. Its literal-color mapping describes the vendor palette. See the [CodeMirror highlighting reference](https://codemirror.net/docs/ref/#language.HighlightStyle).

Code review flags use syntax ranges over the displayed document, with severity-colored backgrounds and underlines. Badge buttons expose names, occurrence counts, explanations and navigation independent of color. The reference dialog states each actual trigger. High/Critical flags require review on local save; Medium flags remain informational. See [code review flags](security-flags.md) for the catalog, coverage and limitations.
