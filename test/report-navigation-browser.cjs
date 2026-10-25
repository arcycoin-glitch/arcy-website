'use strict';
// Rendering fixtures, never live token/data evidence.
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),schema=require('../search/schema'),address='0x'+'1'.repeat(40),origin='http://127.0.0.1:3157';
(async()=>{let browser;const server=spawn(process.execPath,['dev.cjs'],{cwd:root,env:{...process.env,PORT:'3157'},windowsHide:true,stdio:['ignore','pipe','pipe']});
try{await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j)});browser=await chromium.launch({headless:true,channel:'msedge'});
for(const width of[320,360,390,430,768,1440]){
 const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'}),errors=[];let calls=0;
 page.on('pageerror',e=>errors.push(e.message));
 const cards=Object.fromEntries(schema.map(s=>[s.id,{fields:Object.fromEntries(s.fields.map(([key])=>[key,{value:1,dataState:'DATA_FOUND',status:'VERIFIED_SOURCE',chainId:5042,network:'arc',source:'Browser fixture',evidence:[{address,chainId:5042,block:'0x10',method:'Browser fixture'}]}]))}]));
 cards.mechanics.fields.tradingTaxes.value='Buy 0% · Sell 0% · Transfer 0%';
 const report={ok:true,address,network:'arc',chainId:5042,block:'0x10',cardCount:5,token:{name:'Fixture',symbol:'TEST'},cards};
 await page.route('**/api/search?**',r=>{calls++;return r.fulfill({json:report})});
 await page.route('https://www.geckoterminal.com/**',r=>r.fulfill({body:'Chart fixture',contentType:'text/html'}));
 await page.goto(origin+'/search/token/arc/'+address,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('detailState').textContent.includes('Snapshot complete'));
 assert.equal(await page.locator('#reportNavigation a').count(),5);assert.equal(await page.locator('#cards .card').count(),5);assert.equal(await page.locator('#cards .metric').count(),20);
 const before=calls;
 for(const id of['liquidity','holders','mechanics','supply','activity']){
  await page.locator('#deepResearch').evaluate(el=>el.open=false);
  const link=page.locator('#reportNavigation a[href="#research-'+id+'"]');await link.click();
  const target=page.locator('#research-'+id);await target.waitFor({state:'visible'});
  assert.equal(await page.locator('#deepResearch').evaluate(el=>el.open),true);
  await page.waitForFunction(id=>document.activeElement?.id==='research-'+id,id);
  assert.equal(await link.getAttribute('aria-current'),'location');
 }
 // Keyboard activation and ordinary scroll update the same existing anchors.
 await page.locator('#reportNavigation a').first().focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.activeElement.id==='research-liquidity');
 await page.locator('#research-activity').evaluate(el=>el.scrollIntoView({block:'start'}));await page.waitForTimeout(80);
 assert.equal(await page.locator('#reportNavigation [aria-current]').count(),1);
 assert.equal(calls,before,'navigation must never refetch a token');
 await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('#reportNavigation a').last().click();await page.waitForTimeout(800);assert.equal(await page.locator('#reportNavigation a').last().getAttribute('aria-current'),'location');
 // A source-empty category keeps its existing nested disclosure; shortcut opens it.
 const partial=JSON.parse(JSON.stringify(report));for(const f of Object.values(partial.cards.holders.fields)){f.value=null;f.dataState='NOT_VERIFIED';f.status='NOT_VERIFIED';}
 await page.evaluate(value=>render(value,{preserve:true}),partial);await page.locator('#reportNavigation a[href="#research-holders"]').click();await page.waitForFunction(()=>document.activeElement.id==='research-holders');assert.equal(await page.locator('#cards .unverifiedModules').evaluate(el=>el.open),true);
 // Existing Mechanics evidence policy is not overridden by navigation.
 for(const f of Object.values(partial.cards.mechanics.fields)){f.value=null;f.dataState='NOT_VERIFIED';f.status='NOT_VERIFIED';}
 await page.evaluate(value=>render(value,{preserve:true}),partial);await page.locator('#reportNavigation a[href="#research-mechanics"]').click();assert.match(await page.locator('#reportNavigationStatus').innerText(),/Contract & Mechanics/);assert.equal(await page.locator('#research-mechanics').count(),0);assert.equal(calls,before);
 await page.evaluate(value=>render(value,{preserve:true}),report);await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator('#research-liquidity .proof-panel').evaluate(el=>el.open=true);assert.equal(await page.locator('#research-liquidity .proof-panel').evaluate(el=>el.open),true);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow');
 await page.locator('#reportNavigation').scrollIntoViewIfNeeded();
 fs.mkdirSync(path.resolve(root,'../.runtime/v7-navigation'),{recursive:true});await page.screenshot({path:path.resolve(root,'../.runtime/v7-navigation/'+width+'.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS '+width+': five shortcuts,20 metrics, keyboard, expansion, normal scroll, no requests, evidence, no overflow');await page.close();
}
}finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
