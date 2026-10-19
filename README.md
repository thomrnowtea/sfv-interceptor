![SFV Interceptor cover artwork](docs/assets/readme-cover.png)

# SFV Interceptor

A Chrome extension for changing REST and GraphQL responses, replacing JavaScript and CSS files, and adding code to web pages.

[Download the latest release](https://github.com/thomrnowtea/sfv-interceptor/releases/latest) · [Installation](#installation) · [MIT License](LICENSE)

## Screenshots

![Dashboard with rule lists and the dynamic response editor](docs/assets/readme-dashboard.png)

![Chrome with the SFV Interceptor popup open on a dark page](docs/assets/readme-popup.png)

## Features

- **API rules:** replace REST and GraphQL responses with your own content, or change requests and responses with JavaScript.
- **Page and file rules:** add JavaScript or HTML to pages, and replace JavaScript or CSS files when a page opens.
- **Rule management:** create, edit, version, search, sort, and export local rules. Import a JSON file or make a one-time import from an HTTPS URL.
- **Subscriptions:** keep rules updated from a URL. Their owner controls the content and version; you can turn each rule on or off.
- **Dashboard and popup:** manage rules and settings in the dashboard; click the extension icon to search and turn rules on or off.

## Installation

1. Open the [latest release page](https://github.com/thomrnowtea/sfv-interceptor/releases/latest). Under **Assets**, download the ZIP whose name starts with **sfv-interceptor-v**.
2. Extract the ZIP to a folder you will keep on your computer.
3. Type `chrome://extensions` into Chrome's address bar and turn on **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder containing `manifest.json`.

## Updating

1. Download the new extension ZIP from the [latest release page](https://github.com/thomrnowtea/sfv-interceptor/releases/latest).
2. Extract it and copy its contents into the folder you used to install the extension. Replace the existing files when asked.
3. Open `chrome://extensions`, find **SFV Interceptor**, and click **Reload** (the circular-arrow button).
4. Refresh the websites where you use the extension. If the dashboard is already open, refresh that tab too.

Keep using the same folder and installed extension to preserve your saved rules and settings.

## Quick start

Click the **SFV Interceptor** icon in Chrome's toolbar. Choose **New rule** to create a rule, or **Open dashboard** to manage existing ones. Choose what the rule changes and which URLs it applies to, then save it and turn it on. Page and JS/CSS rules take effect when you refresh the website.

Use **Import a copy** to add rules from a JSON file or URL once; you can edit those copies. Use **Sources** to keep rules linked to a URL and update them automatically. Subscribed rules can be turned on or off, but their content can only be changed by their owner.

For the rule-file format and supported options, see the [rule schema](docs/rule-schema.md).

## Permissions and data

The extension requests access to all websites so it can apply your rules. You can restrict which websites it can access in Chrome's extension settings. Rules and preferences are saved in your browser. Subscriptions check only the URLs you add. There is no project account or central rules server.

Rules that contain JavaScript can read or change the pages they run on. Only use rules from sources you trust.

## Development

The extension loads directly from this repository; it has no build step. For Node-based checks, packaging, and release instructions, see [development](docs/development.md) and [release packaging](docs/releases.md).

## License

[MIT](LICENSE)
