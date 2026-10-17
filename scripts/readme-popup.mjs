import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { unzipSync } from 'fflate';
import { packageRelease, projectRoot } from './package-release.mjs';

const artifacts = join(projectRoot, '.artifacts/readme');
mkdirSync(artifacts, { recursive: true });

function executable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  return readdirSync(cache).filter(name => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .flatMap(name => ['chrome-win64', 'chrome-win'].map(folder => join(cache, name, folder, 'chrome.exe'))).find(existsSync);
}

function rule(id, name, resourceType, urlPattern, body, extra = {}) {
  return {
    id, name, resourceType, version: '1.0.0', enabled: true,
    pairs: [{ id: `${id}-url`, urlPattern, urlOperator: 'Contains', method: 'GET' }],
    request: { type: 'static', body: '', customHeaders: '' },
    response: { type: 'static', body, statusCode: '200', delay: 0, customHeaders: '' },
    ...extra,
  };
}

const rules = [
  rule('account-preview', 'Account overview', 'rest', 'https://api.example.test/v1/account', '', {
    version: '1.2.0',
    response: {
      type: 'dynamic',
      body: 'function modifyResponse(args) { const account = args.responseJSON; return { ...account, plan: "preview", features: ["analytics", "exports"] }; }',
      statusCode: '200', delay: 0, customHeaders: '',
    },
  }),
  rule('feature-flags', 'Feature flags', 'rest', 'https://api.example.test/v1/features', '{"betaDashboard":true}', { enabled: false }),
  rule('product-details', 'Product details', 'graphql', 'https://api.example.test/graphql', '{"data":{"product":{"name":"Example product","available":true}}}', { version: '2.1.0' }),
  rule('checkout-script', 'Checkout behavior', 'html', 'https://shop.example.test/assets/checkout.js', 'window.checkoutPreview = true;', { resourceSubtype: 'js', version: '1.3.0' }),
  rule('checkout-styles', 'Checkout styles', 'html', 'https://shop.example.test/assets/checkout.css', '.checkout { --spacing: 24px; }', { resourceSubtype: 'css' }),
];
const source = {
  id: 'source_readme', name: 'Frontend examples', url: 'https://rules.example.test/frontend', intervalMinutes: 60,
  rules: [rule('preview-banner', 'Preview banner', 'html', 'https://shop.example.test/preview', '<aside>Preview environment</aside>', { resourceSubtype: 'html', version: '3.1.0' })],
};
const examplePage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Example Domain</title>
  <style>
    body { margin: 0; background: #111318; color: #e5e7ed; font: 16px/1.5 system-ui, sans-serif; }
    main { box-sizing: border-box; max-width: 640px; margin: 12vh auto; padding: 2.5rem 3rem; background: #1c1e26; border: 1px solid #343743; border-radius: 0.75rem; box-shadow: 0 12px 32px #0005; }
    h1 { margin-top: 0; font-size: 1.5rem; }
    a { color: #aab8ff; }
    @media (max-width: 700px) { main { margin: 1rem; padding: 1.5rem; } }
  </style>
</head>
<body><main><h1>Example Domain</h1><p>This domain is for use in documentation examples. It can be used without prior coordination or asking for permission.</p><p><a href="https://www.iana.org/domains/example">Learn more</a></p></main></body>
</html>`;

const release = packageRelease();
const unpacked = process.env.SFVI_README_EXTENSION_DIR || mkdtempSync(join(artifacts, 'popup-extension-'));
mkdirSync(unpacked, { recursive: true });
for (const [name, bytes] of Object.entries(unzipSync(readFileSync(release.zipPath)))) {
  const destination = join(unpacked, name);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}

const profile = process.env.SFVI_README_PROFILE_DIR || mkdtempSync(join(artifacts, 'popup-browser-profile-'));
mkdirSync(profile, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath: executable(),
  viewport: null,
  args: [
    '--disable-extensions-except=' + unpacked,
    '--load-extension=' + unpacked,
    '--window-size=1280,900',
    '--start-maximized',
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async ({ rules, source }) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      sfvi_rules: rules,
      sfvi_sources: [source],
      sfvi_theme: 'default',
    });
  }, { rules, source });

  const page = context.pages()[0] || await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('https://example.com/**', route => route.request().isNavigationRequest()
    ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: examplePage })
    : route.continue());
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
  assert.equal(new URL(page.url()).hostname, 'example.com');
  await page.bringToFront();
  await worker.evaluate(() => chrome.action.openPopup());

  const client = await context.newCDPSession(page);
  await client.send('Target.setDiscoverTargets', { discover: true });
  let popup;
  for (let attempt = 0; attempt < 120; attempt++) {
    const targets = (await client.send('Target.getTargets')).targetInfos;
    popup = targets.find(target => target.url.endsWith('/popup/popup.html'));
    if (popup) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(popup, 'Chrome did not open the native extension popup');
  await new Promise(resolve => setTimeout(resolve, 900));
  assert.deepEqual(pageErrors, []);

  const evidence = {
    page: page.url(),
    popup: 'Chrome native toolbar popup',
    rules: 'Synthetic example.test rules in an isolated profile',
    pageContent: 'A local Example Domain fixture; no external site data is loaded',
    userProfileUsed: false,
    screenshot: 'Capture the visible browser window with an OS screenshot tool and save to docs/assets/readme-popup.png',
  };
  writeFileSync(join(artifacts, 'popup-capture.json'), JSON.stringify(evidence, null, 2));
  console.log('Native popup is open on https://example.com. Capture the full browser window with an OS screenshot tool.');
  console.log('The browser uses an isolated profile, synthetic rules, and a local example page. Press Ctrl+C when the screenshot is saved.');

  await new Promise(resolve => process.once('SIGINT', resolve));
} finally {
  await context.close();
}
