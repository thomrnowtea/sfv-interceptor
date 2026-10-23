import { LRUMap } from './lru.js';

export const originalCache   = new LRUMap(40);
       const htmlCache       = new LRUMap(60);
       const pendingHtml     = new Map();
export const pendingOriginal = new Map();

function cacheDownload(cache, pending, key, download) {
  // In-flight work must outlive LRU eviction. A cleared/replaced request may
  // still finish for its caller, but cannot publish into the current cache.
  const promise = download.then(value => {
    if (value !== null && pending.get(key) === promise) cache.set(key, value);
    return value;
  }).finally(() => {
    if (pending.get(key) === promise) pending.delete(key);
  });
  pending.set(key, promise);
  return promise;
}

export function clearAssetCaches() {
  originalCache.clear(); htmlCache.clear(); pendingHtml.clear(); pendingOriginal.clear();
}

export function clearHtmlCache() {
  htmlCache.clear(); pendingHtml.clear();
}

export async function getScriptUrlsForPage(pageUrl) {
  let cacheKey;
  try { const u = new URL(pageUrl); cacheKey = u.origin + u.pathname; } catch { return []; }
  if (htmlCache.has(cacheKey)) return htmlCache.get(cacheKey);
  if (pendingHtml.has(cacheKey)) return (await pendingHtml.get(cacheKey)) ?? [];
  const download = (async () => {
    try {
      const res = await fetch(pageUrl, { cache: 'no-store' });
      const html = await res.text();
      const urls = [];
      const reScript = /<script[^>]+src\s*=\s*["']([^"']+)["'][^>]*/gi; let m;
      while ((m = reScript.exec(html)) !== null) { try { urls.push(new URL(m[1], pageUrl).href); } catch {} }
      const reStyle = /<link[^>]+rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*/gi;
      while ((m = reStyle.exec(html)) !== null) { try { urls.push(new URL(m[1], pageUrl).href); } catch {} }
      const reStyle2 = /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["'][^>]*/gi;
      while ((m = reStyle2.exec(html)) !== null) { try { const u = new URL(m[1], pageUrl).href; if (!urls.includes(u)) urls.push(u); } catch {} }
      return urls;
    } catch { return null; }
  })();
  return (await cacheDownload(htmlCache, pendingHtml, cacheKey, download)) ?? [];
}

export async function getOriginalText(assetUrl, referer) {
  if (originalCache.has(assetUrl)) return originalCache.get(assetUrl);
  if (pendingOriginal.has(assetUrl)) return pendingOriginal.get(assetUrl);
  const download = (async () => {
    try {
      const r = await fetch(assetUrl, { cache: 'no-store' });
      const ct = r.headers.get('content-type') || '';
      const text = await r.text();
      const first = text.trimStart()[0];
      console.log('[SFV-I SW] fetch', assetUrl.split('/').pop().split('?')[0],
        '→ status:', r.status, '| ct:', ct, '| size:', (text.length/1024).toFixed(0)+'KB', '| first char:', JSON.stringify(first));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (first === '<') throw new Error('got HTML instead of JS');
      return text;
    } catch(e) {
      console.warn('[SFV-I SW] getOriginalText failed for', assetUrl.split('/').pop().split('?')[0], ':', e.message);
      return null;
    }
  })();
  return cacheDownload(originalCache, pendingOriginal, assetUrl, download);
}
