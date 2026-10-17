![SFV Interceptor cover artwork](docs/assets/readme-cover.png)

# SFV Interceptor

A Chrome extension for mocking REST and GraphQL responses, replacing JS and CSS files, and injecting page code.

[Download the latest release](https://github.com/thomrnowtea/sfv-interceptor/releases/latest) · [Installation](#installation) · [MIT License](LICENSE)

## Screenshots

![Dashboard with rule lists and the dynamic response editor](docs/assets/readme-dashboard.png)

![Chrome with the SFV Interceptor popup open on a dark page](docs/assets/readme-popup.png)

## Features

- **API mocking:** intercept `fetch` and `XMLHttpRequest`; match REST or GraphQL requests by URL, method, and operation; return static responses or transform them with JavaScript.
- **Page and asset rules:** inject JavaScript or HTML, and replace JavaScript or CSS files on navigation.
- **Rule management:** create, edit, version, search, sort, and export local rules. Import a JSON file or make a one-time import from an HTTPS URL.
- **Subscriptions:** follow any HTTPS URL that responds with a rules array or `{ "rules": [...] }`. Remote rule content and versions follow the source; activation remains a local choice.
- **Dashboard and popup:** edit rules and settings in the dashboard; use the popup to search and activate rules.

## Installation

1. Download the versioned `sfv-interceptor-vX.Y.Z.zip` from [GitHub Releases](https://github.com/thomrnowtea/sfv-interceptor/releases).
2. Extract the ZIP to a permanent folder.
3. In Chrome, open `chrome://extensions` and turn on **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder containing `manifest.json`.

Node.js is not required to use the extension. Reload the extension from `chrome://extensions` after replacing its files to update it.

## Quick start

Open the popup and choose **New rule**, or open the dashboard. Select a resource type, add URL patterns, configure the response, then save and enable the rule. API changes are sent to open tabs; reload a page to apply JS/CSS replacements or page injections.

Use **Import a copy** for editable local rules. Use **Sources** to subscribe to a JSON feed that should stay read-only and update on a schedule. Local rules are editable; remote rules can be activated or deactivated locally.

Rule documents may be a JSON array or an object with a `rules` array. Subscribed rules need stable IDs. See the [rule schema](docs/rule-schema.md) for the supported fields.

## Permissions and data

The extension requests access to all sites so it can intercept requests and modify page resources where you use it. Chrome lets you restrict site access in the extension's settings. Rules and preferences are stored with `chrome.storage.local`. Subscriptions fetch only the HTTPS URLs you configure. The project does not operate an account service or a rules server.

Dynamic rule code can execute with page access. Only import and enable rules from sources you trust.

## Development

The extension loads directly from this repository; it has no build step. For Node-based checks, packaging, and release instructions, see [development](docs/development.md) and [release packaging](docs/releases.md).

## License

[MIT](LICENSE)
