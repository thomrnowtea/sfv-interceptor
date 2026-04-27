import { LRUMap } from './lru.js';

export const originalCache   = new LRUMap(40);
export const htmlCache       = new LRUMap(60);
export const pendingHtml     = new LRUMap(60);
export const pendingOriginal = new LRUMap(40);

export function clearAssetCaches() {
  originalCache.clear(); htmlCache.clear(); pendingHtml.clear(); pendingOriginal.clear();
}

export async function getScriptUrlsForPage(pageUrl) {
  let cacheKey;
  try { const u = new URL(pageUrl); cacheKey = u.origin + u.pathname; } catch { return []; }
  if (htmlCache.has(cacheKey)) return htmlCache.get(cacheKey);
  if (pendingHtml.has(cacheKey)) return pendingHtml.get(cacheKey);
  const promise = (async () => {
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
      htmlCache.set(cacheKey, urls); pendingHtml.delete(cacheKey); return urls;
    } catch { pendingHtml.delete(cacheKey); return []; }
  })();
  pendingHtml.set(cacheKey, promise); return promise;
}

export async function getOriginalText(assetUrl, referer) {
  if (originalCache.has(assetUrl)) return originalCache.get(assetUrl);
  if (pendingOriginal.has(assetUrl)) return pendingOriginal.get(assetUrl);
  const promise = (async () => {
    try {
      const headers = { 'Cache-Control': 'no-store' };
      if (referer) headers['Referer'] = referer;
      const r = await fetch(assetUrl, { cache: 'no-store', headers });
      const ct = r.headers.get('content-type') || '';
      const text = await r.text();
      const first = text.trimStart()[0];
      console.log('[SFV-I SW] fetch', assetUrl.split('/').pop().split('?')[0],
        '→ status:', r.status, '| ct:', ct, '| size:', (text.length/1024).toFixed(0)+'KB', '| first char:', JSON.stringify(first));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (first === '<') throw new Error('got HTML instead of JS');
      originalCache.set(assetUrl, text); pendingOriginal.delete(assetUrl);
      return text;
    } catch(e) {
      console.warn('[SFV-I SW] getOriginalText failed for', assetUrl.split('/').pop().split('?')[0], ':', e.message);
      pendingOriginal.delete(assetUrl); return null;
    }
  })();
  pendingOriginal.set(assetUrl, promise); return promise;
}
