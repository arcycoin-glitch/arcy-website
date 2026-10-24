'use strict';
// Read-only real-source acceptance; no Search API fixtures, provider approvals,
// queue writes or production deployments. Resizes preserve each real snapshot.
const {chromium}=require('playwright'),{spawn}=require('node:child_process');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]),port=Number(process.argv[4]||3135);
const origin='http://127.0.0.1:'+port,tokens=require('./fixtures/search-v4-contracts.json').filter(t=>!process.env.ARCY_V4_ONLY||process.env.ARCY_V4_ONLY.split(',').includes(t[0]+':'+t[1]));
const widths=[1440,768,390,320];
async function artwork(locator){
 await locator.evaluateAll(items=>Promise.all(items.map(e=>Promise.race([e.decode().catch(()=>{}),new Promise(r=>setTimeout(r,5000))]))));
 return locator.evaluateAll(items=>items.map(e=>({url:e.getAttribute('src'),loaded:e.complete&&e.naturalWidth>0,width:e.naturalWidth,height:e.naturalHeight})));
}
(async()=>{
 await fs.mkdir(output,{recursive:true});const env={...process.env,PORT:String(port),VERCEL:'1',VERCEL_ENV:'production'};
 delete env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED;delete env.GOPLUS_PUBLIC_DISPLAY_APPROVED;
 const server=spawn(process.execPath,['dev.cjs'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
 const results=process.env.ARCY_V4_RESUME==='1'?JSON.parse(await fs.readFile(path.join(output,'results.json'),'utf8')).results.filter(x=>x.pass):[];
 try{
  await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j);setTimeout(()=>j(Error('Startup')),10000).unref();});
  browser=await chromium.launch({headless:true,channel:process.env.ARCY_BROWSER_CHANNEL||'msedge'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const imageResponses=[];
  page.on('response',r=>{if(r.request().resourceType()==='image')imageResponses.push({url:r.url(),status:r.status(),mime:r.headers()['content-type']});});
  for(const [network,symbol,address]of tokens){
   if(results.some(x=>x.network===network&&x.address===address))continue;
   const entry={network,symbol,address,checkedAt:new Date().toISOString()},start=Date.now(),imageStart=imageResponses.length;
   try{
    await page.setViewportSize({width:1440,height:1000});
    let response;entry.rateLimitRetries=[];
    for(let attempt=0;attempt<3;attempt++){
     const pending=page.waitForResponse(r=>r.url().includes('/api/search?')&&r.url().includes('action=report')&&r.url().includes(address),{timeout:90000});
     await page.goto(origin+'/search/token/'+network+'/'+address,{waitUntil:'domcontentloaded'});
     response=await pending;
     if(response.status()!==429||attempt===2)break;
     const seconds=Number(response.headers()['retry-after']);
     assert.ok(Number.isFinite(seconds)&&seconds>0&&seconds<=60,'Bounded Retry-After required');
     entry.rateLimitRetries.push(seconds);await page.waitForTimeout(seconds*1000+100);
    }
    entry.httpStatus=response.status();entry.report=await response.json();entry.reportMs=Date.now()-start;
    assert.equal(response.status(),200);assert.equal(entry.report.address,address);assert.equal(entry.report.network,network);
    assert.equal(entry.report.chainId,{arc:5042,ethereum:1,robinhood:4663}[network]);
    await page.waitForFunction(()=>document.querySelector('#detailState').textContent.includes('Snapshot complete'),{timeout:90000});
    entry.visibleIdentity=await page.locator('#asset').innerText();
    for(const value of [entry.report.token.name,entry.report.token.symbol,address])assert.ok(entry.visibleIdentity.includes(value),'Exact visible token identity');
    assert.ok(await page.locator('#asset').isVisible());
    entry.logo=await artwork(page.locator('#asset img.token-title-logo'));
    assert.ok(await page.locator('#deepResearch').evaluate(e=>e.open),'Research cards open without user expansion');
    assert.equal(await page.locator('#cards > .card > .metric').count(),20,'All metric rows directly in their cards');
    assert.equal(await page.locator('#cards .unverifiedModules').count(),0);
    const mechanics=page.locator('#cards > .card').filter({has:page.locator('h2',{hasText:'Contract & Mechanics'})});
    assert.equal(await page.locator('#cards .card').count(),5);assert.equal(await page.locator('#cards .metric').count(),20);
    assert.equal(await mechanics.locator(':scope > .metric').count(),4);
    assert.equal(await page.locator('#cards .proof-panel').count(),5);
    entry.layouts=[];
    for(const width of widths){
     await page.setViewportSize({width,height:width===390?844:1000});
     for(const row of await page.locator('#cards > .card > .metric').all())assert.ok(await row.isVisible());
     for(const card of await page.locator('#cards > .card').all())assert.ok(await card.evaluate(e=>e.scrollWidth<=e.clientWidth),'No card overflow');
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Document overflow at'+width);
     assert.ok(await mechanics.evaluate(e=>e.scrollWidth<=e.clientWidth),'Card overflow at'+width);
     entry.layouts.push({width,visibleCards:5,visibleRows:20,visibleMechanicsRows:4,metrics:20,pass:true});
     if(['ONDO','GRT','TSLA','PONS'].includes(symbol)&&[390,1440].includes(width)){
      await mechanics.locator('details').evaluateAll(items=>items.forEach(e=>{e.open=false;}));
      await mechanics.screenshot({path:path.join(output,network+'-'+symbol+'-'+width+'.png')});
     }
    }
    await page.setViewportSize({width:1440,height:1000});
    const query=entry.report.token.symbol||symbol;
    await page.locator('#detailSearchChain').selectOption(network);await page.locator('#detailSearchQuery').fill(query);
    await page.locator('#detailSearchSubmit').click();await page.waitForFunction(()=>!document.querySelector('#detailSearchSubmit').disabled,{timeout:20000});
    const match=page.locator('#detailMatches .detail-match').filter({hasText:address});
    entry.detailDiscovery={query,exactMatch:await match.count()>0};
    if(entry.detailDiscovery.exactMatch){await match.scrollIntoViewIfNeeded();entry.detailDiscovery.images=await artwork(match.locator('img'));}
    await page.goto(origin+'/#search',{waitUntil:'domcontentloaded'});
    await page.locator('.home-network-option[data-network="'+network+'"]').click();
    const discovered=page.waitForResponse(r=>r.url().includes('/api/search?')&&r.url().includes('action=discover'),{timeout:15000}).catch(()=>null);
    await page.locator('#homeSearchQuery').fill(query);await discovered;await page.waitForTimeout(100);
    const home=page.locator('#homeSearchSuggestions .home-search-result').filter({hasText:address});
    entry.homeDiscovery={query,exactMatch:await home.count()>0};
    if(entry.homeDiscovery.exactMatch){await home.first().scrollIntoViewIfNeeded();entry.homeDiscovery.images=await artwork(home.first().locator('img'));}
    entry.pass=true;
   }catch(e){entry.error=e.message;entry.pass=false;}
   entry.imageResponses=imageResponses.slice(imageStart);results.push(entry);
   await fs.writeFile(path.join(output,'results.json'),JSON.stringify({mode:'real local API/public sources, conservative permission profile; no production deployment',results,errors},null,2));
   console.log(network,symbol,entry.pass?'PASS':entry.error,entry.reportMs);
   await page.waitForTimeout(3000);
  }
  assert.deepEqual(errors,[]);assert.ok(results.every(r=>r.pass),'Inspect any failed token individually; do not fabricate coverage');
  console.log('PASS:'+results.length+' exact-contract scans,'+results.length*widths.length+' responsive states, real image decoding, discovery and5 visible cards/20 visible fields.');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
