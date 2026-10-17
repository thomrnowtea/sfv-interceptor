import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { resolveTheme } from '../shared/themes.js';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const artifacts=resolve('.artifacts/ui-revision');
mkdirSync(artifacts,{recursive:true});
const observations=[];
const scans=[];
function executable() {
  if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if(existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache=join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  return readdirSync(cache).filter(name=>/^chromium-\d+$/.test(name)).sort().reverse()
    .flatMap(name=>['chrome-win64','chrome-win'].map(folder=>join(cache,name,folder,'chrome.exe'))).find(existsSync);
}
const context=await chromium.launchPersistentContext(mkdtempSync(join(artifacts,'profile-')),{
  headless:true, executablePath:executable(), viewport:{width:1440,height:1000},
  args:[`--disable-extensions-except=${resolve('.')}`,`--load-extension=${resolve('.')}`],
});
const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extensionId=new URL(worker.url()).hostname;
const extension=`chrome-extension://${extensionId}`;

async function audit(page,label) {
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  writeFileSync(join(artifacts,`axe-${label}.json`),JSON.stringify(result,null,2));
  scans.push({label,violations:result.violations.length,incomplete:result.incomplete.map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)}))});
  assert.equal(result.violations.length,0,JSON.stringify(result.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.failureSummary)}))));
  console.log('Revision accessibility passed:',label);
}

async function popupGeometry(page,label) {
  const geometry=await page.evaluate(()=>{
    const list=document.getElementById('rules-list');
    const footer=document.querySelector('footer').getBoundingClientRect();
    return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},root:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
      rootOverflow:getComputedStyle(document.documentElement).overflow,
      body:{width:document.body.clientWidth,scrollWidth:document.body.scrollWidth,height:document.body.clientHeight,scrollHeight:document.body.scrollHeight},list:{height:list.clientHeight,scrollHeight:list.scrollHeight},footer:{top:footer.top,bottom:footer.bottom}};
  });
  observations.push({probe:'popup-single-scroll',label,...geometry});
  // The root supplies Chrome's intrinsic size; the visible body fits the actual viewport.
  assert.equal(geometry.rootOverflow,'hidden');
  assert.ok(geometry.body.width<=geometry.viewport.width && geometry.body.scrollWidth<=geometry.body.width+1,JSON.stringify(geometry));
  assert.ok(geometry.body.scrollHeight<=geometry.body.height+1,JSON.stringify(geometry));
  assert.ok(geometry.footer.top>=0 && geometry.footer.bottom<=geometry.viewport.height+1,JSON.stringify(geometry));
  assert.ok(geometry.list.height>40 && geometry.list.scrollHeight>geometry.list.height,JSON.stringify(geometry));
}

async function drawerProbe(page,width,height) {
  await page.setViewportSize({width,height});
  await page.locator('#sidebar-collapse-btn').click();
  assert.equal(await page.locator('#rules-drawer').evaluate(element=>element.open),true);
  await page.locator('#rules-drawer-close').focus();
  for(let index=0;index<12;index++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.getElementById('rules-drawer').contains(document.activeElement)),true);
  }
  await page.locator('#rules-nav').evaluate(element=>{element.scrollTop=element.scrollHeight;});
  const geometry=await page.locator('#rules-drawer').evaluate(element=>{
    const box=element.getBoundingClientRect();
    const list=element.querySelector('#rules-nav');
    const footer=element.querySelector('.sidebar-footer').getBoundingClientRect();
    return {box:{x:box.x,y:box.y,right:box.right,bottom:box.bottom},scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,listHeight:list.clientHeight,footer:{top:footer.top,bottom:footer.bottom}};
  });
  observations.push({probe:'expanded-navigation',viewport:{width,height},...geometry});
  assert.ok(geometry.box.x>=0 && geometry.box.y>=0 && geometry.box.right<=width+1 && geometry.box.bottom<=height+1,JSON.stringify(geometry));
  assert.ok(geometry.scrollWidth<=geometry.clientWidth && geometry.listHeight>=80,JSON.stringify(geometry));
  assert.ok(geometry.footer.bottom<=height,JSON.stringify(geometry));
  await page.screenshot({path:join(artifacts,`navigation-${width}.png`)});
  await audit(page,`navigation-${width}`);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'sidebar-collapse-btn');
}

async function fontForNode(session,nodeId) {
  const {fonts}=await session.send('CSS.getPlatformFontsForNode',{nodeId});
  assert.ok(fonts.some(font=>font.isCustomFont && /Manrope/i.test(font.familyName) && font.glyphCount>0),JSON.stringify(fonts));
  return fonts;
}

function contrast(foreground,background) {
  const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number)
    .map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4)
    .reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
  const values=[luminance(foreground),luminance(background)].sort((a,b)=>b-a);
  return (values[0]+.05)/(values[1]+.05);
}

async function closedToast(session) {
  const {root}=await session.send('DOM.getDocument',{depth:-1,pierce:true});
  function find(node) {
    if(node.localName==='sfvi-t') return node;
    for(const child of [...(node.children || []),...(node.shadowRoots || [])]) { const found=find(child); if(found) return found; }
  }
  const host=find(root);
  assert.ok(host?.shadowRoots?.[0],'Closed toast root not found through CDP');
  const shadow=host.shadowRoots[0];
  const {object}=await session.send('DOM.resolveNode',{nodeId:shadow.nodeId});
  return {host,shadow,objectId:object.objectId};
}

async function callRoot(session,root,body) {
  const result=await session.send('Runtime.callFunctionOn',{objectId:root.objectId,functionDeclaration:`function(){${body}}`,returnByValue:true});
  assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function notify(page,title,duration=10000,color='#fbbf24') {
  await page.evaluate(({title,duration,color})=>{
    const state=Reflect.ownKeys(window).map(key=>window[key]).find(value=>value?._sfvi===1);
    state.toast('box','Rule applied',title,'Resource replacement',color,duration);
  },{title,duration,color});
  await page.locator('sfvi-t').first().waitFor();
}

async function toastProbes() {
  await worker.evaluate(async()=>chrome.storage.local.set({sfvi_rules:[{id:'file-only',name:'File-only fixture',resourceType:'html',resourceSubtype:'js',urlPattern:'*checkout.bundle.js*',responseBody:'// fixture'}],sfvi_sources:[],sfvi_theme:'default'}));
  await context.route('https://ui.sfvi.test/**',route=>route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'none'; script-src 'none'; style-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'"},body:'<!doctype html><html lang="en"><head><title>Toast QA</title></head><body><button id="host-control">Continue</button></body></html>'}));
  const page=await context.newPage();
  await page.setViewportSize({width:390,height:844});
  await page.goto('https://ui.sfvi.test/toasts');
  await page.waitForFunction(()=>[...document.fonts].some(font=>font.family==='SFVI Manrope' && font.status==='loaded'));
  await page.locator('#host-control').focus();
  await notify(page,'JavaScript asset patched');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'host-control');
  const session=await context.newCDPSession(page);
  await session.send('DOM.enable'); await session.send('CSS.enable');
  let root=await closedToast(session);
  const {nodeId}=await session.send('DOM.querySelector',{nodeId:root.shadow.nodeId,selector:'.title'});
  const fonts=await fontForNode(session,nodeId);
  const styles=await callRoot(session,root,"const c=this.querySelector('#c'); const b=this.host.getBoundingClientRect(); return {font:getComputedStyle(c).fontFamily,background:getComputedStyle(c).backgroundColor,transition:getComputedStyle(this.host).transitionDuration,box:{x:b.x,right:b.right,bottom:b.bottom}};");
  observations.push({probe:'strict-csp-file-only-toast',fonts,...styles});
  assert.equal(styles.background,'rgb(28, 30, 38)');
  assert.ok(styles.box.x>=0 && styles.box.right<=390 && styles.box.bottom<=844);
  assert.ok(parseFloat(styles.transition)<.3);
  await page.locator('sfvi-t').first().screenshot({path:join(artifacts,'toast-dark.png')});
  const ax=await session.send('Accessibility.getFullAXTree');
  assert.ok(ax.nodes.some(node=>node.role?.value==='button' && node.name?.value?.startsWith('Dismiss notification:')));
  const progress=await callRoot(session,root,"const bar=this.querySelector('.progress-fill');const animation=bar.getAnimations()[0];return {buttons:this.querySelectorAll('button').length,duration:animation.effect.getTiming().duration,easing:animation.effect.getTiming().easing,height:bar.getBoundingClientRect().height,foreground:getComputedStyle(bar).backgroundColor,background:getComputedStyle(bar.parentNode).backgroundColor};");
  assert.equal(progress.buttons,1); assert.equal(progress.duration,10000); assert.equal(progress.easing,'linear'); assert.equal(progress.height,3);
  const progressContrast=contrast(progress.foreground,progress.background); assert.ok(progressContrast>=3);
  observations.push({probe:'toast-countdown-progress',...progress,contrast:progressContrast});
  await callRoot(session,root,"this.querySelector('button').focus();");
  const outline=await callRoot(session,root,"return getComputedStyle(this.querySelector('button')).outlineColor;");
  assert.equal(outline,progress.foreground);
  await page.keyboard.press('Space');
  await page.locator('sfvi-t').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'host-control');
  await notify(page,'Click anywhere');
  await page.evaluate(() => {
    window.toastDismissFrames = [];
    const started = performance.now();
    const sample = () => {
      const wrap = document.querySelector('[data-sfvi-notifications]');
      toastDismissFrames.push({ at: performance.now() - started, clientHeight: wrap.clientHeight,
        scrollHeight: wrap.scrollHeight, clientWidth: wrap.clientWidth, scrollWidth: wrap.scrollWidth });
      if (performance.now() - started < 350) requestAnimationFrame(sample);
      else window.toastDismissSamplingDone = true;
    };
    sample();
  });
  await page.locator('sfvi-t').click();
  await page.locator('sfvi-t').waitFor({state:'detached'});
  await page.waitForFunction(() => window.toastDismissSamplingDone);
  const dismissFrames = await page.evaluate(() => toastDismissFrames);
  assert.ok(dismissFrames.every(frame => frame.scrollHeight <= frame.clientHeight + 1 && frame.scrollWidth <= frame.clientWidth + 1), JSON.stringify(dismissFrames));
  observations.push({probe:'toast-dismissal-has-no-transient-scroll-overflow',frames:dismissFrames});
  await notify(page,'Focused card');
  root=await closedToast(session);
  await callRoot(session,root,"this.querySelector('button').focus();");
  for(let index=0;index<5;index++) await notify(page,`Asset updated ${index}`);
  assert.equal(await page.locator('sfvi-t').count(),3);
  assert.equal(await page.locator('sfvi-t[ti="Focused card"]').count(),1);
  await page.keyboard.press('Escape');
  await page.locator('sfvi-t[ti="Focused card"]').waitFor({state:'detached'});
  await page.evaluate(()=>document.querySelectorAll('sfvi-t').forEach(element=>element.remove()));
  await notify(page,'Hover continues',700);
  await page.locator('sfvi-t').hover();
  root=await closedToast(session);
  const hoverBorder=await callRoot(session,root,"return getComputedStyle(this.querySelector('button')).borderTopColor;");
  assert.equal(hoverBorder,'rgb(251, 191, 36)');
  const beforeHover=await callRoot(session,root,"return this.querySelector('.progress-fill').getAnimations()[0].currentTime;");
  await page.waitForTimeout(180);
  const afterHover=await callRoot(session,root,"return this.querySelector('.progress-fill').getAnimations()[0].currentTime;");
  assert.ok(afterHover-beforeHover>=100);
  await page.locator('sfvi-t').waitFor({state:'detached',timeout:1600});
  observations.push({probe:'toast-hover-does-not-pause',beforeHover,afterHover});
  await page.mouse.move(1,1);
  await notify(page,'Keyboard focus pauses',700);
  root=await closedToast(session);
  await callRoot(session,root,"this.querySelector('button').focus();");
  const pausedAt=await callRoot(session,root,"return this.querySelector('.progress-fill').getAnimations()[0].currentTime;");
  await page.waitForTimeout(850);
  assert.equal(await page.locator('sfvi-t').count(),1);
  const stillPaused=await callRoot(session,root,"return this.querySelector('.progress-fill').getAnimations()[0].currentTime;");
  assert.ok(Math.abs(stillPaused-pausedAt)<30);
  await page.locator('#host-control').focus();
  await page.locator('sfvi-t').waitFor({state:'detached',timeout:2000});
  observations.push({probe:'toast-keyboard-focus-pause',pausedAt,stillPaused});
  const defaultStarted=Date.now();
  await notify(page,'Default duration',null);
  root=await closedToast(session);
  const defaultDuration=await callRoot(session,root,"return this.querySelector('.progress-fill').getAnimations()[0].effect.getTiming().duration;");
  assert.equal(defaultDuration,5000);
  await page.locator('sfvi-t').waitFor({state:'detached',timeout:6500});
  const defaultElapsed=Date.now()-defaultStarted;
  assert.ok(defaultElapsed>=4900 && defaultElapsed<6500);
  observations.push({probe:'toast-default-expiry',duration:defaultDuration,elapsed:defaultElapsed});
  await worker.evaluate(()=>chrome.storage.local.set({sfvi_theme:'light'}));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:320,height:740});
  await notify(page,'Light notification');
  root=await closedToast(session);
  const light=await callRoot(session,root,"const c=this.querySelector('#c'),bar=this.querySelector('.progress-fill');return {background:getComputedStyle(c).backgroundColor,transition:getComputedStyle(this.host).transitionDuration,transform:getComputedStyle(this.host).transform,progressEasing:bar.getAnimations()[0].effect.getTiming().easing,progressColor:getComputedStyle(bar).backgroundColor,progressTrack:getComputedStyle(bar.parentNode).backgroundColor};");
  observations.push({probe:'light-reduced-motion-toast',...light});
  assert.equal(light.background,'rgb(253, 253, 254)');
  assert.equal(light.transition,'0s'); assert.equal(light.transform,'none');
  assert.match(light.progressEasing,/^steps\(/);
  assert.ok(contrast(light.progressColor,light.progressTrack)>=3);
  await page.locator('sfvi-t').screenshot({path:join(artifacts,'toast-light.png')});
  await page.screenshot({path:join(artifacts,'toast-mobile.png')});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(() => document.querySelectorAll('sfvi-t').forEach(element => element.remove()));
  await page.setViewportSize({width:320,height:220});
  for (let index=0;index<3;index++) await notify(page,`Long notification ${index}: ` + 'Long URL and rule information '.repeat(12));
  const tallStack = await page.evaluate(() => {
    const wrap=document.querySelector('[data-sfvi-notifications]');
    return {height:wrap.clientHeight,scrollHeight:wrap.scrollHeight,width:wrap.clientWidth,scrollWidth:wrap.scrollWidth,overflow:getComputedStyle(wrap).overflowY};
  });
  assert.ok(tallStack.scrollHeight > tallStack.height);
  assert.ok(tallStack.scrollWidth <= tallStack.width);
  assert.equal(tallStack.overflow,'auto');
  await page.locator('#host-control').focus();
  for (let index=0;index<3;index++) await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.querySelector('[data-sfvi-notifications]').scrollTop > 0));
  assert.ok((await page.evaluate(() => document.activeElement.getAttribute('ti'))).startsWith('Long notification 2:'));
  observations.push({probe:'tall-toast-stack-remains-scrollable-and-keyboard-reachable',...tallStack});
  await page.screenshot({path:join(artifacts,'toast-short-viewport.png')});
  await page.evaluate(() => document.querySelectorAll('sfvi-t').forEach(element => element.remove()));
  await page.setViewportSize({width:390,height:844});
  await page.mouse.move(1,1);
  const matrix = [
    ...['default','light','neon','pink','red'].map(id=>({label:id,stored:{sfvi_theme:id}})),
    {label:'custom-dark',stored:{sfvi_theme:'custom',sfvi_theme_custom:{bg:'#11141c',surface:'#202635',accent:'#e7a5d8'}}},
    {label:'custom-light',stored:{sfvi_theme:'custom',sfvi_theme_custom:{bg:'#f8f4f7',surface:'#ffffff',accent:'#754ca8'}}},
  ];
  const types={rest:'#22d3ee',gql:'#fb7185',html:'#60a5fa',js:'#fbbf24',css:'#a78bfa'};
  const normalize=value=>value.replace(/\s/g,'').toLowerCase();
  const cssColor=value=>value.startsWith('#') ? 'rgb('+value.slice(1).match(/../g).map(part=>parseInt(part,16)).join(',')+')' : normalize(value);
  for(const {label,stored} of matrix) {
    const expected=resolveTheme(stored);
    await worker.evaluate(stored=>chrome.storage.local.set(stored),stored);
    await page.waitForFunction(surface=>document.querySelector('[data-sfvi-notifications]').style.getPropertyValue('--sfvi-surface')===surface,expected['--surface']);
    await page.evaluate(()=>document.querySelectorAll('sfvi-t').forEach(element=>element.remove()));
    for(const [type,color] of Object.entries(types)) {
      await notify(page,type.toUpperCase()+' notification',10000,color);
      const host=await page.locator('sfvi-t').last().getAttribute('ti');
      // Read each new closed root through the browser protocol, including theme updates.
      const tree=await session.send('DOM.getDocument',{depth:-1,pierce:true});
      const find=node=>node.localName==='sfvi-t' && node.attributes?.includes(host) ? node : [...(node.children||[]),...(node.shadowRoots||[])].map(find).find(Boolean);
      const node=find(tree.root);
      const object=await session.send('DOM.resolveNode',{nodeId:node.shadowRoots[0].nodeId});
      const colors=await callRoot(session,{objectId:object.object.objectId},"const c=this.querySelector('#c'),bar=this.querySelector('.progress-fill'),mark=this.querySelector('.mark');return {background:getComputedStyle(c).backgroundColor,text:getComputedStyle(c).color,secondary:getComputedStyle(this.querySelector('.subtitle')).color,border:getComputedStyle(c).borderTopColor,marker:getComputedStyle(mark).color,progress:getComputedStyle(bar).backgroundColor,track:getComputedStyle(bar.parentNode).backgroundColor};");
      for(const [actual,token] of [['background','--surface'],['text','--text'],['secondary','--text2'],['border','--border2'],['marker','--t-'+type+'-c'],['progress','--t-'+type+'-c']]) {
        assert.equal(normalize(colors[actual]),cssColor(expected[token]),label+' '+type+' '+actual);
      }
      assert.ok(contrast(colors.marker,colors.background)>=3);
      assert.ok(contrast(colors.progress,colors.track)>=3);
      assert.ok(contrast(colors.text,colors.background)>=4.5);
      assert.ok(contrast(colors.secondary,colors.background)>=4.5);
      observations.push({probe:'toast-resource-theme',theme:label,type,...colors});
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.locator('sfvi-t').last().evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    await page.waitForFunction(() => {
      const cards = [...document.querySelectorAll('sfvi-t')];
      return cards.length === 3 && cards.every(card => getComputedStyle(card).opacity === '1');
    });
    await page.screenshot({path:join(artifacts,'toast-types-'+label+'.png')});
  }
  await page.close();
}

async function zoomProbe(page) {
  const session=await context.newCDPSession(page);
  await session.send('Emulation.clearDeviceMetricsOverride');
  const before=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,page.url());
  for(const zoom of [1.5,2]) {
    await worker.evaluate(({tabId,zoom})=>chrome.tabs.setZoom(tabId,zoom),{tabId,zoom});
    await page.waitForFunction(width => Math.abs(innerWidth - width) <= 1, before.width / zoom);
    const actual=await worker.evaluate(tabId=>chrome.tabs.getZoom(tabId),tabId);
    const after=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scrollWidth:document.documentElement.scrollWidth}));
    observations.push({probe:'browser-zoom',zoom:actual,before,after});
    assert.equal(actual,zoom); assert.ok(after.width<before.width && after.scrollWidth<=after.width);
    await page.screenshot({path:join(artifacts,`zoom-${zoom}.png`)});
    await audit(page,`zoom-${zoom}`);
  }
  await worker.evaluate(tabId=>chrome.tabs.setZoom(tabId,1),tabId);
}

try {
  const names=['Example page layout','Example API response','JavaScript asset replacement','Example event page','Remote banner example','Disabled feature example','Long example rule name for responsive layout and overflow checks'];
  const rules=names.map((name,index)=>({id:`legacy-${index}`,name,enabled:index!==5,resourceType:index===1?'rest':'html',resourceSubtype:index===2?'js':'html',urlPattern:index===2?'*checkout.bundle.js*':'https://events.example.test/event/*',responseBody:'// fixture'}));
  const source={id:'source_qa',name:'Shared sample rules for responsive frontend and layout testing',url:'https://fixtures.sfvi.test/qa.json',intervalMinutes:60,rules:[{...rules[1],id:'shared',name:'Shared response example',version:'2026.10.16'}]};
  writeFileSync(join(artifacts,'fixture.json'),JSON.stringify({rules,source},null,2));
  await worker.evaluate(({rules,source})=>chrome.storage.local.set({sfvi_rules:rules,sfvi_sources:[source],sfvi_theme:'default',sfvi_theme_vars:{'--bg':'#1c1c1e'}}),{rules,source});
  const popup=await context.newPage();
  await popup.setViewportSize({width:360,height:500});
  await popup.goto(`${extension}/popup/popup.html`);
  await popup.locator('.rule-item').first().waitFor();
  await popup.locator('[data-tab="all"]').click();
  assert.equal(await popup.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(15, 17, 23)');
  await popup.evaluate(()=>document.fonts.ready);
  assert.equal(await popup.locator('.rule-version').first().textContent(),'1.0.0');
  await popupGeometry(popup,'normal');
  await popup.screenshot({path:join(artifacts,'popup.png')});
  await audit(popup,'popup-long-list');
  await popup.setViewportSize({width:320,height:360});
  await popupGeometry(popup,'short');
  await popup.screenshot({path:join(artifacts,'popup-short.png')});
  await worker.evaluate(()=>chrome.storage.local.set({sfvi_apply_error:'Could not apply changed file rules. The last valid rules remain available.'}));
  await popup.reload();
  await popup.locator('#popup-error:not([hidden])').waitFor();
  await popupGeometry(popup,'error');
  await popup.screenshot({path:join(artifacts,'popup-error.png')});
  await audit(popup,'popup-error');
  await worker.evaluate(()=>chrome.storage.local.remove('sfvi_apply_error'));
  const page=await context.newPage();
  await page.goto(`${extension}/dashboard/dashboard.html`);
  await page.locator('.nav-rule').first().waitFor();
  await page.screenshot({path:join(artifacts,'dashboard.png')});
  await page.locator('[data-origin="remote"]').click();
  await page.locator('#btn-select-rules').click();
  await page.locator('#select-all-rules').click();
  assert.equal(await page.locator('#delete-selected').isDisabled(),true);
  const selected=await page.evaluate(async()=>[...(await import('./core/state.js')).state.selectedIds]);
  assert.equal(selected.length,1); assert.ok(selected[0].startsWith('remote:'));
  await page.locator('#btn-deselect-rules').click();
  await page.locator('[data-origin="all"]').click();
  for(const [width,height] of [[390,844],[320,740],[720,500]]) await drawerProbe(page,width,height);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#sidebar-collapse-btn').click();
  await page.locator('.nav-rule-open').first().focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#rules-drawer').evaluate(element=>element.open),false);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'f-name');
  await page.screenshot({path:join(artifacts,'editor-mobile.png')});
  await page.setViewportSize({width:720,height:500});
  await page.evaluate(async()=>{
    const {showSecurityWarning}=await import('./core/security.js');
    window.__warningPromise=showSecurityWarning(Array.from({length:8},(_,index)=>({sev:3,label:`Risk ${index+1}`,why:'Imported code can access page data; review before saving.'})));
  });
  await page.locator('#sfvi-sec-modal').waitFor();
  await audit(page,'security-warning-short');
  await page.locator('#sfvi-sec-accept').check();
  await page.locator('#sfvi-sec-save').scrollIntoViewIfNeeded();
  await page.screenshot({path:join(artifacts,'security-warning.png')});
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>window.__warningPromise),false);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'f-name');
  await page.setViewportSize({width:320,height:740});
  await page.evaluate(async()=>{
    (await import('./ui/theme.js')).applyTheme('light');
    (await import('./core/security.js')).showAllRisksPopup(['network_fetch']);
  });
  await page.locator('#sfvi-allrisks-popup').waitFor();
  await audit(page,'risk-reference-light');
  await page.locator('.risk-reference-scroll').evaluate(element=>{element.scrollTop=element.scrollHeight;});
  await page.screenshot({path:join(artifacts,'risk-reference-mobile.png')});
  await page.keyboard.press('Escape');
  await page.evaluate(async()=>(await import('./ui/theme.js')).applyTheme('default'));
  await page.setViewportSize({width:720,height:500});
  await zoomProbe(page);
  await toastProbes();
  writeFileSync(join(artifacts,'results.json'),JSON.stringify({observations,scans,screenReader:'not exercised',nativeHardware:'not exercised'},null,2));
  console.log('UI revision probes passed: scroll, legacy versions, theme restoration, expanded navigation, selection isolation, native security dialog, real zoom, and strict-CSP toast font/keyboard/motion.');
} catch(error) {
  for(const [index,page] of context.pages().entries()) await page.screenshot({path:join(artifacts,`failure-${index}.png`)}).catch(()=>{});
  writeFileSync(join(artifacts,'results-failed.json'),JSON.stringify({observations,scans,error:error.stack},null,2));
  throw error;
} finally { await context.close(); }
