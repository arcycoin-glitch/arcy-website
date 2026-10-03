const {chromium}=require('C:/Users/cicek/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const server=spawn(process.execPath,['dev.cjs'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:'3116'},stdio:['ignore','pipe','pipe'],windowsHide:true});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
  browser=await chromium.launch({headless:true,channel:'msedge'});
  fs.mkdirSync('verification/hero-video',{recursive:true});
  for(const [name,viewport]of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
   const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/**',route=>route.fulfill({status:503,json:{ok:false}}));
   await page.goto('http://127.0.0.1:3116/#hero');
   const size=await page.locator('.hero-flight').evaluate(e=>[e.offsetWidth,e.offsetHeight]);
   await page.waitForFunction(()=>document.querySelector('.hero-video').readyState>=2&&!document.querySelector('.hero-video').paused,{timeout:15000});
   const video=await page.locator('.hero-video').evaluate(v=>({muted:v.muted,autoplay:v.autoplay,loop:v.loop,inline:v.playsInline,controls:v.controls,preload:v.preload,width:v.videoWidth,height:v.videoHeight,fit:getComputedStyle(v).objectFit}));
   assert(video.muted&&video.autoplay&&video.loop&&video.inline&&!video.controls);assert.equal(video.preload,'none');assert.equal(video.fit,'contain');
   assert.deepEqual(await page.locator('.hero-flight').evaluate(e=>[e.offsetWidth,e.offsetHeight]),size);
   assert.equal(await page.locator('.mechanics .row').count(),4);assert.equal(await page.locator('#search .card').count(),5);
   await page.screenshot({path:'verification/hero-video/'+name+'.jpg'});
   await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>!document.querySelector('.hero-video').hasAttribute('src'));assert.equal(await page.locator('.hero-video').getAttribute('src'),null);assert.equal(await page.locator('.hero-flight img').evaluate(e=>getComputedStyle(e).visibility),'visible');
   assert.deepEqual(errors,[]);console.log('PASS '+name+': '+JSON.stringify(video)+'; reserved frame unchanged; reduced-motion fallback');await page.close();
  }
  const reduced=await browser.newPage({reducedMotion:'reduce'});let videoRequests=0;reduced.on('request',r=>{if(r.url().endsWith('.mp4'))videoRequests++;});await reduced.goto('http://127.0.0.1:3116/#hero');await reduced.waitForTimeout(2200);assert.equal(videoRequests,0);assert.equal(await reduced.locator('.hero-video').getAttribute('src'),null);await reduced.close();
  const failed=await browser.newPage();await failed.route('**/*.mp4',r=>r.fulfill({status:404,body:''}));await failed.goto('http://127.0.0.1:3116/#hero');await failed.waitForFunction(()=>document.querySelector('.hero-video').error);assert.equal(await failed.locator('.hero-flight img').evaluate(e=>getComputedStyle(e).visibility),'visible');await failed.close();
  // A Search already in progress must take priority over lazy video loading.
  const priority=await browser.newPage();await priority.addInitScript(()=>addEventListener('DOMContentLoaded',()=>{document.getElementById('scan').dataset.pending='8';}));let queuedRequests=0;priority.on('request',r=>{if(r.url().endsWith('.mp4'))queuedRequests++;});await priority.goto('http://127.0.0.1:3116/#hero');await priority.waitForTimeout(2500);assert.equal(queuedRequests,0);await priority.locator('#scan').evaluate(e=>e.dataset.pending='0');await priority.waitForFunction(()=>document.querySelector('.hero-video').readyState>=2);assert.equal(queuedRequests,1);await priority.close();
  console.log('PASS: no video fetch under reduced motion or active Search; failed playback keeps original owl.');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
