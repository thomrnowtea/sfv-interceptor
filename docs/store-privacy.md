# Chrome Web Store privacy and permissions

Submission text for the current extension. The public policy is [PRIVACY.md](../PRIVACY.md). Its URL, once published on the default branch, is:

`https://github.com/thomrnowtea/sfv-interceptor/blob/main/PRIVACY.md`

## Single purpose

Let users test and customize website behavior by applying user-configured rules to web requests, API responses, JavaScript, CSS, and pages.

## Permission justifications

These entries correspond to `manifest.json`. They can be copied into the Privacy practices tab.

| Permission | Justification |
| --- | --- |
| `declarativeNetRequestWithHostAccess` | Blocks original script or stylesheet requests that match enabled file-replacement rules, so the extension can install the configured replacement. Blocking is subject to the website access granted by Chrome. Rules are added or removed when the user changes their rules or a subscribed source updates. The extension does not use DNR feedback or a request log. |
| `storage` | Saves local rules, versions, subscribed source snapshots and update metadata, local activation choices, appearance and ordering preferences. Session storage records the rules applied to each current page so the toolbar icon and popup can display execution status. Data is stored in the browser, not a project server. |
| `alarms` | Schedules checks for rule subscriptions at the interval selected by the user, including when the dashboard is closed, and restores missing schedules when the service worker starts. |
| `scripting` | Installs the packaged request interceptor in permitted pages and frames, sends enabled rule configuration to it, and applies the page and file changes selected by the user. Main-world execution is required to modify the website's own fetch/XHR behavior and page scripts. |
| `webNavigation` | Detects document navigation and frame identity to prepare and apply page/file rules promptly, bind execution status to the correct document, and reset that status when the page changes. It is not used to save a browsing-history database. |
| Host access: `<all_urls>` | Users can define rules for arbitrary websites and resources and import or subscribe to arbitrary HTTPS rule URLs. Host access permits matching page URLs, injecting the interceptor, retrieving original resources for transformations, fetching selected sources, and applying DNR file rules. Users can restrict site access in Chrome. A fixed list of hosts or temporary active-tab access would prevent saved rules from applying automatically on navigation and prevent background checks of arbitrary user-selected sources. |
| Content scripts: `<all_urls>`, all frames, `document_start` | The packaged bridge starts on permitted pages and frames so the service worker can configure the interceptor before page requests. Frame coverage supports API calls made inside frames. It loads no external UI libraries or fonts. |

The standalone `tabs` permission is unnecessary: opening/querying tabs, sending messages, tracking tab closure, and changing the toolbar icon do not require it. Granted host access supplies the URL for supported pages. URL prefill and rule pushes therefore respect site access rather than requesting unrelated tab metadata.

The standalone `declarativeNetRequest` permission is also unnecessary. The host-scoped variant supplies the DNR API needed by file replacements and prevents standalone blocking permission from extending beyond granted site access. Do not request both variants.

## Data usage disclosure

Describe local processing as well as transmission. Do not use a blanket statement that the extension handles no user data. The [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) explicitly includes processing that stays on the device.

| Dashboard data category | Current handling |
| --- | --- |
| Website content | Page/resource content and request/response bodies are processed to apply selected rules. Rule text and imported source snapshots are saved locally. |
| Web history | Current navigation and request URLs are used for matching and URL prefill. No history API or historical browsing database is used. Saved rule patterns and source URLs may identify websites. |
| User activity | Network requests are intercepted for the user's rules. Per-tab rule application IDs are kept for the current execution cycle. The packaged extension does not record keystrokes, pointer movements, or clicks. User-supplied page code can have additional behavior. |
| Authentication information | Selected request headers/bodies, source URL query tokens, and saved custom headers/rule content can contain credentials. Original page traffic follows browser credential rules; subscription GETs omit cookies. No credentials are sent to the maintainer. JavaScript chosen by the user can access page authentication data available to page scripts. |

These are the applicable disclosure categories for the built-in functionality, including local handling. The extension does not independently request names, payment details, health records, private communications, or location. Arbitrary website payloads and user rules may nevertheless contain such information; the policy describes that possibility without claiming that it is technically inaccessible. If the dashboard asks about additional data actually collected in a future version, update these declarations and the policy together.

### Data-use explanation

SFV Interceptor processes URLs and selected website request, response, and resource content on the user's device to apply their rules. Local rules, source snapshots, subscription settings, and preferences stay in the browser. There is no project backend or telemetry. Subscription checks contact only the URL selected by the user and its redirects, without cookies or referrer information. Page/file processing may retrieve original website resources. Rules can redirect website requests or run JavaScript that makes additional connections. The user controls which rules and sources are enabled. Exports are local JSON downloads until the user chooses to share them.

### Limited Use certifications

The packaged extension does not sell user data, use it for advertising, or transfer it for unrelated purposes or credit decisions. Its data handling serves the single purpose above. The public privacy policy includes the Limited Use commitment. Rule authors and source operators are not project data processors; users choose their sources, and rule-controlled connections must be disclosed rather than presented as impossible.

## Reviewer navigation

The dashboard exposes rule content, local versus subscribed ownership, versions, URL matching, and activation. Import and subscription dialogs explain that JavaScript can access page data; subscription updates can change enabled code. The popup provides quick activation and current-page application status. No account, private feed, or credentials are needed to review local rules.

The remote-code declaration must describe the current execution paths accurately. Do not select "No remote code" merely because subscriptions arrive as JSON or because a sandbox exists. [Compatibility research](store-compatibility.md) records the policy boundaries and proposed approach.

Enabled API configuration is delivered to permitted pages for local matching and modification. MAIN is shared with website scripts, which can observe or interfere with that configuration and activity indicators. This does not expose arbitrary privileged Chrome API calls; configuration mutations and source management remain restricted to extension-page senders.

## References

- [Privacy practices fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/)
- [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Minimum permissions and disclosure policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [DNR permission variants](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- [Tabs API and host access](https://developer.chrome.com/docs/extensions/reference/api/tabs)
