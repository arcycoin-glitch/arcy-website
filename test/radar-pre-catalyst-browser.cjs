#!/usr/bin/env node
'use strict';
// Read-only Pons Launch skeleton QA; screenshots are evidence, never fixtures.
const {chromium}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.RADAR_QA_BASE||'https://www.arcyusdc.xyz';
const out=path.resolve(process.env.RADAR_QA_OUT||path.join(__dirname,'..','radar-issue275-qa'));
const widths=[320,390,800,1024,1440];
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({headless:true});
 const records=[];
 try{
  const context=await browser.newContext({viewport:{width:390,height:900}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL('/radar',base).href,{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#marketRadarPanel:not([hidden])').waitFor({timeout:25000});
  await page.locator('.arcy-radar-network[data-network="pons"]').click();
  await page.locator('.arcy-radar-overview-card[data-overview="pons"]:not([hidden])').waitFor();
  await page.waitForTimeout(1800);
  for(const width of widths){
   await page.setViewportSize({width,height:900});await page.waitForTimeout(350);
   const row=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,
    tabs:[...document.querySelectorAll('.arcy-radar-network')].map(x=>x.dataset.network),
    visibleCards:[...document.querySelectorAll('.arcy-radar-overview-card')].filter(x=>!x.hidden).map(x=>x.dataset.overview),
    ponsRows:document.querySelectorAll('.arcy-radar-overview-card[data-overview="pons"] .arcy-radar-overview-token').length,
    infoButtons:document.querySelectorAll('.arcy-radar-overview-card[data-overview="pons"] .arcy-radar-overview-reason-info').length,
    infoLabel:[...document.querySelectorAll('.arcy-radar-overview-card[data-overview="pons"] .arcy-radar-overview-reason-info')].every(x=>x.textContent==='ⓘ Info'&&x.getAttribute('aria-expanded')==='false'),
    searchLinks:[...document.querySelectorAll('.arcy-radar-overview-card[data-overview="pons"] a.arcy-radar-overview-token')].every(x=>/^\/search\/token\/robinhood\/0x[0-9a-f]{40}$/i.test(new URL(x.href).pathname))}));
   assert.equal(row.overflow,0,'horizontal overflow at '+width);
   assert.deepEqual(row.tabs,['pons','arc','ethereum','robinhood']);
   assert.deepEqual(row.visibleCards,['pons']);
   assert.ok(row.infoLabel,'Info button changes at '+width);
   assert.ok(row.searchLinks,'Pons exact-contract navigation changes at '+width);
   assert.deepEqual(errors,[]);
   await page.screenshot({path:path.join(out,'pons-'+width+'.png'),fullPage:true});
   records.push(row);
  }
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({base,at:new Date().toISOString(),records,errors},null,2));
  console.log(JSON.stringify({base,records,errors}));
  await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
