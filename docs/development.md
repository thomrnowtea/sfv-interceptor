# Development

## Run the extension

Load the repository root with **Load unpacked** in `chrome://extensions`. No compilation or server is required. Node dependencies are only needed for development and tests; the editor, formatters, minifier and font are bundled locally.

After changing extension code, reload the extension and reopen its popup and dashboard. Reload host pages after changing `page-hook.js` or `content.js` so their installed hooks are replaced.

## Install development tools

Use Node 22 or later:

```sh
npm ci
npx playwright install chromium
npm test
npm run check
npm run test:browser
```

`npm test` uses isolated Chrome API fakes in `tests/helpers/chrome.js`. Browser suites load the extension in isolated Chromium profiles with synthetic fixtures. They never attach to a personal browser. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use another compatible Chromium binary. The native popup suite requires a desktop display.

See [quality checks](qa.md) for the available suites. `npm run check` validates JavaScript syntax and basic manifest requirements; packaging and the extracted-archive browser check validate resources and loading.

`SFVI_EXTENSION_ROOT` selects the extension directory for `test:interception`, including an extracted release ZIP. `SFVI_TEST_ARTIFACTS` selects its output directory and is also supported by the activity, toast and upgrade runners. Generated screenshots, diagnostics and profiles stay under ignored `.artifacts/` by default.

## Package and update

```sh
npm run package
npm run test:release
npm run test:upgrade -- path/to/previous-release.zip
```

Packaging uses an explicit runtime-file allowlist and writes the ZIP and checksum under ignored `dist/`. The release check loads the extracted archive. The upgrade check launches the previous release, populates synthetic rules and settings, then replaces its files in the same directory and restarts the same profile. See [releases](releases.md) for versioning and publication.

## Maintain bundled assets

`node scripts/vendor-terser.mjs` regenerates the checked-in minifier. Keep its license notices with the bundle. The Manrope WOFF2 comes from `@fontsource-variable/manrope`; update the font and SIL OFL license together.

`npm run docs:images` regenerates the README cover and dashboard image. `npm run docs:popup` opens isolated Chromium with synthetic rules and a sample page for the native-popup screenshot. Commit the documentation images under `docs/assets/`; keep browser profiles and intermediate captures out of Git.
