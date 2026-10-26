'use strict';
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');require('./helpers/v7-scope.cjs')();
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:3162';
(async()=>{let browser;const server=spawn(process.execPath,['dev.cjs'],{cwd:root,env:{...process.env,PORT:'3162'},windowsHide:true,stdio:['ignore','pipe','pipe']});try{
 const capture=async(file,url)=>{const p=path.join(root,'../.runtime/'+file);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):await(await fetch(url,{signal:AbortSignal.timeout(20000)})).json();};
 const feed=await capture('pulse-v7-live.json','https://www.arcyusdc.xyz/api/pulse'),supply=await capture('burn-v2-live-supply.json','https://www.arcyusdc.xyz/api/supply?address=0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b');
 await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j)});browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('**/api/**',r=>{const p=new URL(r.request().url()).pathname;return r.fulfill({status:p==='/api/pulse'||p==='/api/supply'?200:503,json:p==='/api/pulse'?feed:p==='/api/supply'?supply:{ok:false}})});
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('pulseTitle').textContent.includes('#'));
 for(const width of[320,360,390,430,768,1440]){
  await page.setViewportSize({width,height:844});await page.evaluate(()=>scrollTo(0,0));let maximum=0;
  // Seek full orbital phases deterministically; a quick 3-second smoke misses the defect.
  for(const phase of[0,.125,.25,.375,.5,.625,.75,.875]){
   const result=await page.evaluate(async phase=>{for(const ring of document.querySelectorAll('#hero .hero-rings i'))for(const animation of ring.getAnimations()){animation.pause();animation.currentTime=Number(animation.effect.getTiming().duration)*phase;}await new Promise(requestAnimationFrame);return{viewport:innerWidth,scroll:document.documentElement.scrollWidth,ring:document.querySelector('#hero .hero-rings i').getBoundingClientRect().toJSON(),rotate:getComputedStyle(document.querySelector('#hero .hero-rings i')).rotate};},phase);
   maximum=Math.max(maximum,result.scroll);assert(result.scroll<=result.viewport+1,JSON.stringify({width,phase,...result}));
  }
  for(const id of['burn','pulse','unlocks','buy']){await page.locator('#'+id).scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  for(const chain of['ethereum','robinhood','arc']){await page.locator('[data-pulse-chain="'+chain+'"]').click();await page.waitForTimeout(40);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  assert.equal(await page.locator('#burned').innerText(),await page.evaluate(amount=>fmt(amount),supply.burnAddressBalance.amount));
  assert.equal(await page.locator('#burn video').getAttribute('src'),null);assert.equal(await page.locator('#hero .hero-flight>img').getAttribute('src'),'/assets/arcy-hero-video-poster-v8.webp');
  const docOverflow=await page.evaluate(()=>({html:getComputedStyle(document.documentElement).overflowX,body:getComputedStyle(document.body).overflowX}));assert(!['hidden','clip'].includes(docOverflow.html));assert(!['hidden','clip'].includes(docOverflow.body));
  console.log('PASS '+width+': full orbital rotation + section/tab switches; max scrollWidth='+maximum+'; no document clipping');
 }
 await page.emulateMedia({reducedMotion:'reduce'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));console.log('PASS reduced motion; all original four V7 features retained');
}finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
