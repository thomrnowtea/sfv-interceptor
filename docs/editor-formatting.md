# Editor formatting

Format and Alt+Shift+F use Prettier 3.9.10's standalone browser API. The core and Babel, ESTree, HTML, and PostCSS plugins are bundled under `shared/vendor/prettier/`, with their MIT license. They load lazily from extension-local ES modules. No CDN, build step, extra manifest permission, or CSP relaxation is required. See [Prettier's browser API](https://prettier.io/docs/browser).

## Parser policy

| Editor body | Language |
| --- | --- |
| Dynamic request or response | JavaScript / Babel |
| Static request | Strict JSON |
| Static REST or GraphQL response | Strict JSON |
| Static HTML-resource response | HTML, JavaScript, or CSS according to resourceSubtype |

`bodyLanguage` resolves context at invocation for both toolbar and keyboard actions. JSON.parse checks validity only; its parsed value is discarded. Prettier always receives the original source string, retaining large integer digits, duplicate keys, and other information that JSON.parse/stringify would lose. Plain text and malformed JSON produce a concise error with the original body preserved; they are never retried as JavaScript.

Formatting uses two spaces, an 80-column print width, LF endings, and Prettier's remaining defaults, including semicolons and trailing commas. Embedded script/style content is supported by the locally included plugins. Empty or whitespace-only bodies are no-ops. Opening an editor automatically presents readable code, including read-only remote rules. Format and Alt+Shift+F update only that presentation. Neither automatic nor explicit formatting changes the backing value, storage, or dirty state. Invalid automatic presentation stays quiet and retains the original view; explicit formatting reports its error.

## Editor publication

`formatter.js` owns parser selection and source formatting. `editor.js` owns publication to CodeMirror or the textarea fallback. `editor-events.js` supplies the current body/resource context. The same asynchronous command handles buttons and keyboard shortcuts; CodeMirror key handlers remain synchronous and return immediately.

A formatting attempt captures its mounted element/view, immutable CodeMirror document and selection, monotonic content revision, writable state, and context revision. Publication requires those identities to remain current. Changes to resource/body mode or starting a save increment the context revision, including changes away and back. A per-target busy set prevents overlapping attempts. Stale errors are ignored along with stale results. Detached controls cannot re-enable or modify a newly opened rule. Automatic presentation may render a read-only view; explicit commands remain disabled there.

Each mounted editor tracks its backing value separately from the visible document. `getEditorValue` supplies that backing value to save/dirty/security operations. Actual edits and template insertion update it; presentation transactions are explicitly marked `format.presentation` and update only visible text. Presentation-to-backing correspondence restores the original value when a user undoes an edit to its formatted baseline, so the rule becomes clean again.

Prettier maps both endpoints of the editor's single selection, preserving reversed selection direction. Automatic presentation uses `Transaction.addToHistory(false)`. Explicit Format remains visually undoable without changing the backing value; undo across formatting and actual edits is tested. This avoids erasing edit history by mapping an entire manual document replacement outside history. The checked-in bundle exposes Transaction through an EditorState transaction's constructor; `addToHistory` is its public API. The command preserves scroll position and does not take focus when the asynchronous result arrives. No-op results create no transaction. The hidden textarea mirrors visible text for risk presentation; dirty/risk callbacks run only for actual edits.

The plain textarea fallback preserves selection/scroll and tracks input revisions to reject stale edit-back results. Its formatting changes visible text without emitting a content-change notification. Native fallback undo is not guaranteed; the tested undo/redo contract applies to the bundled CodeMirror editor. JavaScript syntax highlighting remains an independent CodeMirror configuration, not evidence of which Prettier parser a body uses.

## Compact save and export

`dashboard/editor/compact.js` lazily loads the local Terser public API for dashboard save/import/download operations. Compression and name mangling are disabled; function-body parsing accepts bare returns. Invalid JavaScript refuses the whole operation with a rule/field/location error and leaves existing data untouched. A lossless JSON whitespace pass compacts valid API/request bodies and headers without JSON.parse/stringify round-tripping. Plain text and static HTML/CSS are preserved.

The selected and full export paths share `dashboard/ui/exports.js` and serialize compact portable copies with `JSON.stringify` without indentation. Required newlines inside JavaScript template literals remain part of the string and are escaped in the exported JSON, which occupies one physical line. Neither export nor presentation rewrites a remote snapshot. The minifier is absent from the background static module graph, navigation and polling: interception never waits for formatting or minification. No permission or CSP changes are needed. Source-sensitive code that inspects Function.toString or comment directives can observe minification; original remote/historical snapshots remain preserved.

## Verification

Seven Node tests cover JavaScript AST equivalence for regex/template/for syntax, strict/raw JSON edge cases, body language selection, HTML/CSS with embedded content, invalid input, empty bodies, and reversed selection mapping. Nine browser scenarios verify the real extension under MV3 CSP, official Prettier output, toolbar/shortcut behavior, CodeMirror undo/redo and dirty state, asynchronous edit/caret/context/rule races, read-only enforcement, and fallback notifications.

Run `npm test`, `npm run test:formatter` and `npm run test:compact`. These check presentation/backing values, formatting and undo, save/import validation, portable downloads and preservation of remote storage. See [quality checks](qa.md).
