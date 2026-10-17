import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTheme } from '../shared/themes.js';

export function readmeCover(root) {
  const theme = Object.entries(resolveTheme({ sfvi_theme: 'default' })).map(([key, value]) => `${key}:${value}`).join(';');
  const font = readFileSync(join(root, 'shared/fonts/manrope-latin-wght-normal.woff2')).toString('base64');
  const logo = readFileSync(join(root, 'icons/icon128.png')).toString('base64');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SFV Interceptor cover</title><style>
    @font-face { font-family: Manrope; font-style: normal; font-weight: 200 800; src: url(data:font/woff2;base64,${font}) format('woff2'); }
    :root { ${theme} }
    * { box-sizing: border-box; }
    body { margin: 0; width: 1440px; height: 480px; background: var(--bg); color: var(--text); font-family: Manrope, sans-serif; }
    .cover { position: relative; width: 100%; height: 100%; overflow: hidden; border: 1px solid var(--border); border-radius: 24px;
      background: radial-gradient(ellipse at 95% 0%, var(--accent-dim), transparent 65%), var(--bg); }
    .brand { position: absolute; top: 58px; left: 72px; display: flex; align-items: center; gap: 19px; }
    .brand img { width: 64px; height: 64px; }
    .eyebrow { color: var(--text3); font-size: 12px; font-weight: 600; letter-spacing: 2.4px; }
    h1 { position: absolute; left: 70px; top: 153px; margin: 0; font-size: 66px; font-weight: 600; line-height: 1.12; letter-spacing: -3px; }
    .description { position: absolute; left: 74px; top: 247px; max-width: 620px; margin: 0; color: var(--text2); font-size: 22px; line-height: 1.6; letter-spacing: -.35px; }
    .types { position: absolute; left: 74px; bottom: 63px; display: flex; gap: 10px; }
    .type { display: flex; align-items: center; gap: 8px; padding: 9px 13px; border: 1px solid var(--border); border-radius: 9px; color: var(--text2); font-size: 13px; font-weight: 500; }
    .type::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--type); }
    .flow { position: absolute; top: 63px; right: 70px; width: 420px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 19px 23px; box-shadow: 0 16px 40px rgba(0,0,0,.14); }
    .card-label { display: flex; justify-content: space-between; align-items: center; color: var(--text3); font-size: 10px; font-weight: 600; letter-spacing: 1.8px; }
    .request { display: flex; align-items: center; gap: 13px; margin-top: 16px; font-size: 16px; }
    .method { color: var(--t-rest-c); background: var(--t-rest-bg); padding: 5px 8px; border-radius: 5px; font: 12px monospace; }
    .path { font-family: ui-monospace, Consolas, monospace; color: var(--text2); }
    .connector { height: 55px; position: relative; display: flex; align-items: center; justify-content: center; }
    .connector::before { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; background: var(--accent-dim2); }
    .rule { position: relative; padding: 6px 13px; border: 1px solid var(--accent-dim2); border-radius: 20px; background: var(--bg); color: var(--accent-link); font-size: 11px; font-weight: 600; }
    .status { color: var(--text2); font: 11px ui-monospace, Consolas, monospace; letter-spacing: 0; }
    pre { margin: 15px 0 0; color: var(--text3); font: 15px/1.8 ui-monospace, Consolas, monospace; }
    .key { color: var(--t-html-c); } .value { color: var(--t-js-c); }
  </style></head><body><main class="cover">
    <div class="brand"><img src="data:image/png;base64,${logo}" alt="SFV shield"><span class="eyebrow">YOUR BROWSER. YOUR RULES.</span></div>
    <h1>SFV Interceptor</h1>
    <p class="description">Mock APIs and patch files,<br>right in your browser.</p>
    <div class="types"><span class="type" style="--type:var(--t-rest-c)">REST</span><span class="type" style="--type:var(--t-gql-c)">GraphQL</span><span class="type" style="--type:var(--t-html-c)">HTML</span><span class="type" style="--type:var(--t-css-c)">CSS</span><span class="type" style="--type:var(--t-js-c)">JavaScript</span></div>
    <div class="flow">
      <div class="card"><div class="card-label">BROWSER REQUEST<span class="status">01</span></div><div class="request"><span class="method">GET</span><span class="path">/api/account</span></div></div>
      <div class="connector"><span class="rule">Your rules</span></div>
      <div class="card"><div class="card-label">CUSTOM RESPONSE<span class="status">200 OK</span></div><pre>{
  <span class="key">"plan"</span>: <span class="value">"preview"</span>,
  <span class="key">"features"</span>: [<span class="value">"your next idea"</span>]
}</pre></div>
    </div>
  </main></body></html>`;
}
