# SFV Interceptor privacy policy

Last updated: October 20, 2026

SFV Interceptor is maintained by [thomrnowtea](https://github.com/thomrnowtea). It lets you apply rules to web requests, responses, JavaScript, CSS, and pages. This policy covers the extension distributed from the [project repository](https://github.com/thomrnowtea/sfv-interceptor).

## Data used by the extension

The extension processes website URLs, request methods, headers, request and response bodies, and page or resource content as needed to match and apply your enabled rules. Depending on the website and rule, this content can include personal information, authentication tokens, or other sensitive data. The extension does not build a browsing-history database.

Enabled API rule configuration is delivered to pages where the extension has access so requests can be matched and modified locally. The page execution environment is shared with the website: website scripts can observe or interfere with that configuration, rule code, and execution indicators. These indicators are not a security attestation.

Rules, their code and versions, URL patterns, source URLs, downloaded source snapshots, activation choices, and interface preferences are saved in your browser profile. Source URLs may contain access tokens in their query strings. Source update timestamps, validators, and error messages are also saved locally. The extension does not provide its own encryption for this stored data.

Temporary page activity records identify which rules ran in each tab. These records use browser session storage and are reset for a new page or execution cycle, removed when a tab closes, and cleared when the extension or browser session is restarted. Original resource content and discovered asset URLs can be cached in memory to apply file replacements. These caches are bounded and disappear when the service worker restarts. Diagnostic messages remain in the local browser console; they are not automatically reported to the maintainer.

## Network connections

SFV Interceptor has no project account system, analytics service, advertising service, or central server receiving your rules or browsing activity. Fonts, editor libraries, and extension interface assets are bundled locally.

Importing rules from a URL makes a request to that URL. Subscribing to a URL makes periodic requests to it, including while the dashboard is closed. Configured source URLs must use HTTPS. Source requests omit cookies and referrer information; later requests may send the server's previous ETag to check for changes. The source server and any redirect destination can receive your IP address, the requested URL including its query string, and normal request metadata. The extension does not upload your local rules or unrelated browsing activity with these checks. Source operators control their own logs and privacy practices.

Page and file rules may fetch the current page or original assets to locate or transform matching files. These requests go to the relevant website or resource server. A same-origin request made from the page to retrieve an original asset may include that site's cookies. API rules can change the destination, headers, or body of a website's requests as configured by you.

Opening the repository, support, or privacy links connects to GitHub. GitHub handles those visits under its own [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## JavaScript rules and subscriptions

JavaScript in an enabled rule can read or change the page, access page data available to JavaScript, and make network requests. Those requests may send data to destinations chosen by the rule author. Page access remains subject to the browser's applicable restrictions. Such rules do not receive direct access to privileged extension APIs.

This applies to rules you write, import, or subscribe to. Subscription updates can change code in enabled rules without another manual import. Read-only subscription content means you cannot edit the publisher's copy; you can still turn each rule off or unsubscribe. Only use rule sources you trust.

## Use and sharing

The extension uses data to provide the rule-editing, synchronization, matching, modification, and execution-status features you choose. The maintainer does not receive, sell, or use your rules or browsing data for advertising, tracking, credit decisions, or unrelated purposes. Data can leave your device through the website requests and rule-controlled connections described above, or when you choose to export and share rules.

SFV Interceptor's use of information received from Chrome APIs follows the Chrome Web Store User Data Policy, including the Limited Use requirements. Access and transfers are limited to the extension's disclosed functionality. The maintainer has no remote access to your stored extension data.

## Your choices and retention

You can turn rules off, delete local rules, and remove subscriptions in the dashboard. Removing a subscription deletes its stored source configuration, snapshot, and activation preferences. It does not delete separate local copies or exported files. Turning a rule off cannot undo code that has already run; refresh the affected page to start a new page session.

Saved extension data remains in your browser until you delete it or remove the extension. You can restrict website access through Chrome's extension settings or disable the extension. Exported JSON files remain wherever you save them and can contain sensitive rule content; deleting a rule in the extension does not delete its exports. Browser or device backups are controlled separately by you and your browser or operating-system provider.

## Contact and changes

For privacy questions, contact the maintainer through the [project's issue tracker](https://github.com/thomrnowtea/sfv-interceptor/issues). Public issues do not require you to share private rules or credentials. Changes to this policy will be published here with an updated date. Material changes to data handling will also be disclosed with the relevant extension update.
