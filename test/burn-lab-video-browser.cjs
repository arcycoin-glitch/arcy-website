'use strict';
// No substitute video is supplied. Lifecycle mocks exercise browser media events,
// not real codec playback. Scoreboard replay uses a captured public API response.
const {chromium}=require('playwright'),{spawn,execFileSync}=require('node:child_process'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:3158';
const baseline=execFileSync('git',['show','b5d897dd5c5afb267e1bf4000c7ca6b2ea89f4f9:index.html'],{cwd:root,encoding:'utf8',maxBuffer:10000000});
const current=fs.readFileSync(path.join(root,'index.html'),'utf8');
const strip=s=>s.replace(/<section id="burn">[\s\S]*?<\/section>/,'BURN_SECTION').replace(/\r\n/g,'\n');
assert.equal(strip(current.replace(/\r\n/g,'\n').replace('<link rel="stylesheet" href="/burn-lab-video.css">\n','').replace('<script src="/burn-lab-video.js" defer></script>\n','')),strip(baseline),'outside Burn markup and all data scripts must remain identical');
const originalImage=baseline.slice(baseline.indexOf('<section id="burn">')).match(/data:image\/webp;base64,([^"]+)/)[1];
assert(fs.readFileSync(path.join(root,'assets/burn-lab-poster.webp')).equals(Buffer.from(originalImage,'base64')),'original artwork byte preservation');
const capture=path.join(root,'../.runtime/burn-v2-live-supply.json');
(async()=>{let browser;const server=spawn(process.execPath,['dev.cjs'],{cwd:root,env:{...process.env,PORT:'3158'},windowsHide:true,stdio:['ignore','pipe','pipe']});
try{const snapshot=fs.existsSync(capture)?JSON.parse(fs.readFileSync(capture,'utf8')):await(await fetch('https://www.arcyusdc.xyz/api/supply?address=0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b',{signal:AbortSignal.timeout(20000)})).json();assert.equal(snapshot.ok,true);assert.equal(snapshot.burnAddressBalance.dataState,'DATA_FOUND');await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j);});browser=await chromium.launch({headless:true,channel:'msedge'});
for(const width of[1440,390]){
 const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});let supplyCalls=0,burnMedia=0;
 await page.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:Object.assign(new EventTarget(),{saveData:false})}));
 page.on('request',r=>{if(r.url().includes('burn-lab')&&/\.(mp4|webm)/.test(r.url()))burnMedia++;});
 await page.route('**/api/**',r=>{if(new URL(r.request().url()).pathname==='/api/supply'){supplyCalls++;return r.fulfill({json:snapshot});}return r.fulfill({status:503,json:{ok:false}});});
 await page.goto(origin+'/#burn',{waitUntil:'domcontentloaded'});await page.locator('#burn .burn-lab-scene').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>document.getElementById('burnStatus').textContent.startsWith('Live'));
 assert.equal(await page.locator('#burned').count(),1);assert.equal(await page.locator('#burnStatus').count(),1);assert.equal(await page.locator('#burned').innerText(),await page.evaluate(amount=>fmt(amount),snapshot.burnAddressBalance.amount));
 const video=page.locator('#burn video');assert.equal(await video.getAttribute('src'),null);assert.equal(await video.evaluate(v=>v.muted&&v.loop&&v.playsInline&&!v.controls&&v.preload==='none'),true);
 const box=await page.locator('.burn-lab-scene').boundingBox();await page.waitForTimeout(150);const after=await page.locator('.burn-lab-scene').boundingBox();assert.equal(after.height,box.height);assert.equal(await page.locator('.burn-lab-poster').evaluate(i=>i.complete&&i.naturalWidth>0),true);
 assert.equal(await page.locator('.burn-lab-play').isVisible(),false);assert.equal(burnMedia,0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 fs.mkdirSync(path.join(root,'../.runtime/burn-lab-v2'),{recursive:true});await page.locator('#burn').screenshot({path:path.join(root,'../.runtime/burn-lab-v2/'+width+'.png')});
 // Future-asset lifecycle only: no mock video file, audio or substitute artwork.
 await page.evaluate(()=>{const v=document.querySelector('#burn video');v.dataset.videoSrc='/assets/burn-lab-lifecycle-test.mp4';v.load=()=>{};v.play=()=>{v.dispatchEvent(new Event('playing'));return Promise.resolve();};v.pause=()=>v.dispatchEvent(new Event('pause'));v.setAttribute=(function(original){return function(name,value){if(name==='src')return;return original.call(this,name,value);};})(v.setAttribute);Object.defineProperty(v,'src',{set(){},get(){return ''}});});
 await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>document.querySelector('.burn-lab-scene').classList.contains('is-playing'));
 await page.evaluate(()=>scrollTo(0,0));await page.waitForFunction(()=>!document.querySelector('.burn-lab-scene').classList.contains('is-playing'));
 await page.locator('.burn-lab-scene').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.burn-lab-scene').classList.contains('is-playing'));
 await page.evaluate(()=>{navigator.connection.saveData=true;navigator.connection.dispatchEvent(new Event('change'));});await page.waitForFunction(()=>!document.querySelector('.burn-lab-scene').classList.contains('is-playing'));assert(await page.locator('.burn-lab-play').isVisible());await page.locator('.burn-lab-play').click();await page.waitForFunction(()=>document.querySelector('.burn-lab-scene').classList.contains('is-playing'));
 await page.evaluate(()=>document.querySelector('#burn video').dispatchEvent(new Event('error')));assert.equal(await page.locator('.burn-lab-scene').evaluate(el=>el.classList.contains('is-playing')),false);assert(await page.locator('.burn-lab-play').isVisible());await page.locator('.burn-lab-play').click();
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>!document.querySelector('.burn-lab-scene').classList.contains('is-playing'));
 assert.equal(supplyCalls,1,'media never refetches or changes blockchain data');assert.equal(burnMedia,0);console.log('PASS '+width+': original poster, live-response scoreboard, no video requests/CLS, responsive, reduced motion, offscreen pause; lifecycle mocked');await page.close();
}
}finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
