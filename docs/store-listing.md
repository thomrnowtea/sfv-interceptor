# Chrome Web Store listing

English listing text matching the current English interface. This is preparation for the developer dashboard; it does not publish an item. Include the [execution explanation](#reviewer-explanation) and read the [policy assessment](store-compatibility.md) before submitting the current package.

## Listing fields

| Field | Value |
| --- | --- |
| Name | SFV Interceptor |
| Summary | Mock REST and GraphQL responses, replace JS and CSS files, and inject page code. |
| Category | Developer Tools, using the corresponding category available in the dashboard |
| Default language | English |
| Price | Free |
| Homepage | `https://github.com/thomrnowtea/sfv-interceptor` |
| Support | `https://github.com/thomrnowtea/sfv-interceptor/issues` |
| Privacy policy | `https://github.com/thomrnowtea/sfv-interceptor/blob/main/PRIVACY.md` |

### Detailed description

Copy the following plain text into the description field:

```text
SFV Interceptor lets you test and customize website behavior with rules you control.

• Replace REST and GraphQL responses with your own content, status codes, headers, and delays.
• Modify requests and responses with JavaScript.
• Replace JavaScript and CSS files, and run page code on matching URLs.
• Create, edit, version, search, and export local rules. Import JSON from a file or HTTPS URL.
• Subscribe to rule URLs for background updates. Subscribed content follows its publisher; you control each rule's activation.
• Manage rules in the dashboard and use the popup to search, switch rules on or off, and see which rules ran on the current page.

The extension uses website URLs and selected request, response, and resource content to apply your enabled rules. Rules and settings stay in your browser. There is no project account, analytics service, or central rules server. Subscriptions connect to the URLs you add; page/file rules may retrieve original website resources.

JavaScript rules can access page data and make connections chosen by their author. Source updates can change code in enabled rules. Only use rules and sources you trust. You can restrict website access in Chrome's extension settings.

Source code, support, and the privacy policy are available in the project repository.
```

The short summary is also the manifest description. It stays within the store's 132-character limit. Do not add download rankings, security guarantees, a claim of store approval, or slogans.

## Images

Use these files in this order. Both screenshots measure 1280 × 800 pixels.

![Dashboard showing synthetic account, product, JavaScript, and CSS rules with a formatted response modifier](assets/store/dashboard.png)

![Chrome displaying a dark Example Domain page with the native SFV Interceptor popup open and synthetic rules](assets/store/popup.png)

| Dashboard field | File | Dimensions |
| --- | --- | --- |
| Store icon | [icon128.png](assets/store/icon128.png) | 128 × 128; logo centered at 96 × 96 with transparent padding |
| Screenshot 1 | [dashboard.png](assets/store/dashboard.png) | 1280 × 800 |
| Screenshot 2 | [popup.png](assets/store/popup.png) | 1280 × 800 |
| Small promotional tile | [small-promo.png](assets/store/small-promo.png) | 440 × 280 |

The optional marquee and video are not required for this submission. Assets use the existing logo, bundled Manrope, and default palette. They contain no personal rules, accounts, browser profiles, or test-site tokens.

Generate the dashboard, promotional tile, and store icon with `node scripts/store-assets.mjs`. Run `node scripts/store-assets.mjs --native-popup` to open the real popup in an isolated visible browser, then capture that browser window at 1280 × 800 into `docs/assets/store/popup.png`. Close the helper with Ctrl+C. This process never opens a personal browser profile.

## Reviewer explanation

Use this in the private review instructions or remote-code justification, wherever the developer dashboard provides the applicable field. It describes the production engine, not the experimental debugger/userScripts preview. It is a proposed justification, not confirmation from Google.

```text
SFV Interceptor is a developer tool for applying user-configured request, response, page, JavaScript-file, and CSS-file rules. The package contains the complete matching, interception, storage, subscription, and interface implementation. It ships without a preconfigured rule feed or site-specific patches. Users write rules, import them, or explicitly add an HTTPS source whose rules are periodically updated.

Rules may contain executable JavaScript, including code received through subscriptions. We disclose that behavior rather than treating these documents as non-executable configuration. User code runs in the website's MAIN JavaScript context, or in the packaged sandbox for supported API transformations. It is not evaluated in the extension service worker, popup, or dashboard and does not receive privileged extension APIs.

The packaged MAIN interceptor wraps fetch/XMLHttpRequest and compiles selected user request/response functions with Function. Packaged page/file callbacks also compile user transformers in MAIN. File rules can retrieve an original resource, transform its text, and install the final JavaScript through an inline or Blob script, or the final CSS through a style element. Thus both the transformer and resulting JavaScript execute in the website context. The sandbox is a separate execution path; its isolation is not offered as an exemption for subsequent page execution.

We submit these contexts for assessment under the MV3 exemption for code isolated from extension APIs. The content-script bridge requests API rule configuration and reports rule application; it does not expose an arbitrary extension API call mechanism. Rule configuration changes, imports, exports, and source management are restricted to extension-page messages. A fixed content-script bridge also records rule-application activity; these page-originated reports are not a security attestation. The extension has no telemetry, project backend, or maintainer-controlled automatic executable updates outside extension releases. User-selected sources can update their own enabled rule content, as disclosed in the interface and privacy policy.

No project account or private rules are necessary for review. Open the toolbar popup and select Open dashboard. Create local rules using your own test website: a static REST response, a dynamic response using the editor template, a page rule, and static/dynamic JS and CSS file replacements. Save and enable the rules, then reload the matching page for page/file changes. Toggle rules from the popup; inspect and edit them in the dashboard. Import/export uses JSON. Sources accepts an HTTPS URL responding directly with a rule array or a rules envelope; subscribed content is read-only and each rule's activation remains locally adjustable.
```

The execution entry points are `page-hook.js`, `sw/handlers/execute.js`, `sw/handlers/navigation.js`, `content.js`, and `sandbox/sandbox.js`. Source retrieval and validation are in `sw/core/sources.js` and the shared schema modules. Permission justifications and data disclosures are in [privacy and permissions](store-privacy.md). Do not include personal rules or login sessions in the submission.

## Submission

Use the [privacy and permission entries](store-privacy.md) in the Privacy practices tab. The homepage and privacy URL must resolve publicly after the relevant files are pushed. Upload the runtime ZIP produced by `npm run package`, rather than GitHub's automatic source archive. Store artwork and submission documents remain outside that runtime ZIP; the user-facing policy is included.

The publisher must register or use a Chrome Web Store developer account, enable two-step verification, and verify the contact email in that account. A contact email is not invented in this repository. Set distribution in the developer dashboard and inspect the listing preview before submitting for review. No store item ID or store installation URL exists until an item is created.

## References

- [Complete the listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Required images and dimensions](https://developer.chrome.com/docs/webstore/images/)
- [Listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements)
- [Developer account registration](https://developer.chrome.com/docs/webstore/register)
