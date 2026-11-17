'use strict';
// Read-only, repeatable browser QA for Issue #263. Set ARCY_QA_BASE to compare
// Production and the exact PR preview under the same local browser conditions.
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');

const base=process.env.ARCY_QA_BASE||'https://www.arcyusdc.xyz';
const out=path.resolve(process.env.ARCY_QA_OUT||path.join(__dirname,'..','frontend-issue263-qa'));
const widths=[320,390,800,1024,1440];
const runs=Math.max(1,Math.min(5,Number(process.env.ARCY_QA_RUNS)||3));
const init=()=>{
 window.__arcyVitals={lcp:[],cls:0};
 new PerformanceObserver(list=>{for(const e of list.getEntries())window.__arcyVitals.lcp.push({startTime:e.startTime,size:e.size,element:e.element?.tagName||null,url:e.url||null});}).observe({type:'largest-contentful-paint',buffered:true});
 new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.__arcyVitals.cls+=e.value;}).observe({type:'layout-shift',buffered:true});
};

(async()=>{
 await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({headless:true});
 const result={base,measuredAt:new Date().toISOString(),browser:'Playwright Chromium 1.56.1',conditions:'4x CPU, 1.6 Mbps down, 750ms RTT, no reduced motion, cold browser context for each measurement',widths:[],mobileRuns:[]};
 try{
  for(const width of widths){
   const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1,reducedMotion:'no-preference'});
   const page=await context.newPage();
   const errors=[];page.on('pageerror',e=>errors.push(String(e.message).slice(0,160)));
   await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:45000});
   await page.waitForTimeout(1000);
   const dom=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,owl:document.querySelectorAll('.owl img[alt="ARCY owl"]').length,search:document.querySelectorAll('.home-search').length,nav:document.querySelectorAll('nav a').length,
    touchTargets:[...document.querySelectorAll('.menu-toggle,.home-network-option,#unlockPrev,#unlockNext')].map(e=>{const r=e.getBoundingClientRect();return {id:e.id||e.getAttribute('aria-label'),width:Math.round(r.width),height:Math.round(r.height),visible:r.width>0&&r.height>0,label:e.getAttribute('aria-label')};})}));
   // A full-page capture alone does not always trigger native lazy loading.
   // Walk the page as a user would, then return to the hero for the screenshot.
   const height=await page.evaluate(()=>document.documentElement.scrollHeight);
   await page.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';});
   for(let y=0;y<height;y+=750){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(120);}
   await page.waitForTimeout(600);await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(200);
   await page.screenshot({path:path.join(out,`home-${width}.png`),fullPage:true});
   result.widths.push({width,...dom,errors});
   if(process.env.ARCY_QA_ASSERT==='1'){
    if(dom.overflow>0||dom.owl!==1||dom.search!==1||errors.length)throw Error('Homepage invariant failed at '+width+': '+JSON.stringify(dom));
    if(width<=800&&dom.touchTargets.some(t=>t.visible&&(t.width<44||t.height<44||!t.label)))throw Error('Touch target failed at '+width+': '+JSON.stringify(dom.touchTargets));
   }
   await context.close();
  }
  for(let i=0;i<runs;i++){
   const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,reducedMotion:'no-preference'});
   const page=await context.newPage();await page.addInitScript(init);
   const cdp=await context.newCDPSession(page);
   await cdp.send('Network.enable');
   await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:750,downloadThroughput:200000,uploadThroughput:100000});
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
   const started=Date.now();
   const response=await page.goto(base+'/',{waitUntil:'load',timeout:90000});
   await page.waitForTimeout(2500);
   const vitals=await page.evaluate(()=>({lcp:window.__arcyVitals.lcp.at(-1)||null,cls:window.__arcyVitals.cls,domContentLoaded:performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd||null,load:performance.getEntriesByType('navigation')[0]?.loadEventEnd||null}));
   result.mobileRuns.push({run:i+1,http:response?.status(),wallMs:Date.now()-started,...vitals});
   await context.close();
  }
  const values=result.mobileRuns.map(x=>x.lcp?.startTime).filter(Number.isFinite).sort((a,b)=>a-b);
  result.mobileLcpMedianMs=values.length?values[Math.floor(values.length/2)]:null;
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
