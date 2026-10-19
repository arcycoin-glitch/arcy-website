'use strict';
// Actual baseline DOM visibility measurements, not estimates from API latency.
const {chromium}=require('playwright'),{spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:3168';
(async()=>{
 const server=spawn(process.execPath,['dev.cjs'],{cwd:path.resolve(root,'../arcy-search-v5-baseline'),env:{...process.env,PORT:'3168'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let browser;const rows=[];
 try{
  await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j)});
  browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(()=>{
   const original=fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).includes('/api/search?action=report'))response.clone().json().then(body=>window.__baselineReport=body);return response};
   document.addEventListener('DOMContentLoaded',()=>{
    const observer=new MutationObserver(()=>{
     if(!window.__baselineIdentityMs&&document.querySelector('#asset')?.textContent&&document.querySelector('#detailState')?.textContent.includes('Snapshot complete')){
      window.__baselineIdentityMs=performance.now();window.__baselineMarketMs=performance.now();observer.disconnect();
     }
    });observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
   });
  });
  for(const[network,symbol,address]of require('../test/fixtures/search-v5-contracts.json')){
   const row={network,symbol,address};
   try{
    await page.goto(origin+'/search/token/'+network+'/'+address,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__baselineIdentityMs&&window.__baselineReport,{timeout:90000});
    Object.assign(row,await page.evaluate(()=>({firstUsefulMs:Math.round(window.__baselineIdentityMs),marketMs:Math.round(window.__baselineMarketMs),report:window.__baselineReport})));
    assert.equal(row.report.address,address);assert.equal(row.report.token.symbol.toUpperCase(),symbol);assert.equal(row.report.ok,true);row.pass=true;
   }catch(e){row.pass=false;row.error=e.message}
   rows.push(row);fs.writeFileSync(path.join(root,'artifacts/browser-baseline-dom.json'),JSON.stringify({profile:'same production DEX-approved, GoPlus-disabled local profile',results:rows},null,2));
   console.log(network,symbol,row.pass?'PASS':row.error,row.firstUsefulMs);
  }
  assert.ok(rows.every(r=>r.pass));
 }finally{await browser?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
