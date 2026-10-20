import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { chromium } from 'playwright';
import { unzipSync } from 'fflate';
import { packageRelease, projectRoot } from './package-release.mjs';
import { resolveTheme } from '../shared/themes.js';

const output = join(projectRoot, 'docs/assets/store');
const artifacts = join(projectRoot, '.artifacts/store-assets');
mkdirSync(output, { recursive: true });
mkdirSync(artifacts, { recursive: true });
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--native-popup')) {
  throw new Error('Usage: node scripts/store-assets.mjs [--native-popup]');
}
const nativePopup = args.includes('--native-popup');

function executable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  return readdirSync(cache).filter(name => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .flatMap(name => ['chrome-win64', 'chrome-win'].map(folder => join(cache, name, folder, 'chrome.exe'))).find(existsSync);
}

function rule(id, name, resourceType, urlPattern, body, extra = {}) {
  return { id, name, version: '1.0.0', enabled: true, resourceType,
    pairs: [{ id: id + '-url', urlPattern, urlOperator: 'Contains', method: 'GET' }],
    request: { type: 'static', body: '', customHeaders: '' },
    response: { type: 'static', body, statusCode: '200', delay: 0, customHeaders: '' }, ...extra };
}

const account = rule('account-preview', 'Account overview', 'rest', 'https://api.example.test/v1/account', '', {
  version: '1.2.0', description: 'Preview a different account response during development.',
  response: { type: 'dynamic', statusCode: '200', delay: 0, customHeaders: '',
    body: 'function modifyResponse(args) { return { ...args.responseJSON, plan: "preview", features: ["analytics", "exports"] }; }' },
});
const rules = [account,
  rule('feature-flags', 'Feature flags', 'rest', 'https://api.example.test/v1/features', '{"betaDashboard":true}', { enabled: false }),
  rule('product-details', 'Product details', 'graphql', 'https://api.example.test/graphql', '{"data":{"product":{"name":"Example product"}}}', { version: '2.1.0' }),
  rule('checkout-script', 'Checkout behavior', 'html', 'https://shop.example.test/assets/checkout.js', 'window.checkoutPreview = true;', { resourceSubtype: 'js', version: '1.3.0' }),
  rule('checkout-styles', 'Checkout styles', 'html', 'https://shop.example.test/assets/checkout.css', '.checkout { gap: 24px; }', { resourceSubtype: 'css' }),
];

const release = packageRelease({ outputDirectory: join(artifacts, 'package') });
const unpacked = mkdtempSync(join(artifacts, 'extension-'));
for (const [name, bytes] of Object.entries(unzipSync(readFileSync(release.zipPath)))) {
  const destination = join(unpacked, name);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}
const context = await chromium.launchPersistentContext(mkdtempSync(join(artifacts, 'profile-')), {
  executablePath: executable(), headless: !nativePopup,
  viewport: nativePopup ? null : { width: 1280, height: 800 },
  ...(nativePopup ? {} : { deviceScaleFactor: 1 }),
  ignoreDefaultArgs: nativePopup ? ['--enable-automation'] : [],
  args: ['--disable-extensions-except=' + unpacked, '--load-extension=' + unpacked,
    '--window-size=1280,800', '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1'],
});
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));

function brandPage(iconOnly = false) {
  const logo = readFileSync(join(projectRoot, 'icons/icon128.png')).toString('base64');
  const font = readFileSync(join(projectRoot, 'shared/fonts/manrope-latin-wght-normal.woff2')).toString('base64');
  const theme = Object.entries(resolveTheme({ sfvi_theme: 'default' })).map(([key, value]) => key + ':' + value).join(';');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>SFV Interceptor</title><style>
    @font-face { font-family:Manrope; font-style:normal; font-weight:200 800; src:url(data:font/woff2;base64,${font}); }
    :root { ${theme} } * { box-sizing:border-box; } body { margin:0; font-family:Manrope,sans-serif; }
    main { width:440px; height:280px; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:27px;
      background:radial-gradient(ellipse at 50% 0%,var(--accent-dim2),transparent 72%),var(--bg); color:var(--text); }
    img { width:128px; height:128px; } h1 { margin:0; font-size:29px; font-weight:600; letter-spacing:-.9px; line-height:1.1; }
    body.icon main { width:128px; height:128px; background:transparent; }
    </style><body class="${iconOnly ? 'icon' : ''}"><main><img src="data:image/png;base64,${logo}" alt="">${iconOnly ? '' : '<h1>SFV Interceptor</h1>'}</main></body></html>`;
}

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(rules => chrome.storage.local.set({ sfvi_rules: rules, sfvi_sources: [], sfvi_theme: 'default' }), rules);
  const page = context.pages()[0] || await context.newPage();
  if (nativePopup) {
    await page.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Example Domain</title><style>
      body { margin:0; background:#0f1117; color:#e2e4f0; font:16px/1.6 system-ui,sans-serif; }
      main { width:440px; margin:112px 0 0 80px; padding:32px; border:1px solid #2d3040; border-radius:12px; background:#1c1e26; }
      h1 { margin:0 0 16px; font-size:24px; } a { color:#a4b2ff; }</style><main><h1>Example Domain</h1><p>This domain is for use in documentation examples. You may use this domain without prior coordination or asking for permission.</p><a href="https://www.iana.org/domains/example">Learn more</a></main></html>` }));
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal', left: 40, top: 40, width: 1280, height: 800 } });
    await page.bringToFront();
    await worker.evaluate(() => chrome.action.openPopup());
    await page.waitForTimeout(700);
    const browserSession = await context.browser().newBrowserCDPSession();
    const processInfo = await browserSession.send('SystemInfo.getProcessInfo');
    writeFileSync(join(artifacts, 'native-popup.json'), JSON.stringify({
      browserPid: processInfo.processInfo.find(item => item.type === 'browser')?.id,
      window: await cdp.send('Browser.getWindowBounds', { windowId }),
      page: page.url(), profile: 'isolated', data: 'synthetic example.test rules',
      captureTo: join(output, 'popup.png'), requiredPixels: [1280, 800],
    }, null, 2));
    console.log('Native popup ready in an isolated browser. Capture the full browser window at 1280x800 to docs/assets/store/popup.png.');
    console.log('Window/PID metadata: .artifacts/store-assets/native-popup.json. Press Enter to reopen the popup; Ctrl+C closes this browser.');
    const input = createInterface({ input: process.stdin, output: process.stdout });
    input.on('line', () => page.bringToFront().then(() => worker.evaluate(() => chrome.action.openPopup())).catch(error => console.error(error.message)));
    await new Promise(resolve => { process.once('SIGINT', resolve); input.once('SIGINT', resolve); });
    input.close();
  } else {
    await page.setViewportSize({ width: 440, height: 280 });
    await page.setContent(brandPage());
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.fonts.check('600 29px Manrope')), true);
    await page.screenshot({ path: join(output, 'small-promo.png') });
    await page.setViewportSize({ width: 128, height: 128 });
    await page.setContent(brandPage(true));
    await page.screenshot({ path: join(output, 'icon128.png'), omitBackground: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('chrome-extension://' + new URL(worker.url()).hostname + '/dashboard/dashboard.html?edit=account-preview');
    await page.locator('#dynamic-body-field .cm-content').waitFor();
    await page.waitForFunction(() => document.querySelector('#dynamic-body-field .cm-content').innerText.split('\n').length > 5);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#dynamic-body-field').evaluate(element => element.closest('.section').scrollIntoView({ block: 'start' }));
    await page.mouse.move(1279, 799);
    await page.screenshot({ path: join(output, 'dashboard.png') });
    assert.deepEqual(errors, []);
    console.log('Store assets generated: 1280x800 dashboard, 440x280 promo, and 128x128 store icon.');
  }
} finally { await context.close(); }
