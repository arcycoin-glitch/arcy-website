'use strict';
// Read-only public browser acceptance; only the image outage is simulated.
// Usage: node test/search-tsla-logo-live.cjs <origin> <external-output-directory>
const {chromium}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const origin=new URL(process.argv[2]).origin,out=process.argv[3];
const address='0x322f0929c4625ed5bad873c95208d54e1c003b2d';
const image='https://cdn.robinhood.com/ncw_assets/logos/'+address+'.png';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.ARCY_BROWSER_CHANNEL?{channel:process.env.ARCY_BROWSER_CHANNEL}:{})});
 const results=[];
 try{
  for(const width of [1440,390]){
   const errors=[],images=[];let outage=false;
   const freshPage=async()=>{
    const p=await browser.newPage({viewport:{width,height:width===390?844:1000}});
    p.on('pageerror',e=>errors.push(e.message));
    p.on('response',r=>{if(r.url()===image)images.push({status:r.status(),mime:r.headers()['content-type']});});
    await p.route(image,r=>outage?r.fulfill({status:503,body:''}):r.continue());return p;
   };
   let page=await freshPage();
   const started=Date.now();
   const report=page.waitForResponse(r=>r.url().includes('/api/search?')&&r.url().includes('action=report'),{timeout:90000});
   await page.goto(origin+'/search/token/robinhood/'+address,{waitUntil:'domcontentloaded'});
   const response=await report,data=await response.json();assert.equal(response.status(),200);
   assert.equal(data.chainId,4663);assert.equal(data.address,address);
   assert.equal(data.token.logoUrl,image);
   await page.waitForFunction(()=>document.querySelector('#detailState').textContent.includes('Snapshot complete'),{timeout:90000});
   const title=page.locator('#asset img.token-title-logo');await title.evaluate(e=>e.decode());
   assert.deepEqual(await title.evaluate(e=>[e.naturalWidth,e.naturalHeight]),[180,180]);
   await page.locator('#deepResearch').evaluate(e=>{e.open=true;});
   assert.equal(await page.locator('#cards .card').count(),5);assert.equal(await page.locator('#cards .metric').count(),20);
   await page.locator('#detailSearchChain').selectOption('robinhood');
   await page.locator('#detailSearchQuery').fill('TSLA');await page.locator('#detailSearchSubmit').click();
   const candidate=page.locator('#detailMatches .detail-match').filter({hasText:address});
   const avatar=candidate.locator('.detail-match-avatar');await avatar.scrollIntoViewIfNeeded();
   await avatar.locator('img').evaluate(e=>e.decode());assert.ok(await avatar.evaluate(e=>e.classList.contains('has-logo')));
   outage=true;
   // A new browser context avoids reusing a previously decoded image from
   // memory. No application cache or production configuration is changed.
   await page.close();page=await freshPage();
   await page.goto(origin+'/search/token/robinhood/'+address,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.querySelector('#detailState').textContent.includes('Snapshot complete'),{timeout:90000});
   await page.locator('#detailSearchChain').selectOption('robinhood');
   await page.locator('#detailSearchQuery').fill('TSLA');await page.locator('#detailSearchSubmit').click();
   await page.waitForFunction(()=>!document.querySelector('#detailSearchSubmit').disabled);
   await page.waitForFunction(()=>{const e=document.querySelector('#detailMatches .detail-match-avatar');return e&&!e.querySelector('img')&&!e.classList.contains('has-logo');});
   assert.equal(await page.locator('#detailMatches .detail-match-avatar').innerText(),'TS');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   outage=false;
   await page.goto(origin+'/#search',{waitUntil:'domcontentloaded'});
   await page.locator('.home-network-option[data-network="robinhood"]').click();
   await page.locator('#homeSearchQuery').fill('TSLA');
   const suggestion=page.locator('#homeSearchSuggestions .home-search-result').filter({hasText:address});
   await suggestion.waitFor();await suggestion.scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>{const e=document.querySelector('#homeSearchSuggestions .home-search-result img');return e?.complete&&e.naturalWidth>0;});
   assert.deepEqual(await suggestion.locator('img').evaluate(e=>[e.naturalWidth,e.naturalHeight]),[180,180]);
   outage=true;
   await page.close();page=await freshPage();
   await page.goto(origin+'/#search',{waitUntil:'domcontentloaded'});
   await page.locator('.home-network-option[data-network="robinhood"]').click();
   await page.locator('#homeSearchQuery').fill('TSLA');
   await page.waitForFunction(()=>{const e=document.querySelector('#homeSearchSuggestions .home-search-result .home-token-placeholder');return e&&!e.querySelector('img')&&e.textContent==='TS';});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.ok(images.some(i=>i.status===200&&i.mime?.includes('image/png')));
   assert.ok(images.some(i=>i.status===503));assert.deepEqual(errors,[]);
   results.push({origin,width,exactAddress:address,dimensions:[180,180],ms:Date.now()-started,
    title:true,detailDiscovery:true,homepageDiscovery:true,outageInitials:true,images,pass:true});
   if(out){await fs.mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,'tsla-initials-'+width+'.png')});}
   await page.close();
  }
  if(out)await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));
  console.log('PASS: actual TSLA API + browser PNG decode and simulated CDN503 initials fallback, desktop/mobile.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
