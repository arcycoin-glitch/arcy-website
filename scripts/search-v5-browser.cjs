'use strict';
const {chromium}=require('playwright'),{spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:3149';
const tokens=require('../test/fixtures/search-v5-contracts.json').filter(t=>!process.env.ARCY_V5_ONLY||process.env.ARCY_V5_ONLY.split(',').includes(t[0]+':'+t[1]));
(async()=>{
 const server=spawn(process.execPath,['dev.cjs'],{cwd:root,env:{...process.env,PORT:'3149'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let browser;const results=[],errors=[];
 try{
  await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j)});
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(()=>{
   const original=fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).includes('/api/search?action=progress'))response.clone().text().then(body=>window.__arcyPayload=body).catch(e=>window.__arcyPayloadError=String(e));return response};
   window.__arcyStages=[];addEventListener('arcy-search-progress',e=>window.__arcyStages.push({phase:e.detail.phase,availableFields:e.detail.availableFields,ms:performance.now(),visible:Boolean(document.querySelector('#asset').getClientRects().length)}))});
  page.on('pageerror',e=>errors.push(e.message));
  for(const [network,symbol,address]of tokens){
   const row={network,symbol,address,layouts:[]},start=performance.now();
   try{
    const pending=page.waitForResponse(r=>r.url().includes('action=progress')&&r.url().includes(address),{timeout:90000});
    await page.goto(origin+'/search/token/'+network+'/'+address,{waitUntil:'domcontentloaded'});
    const response=await pending;row.httpMs=Math.round(performance.now()-start);assert.equal(response.status(),200);
    await page.waitForFunction(()=>typeof window.__arcyPayload==='string'||window.__arcyPayloadError,{timeout:90000});
    const payload=await page.evaluate(()=>window.__arcyPayload);assert.ok(payload,await page.locator('#detailState').innerText());row.events=payload.trim().split('\n').map(s=>JSON.parse(s));row.report=row.events.find(e=>e.phase==='complete')?.report;
    row.httpMs=Math.round(performance.now()-start);assert.ok(row.report,'Progress stream must complete');assert.equal(row.report.chainId,{arc:5042,ethereum:1,robinhood:4663}[network]);
    assert.equal(row.report.address,address);assert.equal(row.report.cardCount,5);
    assert.equal(row.report.token.symbol.toUpperCase(),symbol);
    await page.waitForFunction(()=>document.querySelector('#detailState').textContent.includes('Snapshot complete'),{timeout:90000});
    row.renderMs=Math.round(performance.now()-start);row.domStages=await page.evaluate(()=>window.__arcyStages);
    row.firstUsefulMs=Math.round(row.domStages.find(e=>e.phase==='identity')?.ms);row.marketMs=Math.round(row.domStages.find(e=>['activity','liquidity'].includes(e.phase)&&e.availableFields>0)?.ms);
    const text=await page.locator('#asset').innerText();
    for(const v of [address,row.report.token.name,row.report.token.symbol])if(v)assert.ok(text.includes(v));
    row.available=Object.values(row.report.cards).reduce((n,c)=>n+Object.values(c.fields).filter(f=>f.dataState==='DATA_FOUND'&&f.value!==null&&f.value!==undefined).length,0);
    for(const width of [1440,390,320]){
     await page.setViewportSize({width,height:width===1440?1000:844});
     const visible=await page.locator('#cards > .card > .metric').count();assert.equal(visible,row.available);
     for(const item of await page.locator('#cards > .card > .metric').all())assert.ok(await item.isVisible());
     for(const d of await page.locator('#cards .missingGroup, #cards .unverifiedModules').all())assert.equal(await d.evaluate(e=>e.open),false);
     assert.equal(await page.locator('#cards .card').count(),5);assert.equal(await page.locator('#cards .metric').count(),20);
     assert.equal(await page.locator('#cards .proof-panel').count(),5);
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
     for(const card of await page.locator('#cards > .card').all())assert.ok(await card.evaluate(e=>e.scrollWidth<=e.clientWidth));
     row.layouts.push({width,visible,pass:true});
     if([1440,390].includes(width))await page.screenshot({path:path.join(root,'artifacts',network+'-'+symbol+'-'+width+'.png'),fullPage:true});
    }
    row.primaryLinks=await page.locator('#cards .proof-entry a').evaluateAll(items=>items.map(a=>a.href));
    for(const url of row.primaryLinks)assert.equal(new URL(url).protocol,'https:');
    await page.locator('#cards .unverifiedModules, #cards .missingGroup, #cards .proof-panel').evaluateAll(items=>items.forEach(e=>e.open=true));
    for(const m of await page.locator('#cards .metric').all())assert.ok(await m.isVisible());row.pass=true;
   }catch(e){row.error=e.message;row.pass=false}
   results.push(row);fs.writeFileSync(path.join(root,'artifacts/browser-v5.json'),JSON.stringify({profile:'local production permissions; existing DEX authorization; GoPlus gated',results,errors},null,2));
   console.log(network,symbol,row.pass?'PASS':row.error,row.httpMs,row.available);
  }
  assert.equal(results.length,tokens.length);assert.deepEqual(errors,[]);assert.ok(results.every(r=>r.pass));
 }finally{await browser?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
