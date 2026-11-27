'use strict';
// Read-only, real public Radar rendering. No API mocks, configuration writes or
// synthetic token rows. Retains observed shortage/error states as test evidence.
const {chromium}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.RADAR_QA_BASE||'https://www.arcyusdc.xyz';
const out=path.resolve(process.env.RADAR_QA_OUT||'radar-326-browser');
const networks=['pons','arc','ethereum','robinhood'],widths=[320,390,800,1024,1440];
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:process.env.ARCY_BROWSER_CHANNEL||'chrome'});
 const records=[],responses=[],errors=[];
 try{
  const page=await browser.newPage({viewport:{width:390,height:900}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',async response=>{
   const url=new URL(response.url());
   if(url.pathname==='/api/search'&&url.searchParams.get('action')==='radar'){
    let body;try{body=await response.json();}catch{}
    responses.push({network:url.searchParams.get('chain'),http:response.status(),count:body?.tokens?.length??null,asOf:body?.asOf||null,freshness:body?.freshness||null,addresses:(body?.tokens||[]).map(x=>x.address)});
   }
  });
  await page.goto(new URL('/radar',base).href,{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#marketRadarPanel:not([hidden])').waitFor({timeout:30000});
  for(const network of networks){
   await page.locator('.arcy-radar-network[data-network="'+network+'"]').click();
   const card='.arcy-radar-overview-card[data-overview="'+network+'"]';
   await page.locator(card+':not([hidden])').waitFor();
   await page.waitForFunction(n=>document.querySelectorAll('.arcy-radar-overview-card[data-overview="'+n+'"] .arcy-radar-overview-token').length>0,network,{timeout:30000});
   const expand=page.locator(card+' .arcy-radar-overview-action');
   if(await expand.getAttribute('aria-expanded')==='false')await expand.click();
   for(const width of widths){
    await page.setViewportSize({width,height:900});
    await page.waitForTimeout(200);
    const record=await page.evaluate(n=>{
     const card=document.querySelector('.arcy-radar-overview-card[data-overview="'+n+'"]');
     return {network:n,width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,
      tabs:[...document.querySelectorAll('.arcy-radar-network')].map(x=>x.dataset.network),
      visible:[...document.querySelectorAll('.arcy-radar-overview-card')].filter(x=>!x.hidden).map(x=>x.dataset.overview),
      rows:[...card.querySelectorAll('a.arcy-radar-overview-token')].map(x=>new URL(x.href).pathname),
      info:card.querySelectorAll('.arcy-radar-overview-reason-info').length,
      state:document.getElementById('marketRadarStatus')?.textContent||null};
    },network);
    assert.equal(record.overflow,0,network+' overflow at '+width);
    assert.deepEqual(record.tabs,networks);assert.deepEqual(record.visible,[network]);
    assert.ok(record.rows.length>0&&record.rows.length<=10,'no fabricated padding to more than ten');
    assert.equal(new Set(record.rows).size,record.rows.length,'duplicate exact-contract links');
    const api=responses.filter(x=>x.network===network&&x.http===200).at(-1);
    assert.ok(api,'real API response retained');assert.equal(record.rows.length,api.count,'all returned rows are accessible through existing expand control');
    assert.deepEqual(record.rows.map(p=>p.split('/').at(-1)).sort(),[...api.addresses].sort(),'rendered contracts match source exactly');
    const chain=network==='pons'?'robinhood':network;
    assert.ok(record.rows.every(p=>new RegExp('^/search/token/'+chain+'/0x[0-9a-f]{40}$','i').test(p)),'wrong-chain navigation');
    assert.equal(record.info,record.rows.length);assert.deepEqual(errors,[]);
    if([390,1440].includes(width))await page.screenshot({path:path.join(out,network+'-'+width+'.png'),fullPage:true});
    records.push(record);
   }
  }
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({base,at:new Date().toISOString(),records,responses,errors},null,2));
  console.log(JSON.stringify({base,views:records.length,counts:Object.fromEntries(networks.map(n=>[n,records.find(r=>r.network===n)?.rows.length])),responses,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
