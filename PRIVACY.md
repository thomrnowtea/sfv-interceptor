# SFV Interceptor privacy policy

Last updated: October 20, 2026

SFV Interceptor is a developer tool for testing websites with configurable request, response, and page-resource rules. It is maintained by [thomrnowtea](https://github.com/thomrnowtea) and distributed from the [project repository](https://github.com/thomrnowtea/sfv-interceptor).

## Local processing and storage

To match and apply enabled rules, the extension processes website and request URLs, request methods and headers, request and response bodies, and page, JavaScript, or CSS content in your browser. It does not maintain a browsing-history database or send this content to the maintainer.

Your rules, versions, URL patterns, subscription URLs and snapshots, update metadata, activation choices, and interface preferences are stored in your browser profile. The extension has no account system, analytics, advertising, or developer-operated data collection server. Interface assets, fonts, and editor libraries are bundled with the extension.

Temporary session records associate applied rule IDs with the current tab and document so the toolbar icon and popup can show which rules ran. They reset on navigation or a new execution cycle and are removed when the tab closes or the browser session restarts. Temporary resource caches are kept in memory and cleared when the service worker restarts. Diagnostic messages remain in the local browser console.

## Connections and subscriptions

Importing from a URL requests the rule document from the HTTPS address you enter. Subscriptions periodically check the address you choose, including while the dashboard is closed. These checks omit cookies and referrer information and can use an ETag to avoid downloading an unchanged document. They do not upload your local rules or browsing activity. As with other web requests, the source server and any redirect destination receive the requested URL and normal connection metadata, including your IP address.

Page and file rules can retrieve a page or its original resources to apply your configured transformations. Website requests follow the browser's applicable credential and origin rules; a same-origin resource request made from the page can include that site's cookies. Enabled rules determine the request changes and destinations used.

Rules can include JavaScript transformations and page code, executed in the website context or the extension's sandbox without privileged extension APIs. Their behavior and any requests they make follow the rule content you enable. Subscription updates replace the source's rule content, including JavaScript when present; you choose the source and can turn each rule on or off.

Source providers handle their own server logs. Opening project, support, or privacy links connects to GitHub under its [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Use and sharing

Data is used to provide rule editing, matching, request and response changes, subscription updates, and execution indicators. The maintainer does not receive or sell your rules or browsing data, or use them for advertising, tracking, credit decisions, or unrelated purposes. Network connections are described above. Exporting produces a local JSON file that you can choose to share.

SFV Interceptor's use of information received from Chrome APIs follows the Chrome Web Store User Data Policy, including its Limited Use requirements. Data use and transfers are limited to the extension's disclosed functionality.

## Your choices and retention

You can turn rules off, delete local rules, remove subscriptions, and export rules from the dashboard. Removing a subscription deletes its configuration, snapshot, and activation preferences. Separate local copies and exported files remain under your control. Refresh a website after disabling page or file rules to start a new page session.

Saved extension data stays in your browser until you delete it or uninstall the extension. You can restrict website access or disable the extension through Chrome's extension settings. Exported files and browser or device backups are managed separately by you.

## Contact and changes

For privacy questions, contact the maintainer through the [project's issue tracker](https://github.com/thomrnowtea/sfv-interceptor/issues). Policy changes will be published here with an updated date. Material changes to data handling will also be described in the relevant extension update.
