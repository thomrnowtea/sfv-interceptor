import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { unzipSync } from 'fflate';
import { packageRelease, projectRoot } from './package-release.mjs';
import { readmeCover } from './readme-cover.mjs';

const artifacts = join(projectRoot, '.artifacts/readme');
const assets = join(projectRoot, 'docs/assets');
mkdirSync(artifacts, { recursive: true });
mkdirSync(assets, { recursive: true });
const release = packageRelease();
const unpacked = mkdtempSync(join(artifacts, 'extension-'));
for (const [name, bytes] of Object.entries(unzipSync(readFileSync(release.zipPath)))) {
  const destination = join(unpacked, name);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}

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
    pairs: [{ id: id + '-url', urlPattern, urlOperator: 'Contains', method: 'GET' }],
    request: { type: 'static', body: '', customHeaders: '' },
    response: { type: 'static', body, statusCode: '200', delay: 0, customHeaders: '' },
    ...extra,
  };
}

const account = rule('account-preview', 'Account overview', 'rest', 'https://api.example.com/v1/account', '', {
  version: '1.2.0', description: 'Preview the account experience with a custom API response.',
  response: { type: 'dynamic', body: 'function modifyResponse(args) { const account = args.responseJSON; return { ...account, plan: "preview", features: ["analytics", "exports"], preferences: { ...account.preferences, onboardingComplete: true } }; }', statusCode: '200', delay: 0, customHeaders: '' },
});
const rules = [
  account,
  rule('feature-flags', 'Feature flags', 'rest', 'https://api.example.com/v1/features', '{"betaDashboard":true}', { enabled: false }),
  rule('product-details', 'Product details', 'graphql', 'https://api.example.com/graphql', '{"data":{"product":{"name":"Example product","available":true}}}', { version: '2.1.0' }),
  rule('checkout-script', 'Checkout behavior', 'html', 'https://shop.example.com/assets/checkout.js', 'window.checkoutPreview = true;', { resourceSubtype: 'js', version: '1.3.0' }),
  rule('checkout-styles', 'Checkout styles', 'html', 'https://shop.example.com/assets/checkout.css', '.checkout { --spacing: 24px; }', { resourceSubtype: 'css' }),
];
const now = Date.now();
const source = { id: 'source_readme', name: 'Frontend team', url: 'https://rules.example.com/frontend', intervalMinutes: 60,
  createdAt: now, lastCheckedAt: now, lastSyncedAt: now, error: null,
  rules: [rule('preview-banner', 'Preview banner', 'html', 'https://shop.example.com/preview', '<aside>Preview environment</aside>', { resourceSubtype: 'html', version: '3.1.0' })] };

const errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(artifacts, 'profile-')), {
  headless: true, executablePath: executable(), viewport: { width: 1440, height: 480 }, deviceScaleFactor: 2,
  args: ['--disable-extensions-except=' + unpacked, '--load-extension=' + unpacked],
});
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(({ rules, source }) => chrome.storage.local.set({ sfvi_rules: rules, sfvi_sources: [source], sfvi_theme: 'default' }), { rules, source });
  const cover = await context.newPage();
  await cover.emulateMedia({ reducedMotion: 'reduce' });
  await cover.setContent(readmeCover(projectRoot));
  await cover.evaluate(() => document.fonts.ready);
  assert.equal(await cover.evaluate(() => [...document.fonts].some(face => face.family === 'Manrope' && face.status === 'loaded')), true);
  await cover.screenshot({ path: join(assets, 'readme-cover.png') });
  const fontSession = await context.newCDPSession(cover);
  await fontSession.send('DOM.enable');
  await fontSession.send('CSS.enable');
  const { root } = await fontSession.send('DOM.getDocument');
  const { nodeId } = await fontSession.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'h1' });
  const renderedFonts = await fontSession.send('CSS.getPlatformFontsForNode', { nodeId });
  assert.ok(renderedFonts.fonts.some(font => font.isCustomFont && /manrope/i.test(font.familyName)));

  const extension = 'chrome-extension://' + new URL(worker.url()).hostname;
  const dashboard = await context.newPage();
  await dashboard.setViewportSize({ width: 1360, height: 960 });
  await dashboard.emulateMedia({ reducedMotion: 'reduce' });
  await dashboard.goto(extension + '/dashboard/dashboard.html?edit=account-preview');
  await dashboard.locator('#dynamic-body-field .cm-content').waitFor();
  await dashboard.waitForFunction(() => document.querySelector('#dynamic-body-field .cm-content').innerText.split('\n').length > 5);
  await dashboard.evaluate(() => document.fonts.ready);
  await dashboard.locator('#dynamic-body-field').scrollIntoViewIfNeeded();
  await dashboard.mouse.move(1350, 950);
  assert.equal(await dashboard.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(15, 17, 23)');
  await dashboard.screenshot({ path: join(assets, 'readme-dashboard.png') });

  assert.deepEqual(errors, []);
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({
    palette: 'shared/themes.js default', font: renderedFonts.fonts, logo: 'icons/icon128.png',
    extensionRoot: unpacked, fixture: 'Synthetic example.com rules; isolated profile',
    images: ['readme-cover.png', 'readme-dashboard.png'],
    popupCapture: 'readme-popup.mjs opens the native popup on example.com in an isolated profile; capture the browser window with an OS screenshot tool.',
    errors,
  }, null, 2));
  console.log('README assets generated: branded Manrope cover and dashboard using synthetic rules.');
} finally { await context.close(); }
