# User-code execution and Chrome Web Store

The current extension supports code supplied through local editing, imports, and automatically updated subscriptions. These features must be preserved when preparing a store version. The production manifest currently requests neither `debugger` nor `userScripts`. Experimental execution backends are not the production package.

## Active release scope

The only active 1.3.3 candidate is the repository-root runtime, retaining the production MAIN/sandbox engine. The former userScripts/debugger prototypes are retired and excluded from this release. Do not restore their permission prompts, navigation preparation pages, or execution backends.

## Submission approach

Prepare the submission around the existing engine and disclose its execution paths. A mandatory migration away from MAIN-world user-code execution has not been established. Do not add a slower backend solely on that assumption, or claim that the existing engine has already been approved.

Review concerns the extension's capabilities, sources of executable code, execution contexts, permissions, and data handling. Review instructions should use neutral examples and cover every supported rule type. No personal rules, accounts, or particular third-party bundle are required. User authorship explains the product's purpose; it does not by itself establish a policy exemption.

The public Requestly implementation is a relevant technical precedent: its [packaged interceptor is registered in MAIN at document_start](https://github.com/requestly/interceptor/blob/master/browser-extension/mv3/src/service-worker/services/clientHandler.ts), its [request/response modifiers compile user code with Function](https://github.com/requestly/interceptor/blob/master/browser-extension/mv3/src/page-scripts/ajaxRequestInterceptor/utils.js), and its [manifest](https://github.com/requestly/interceptor/blob/master/browser-extension/mv3/src/manifest.chrome.json) requests neither `debugger` nor `userScripts`. This source inspection is not access to Requestly's submitted binary or review correspondence. It does not establish approval of SFV Interceptor's separate page/file paths.

The proposed justification is the policy's exemption for code isolated from extension APIs, applied to website MAIN execution and the sandbox. Identify those contexts explicitly, including generated JavaScript replacements; do not describe executable subscriptions as mere JSON data. Whether the reviewer accepts that application of the exemption remains unconfirmed. See the [reviewer explanation](store-listing.md#reviewer-explanation).

## Policy boundary

The [MV3 policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements) distinguishes remote data from executable logic. A JSON response can contain executable JavaScript; changing its encoding, saving it locally, or describing it as configuration does not change what the extension executes. Minification alone is permitted; disguising execution is not a solution.

The policy identifies `userScripts` and `debugger` as permitted APIs for remote execution within their documented purposes. Their exceptions apply to the relevant execution paths, not every other evaluator in the extension. Sandboxed contexts have an additional exemption with reviewability and privacy obligations.

Current MAIN-world code does not receive ordinary privileged extension APIs. This is the basis for the proposed exemption argument, rather than an approval already obtained. Account for each execution context independently; the sandbox's exemption does not automatically cover code subsequently executed elsewhere.

## Current execution inventory

| Source and sink | Current implementation | Consequence |
| --- | --- | --- |
| Dynamic request/response code | `page-hook.js` compiles rule strings with `Function` in MAIN; asynchronous paths can fall back to the sandbox for compilation restrictions | Both the MAIN evaluator and fallback require separate accounting. |
| Synchronous XHR modifier | MAIN function executes in the calling stack | A message/worker round trip cannot replace this synchronous call. |
| Sandboxed modifier | `sandbox/sandbox.js` compiles code in its own page and returns serialized data | It has its own globals and document; it cannot preserve arbitrary access to the website's JavaScript state. |
| Page rule | `applyPageRule` compiles the rule body inside a packaged `scripting.executeScript` callback | The outer packaged callback does not make the supplied rule code packaged logic. |
| Dynamic file transformer | `applyAssetRule` compiles a transformer and supplies original JS/CSS text | The transformer is code even when it returns CSS or other data. |
| Static or transformed JS replacement | `installScript` inserts inline JS or loads a Blob script | The replacement body is another executable stage, including a body returned by a sandbox. |
| Static API/headers/CSS | Packaged matching, response construction, and style installation consume data | These operations can remain packaged, provided they do not reinterpret a result as JavaScript. |

## Isolation and review evidence

The content-script bridge uses fixed operations to deliver matching API configuration and presentation assets and report activity. Rule configuration changes, imports, exports and source management require extension-page senders. It does not dispatch arbitrary Chrome API calls for page code.

MAIN is shared with the website: a page can inspect or interfere with the hook and forge page-originated activity reports. Those reports are a convenience indicator, not a security attestation. Website JavaScript remains subject to its applicable CSP and origin restrictions.

The submission describes every evaluator and both stages of JavaScript-file replacement. The exemption argument concerns each actual execution context, rather than the file format of a subscription or the authorship of the code. Runtime checks must confirm unavailable privileged APIs in MAIN and the sandbox, successful data-only sandbox replies, and rejection of private configuration operations from content scripts.

Before submission, validate the packaged ZIP, user-data declarations, public privacy URL and listing artwork, and obtain the publisher's own browsing test result. Tests establish behavior and isolation; the Chrome Web Store decides acceptance during review.
