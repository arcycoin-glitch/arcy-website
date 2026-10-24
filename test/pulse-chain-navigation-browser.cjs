'use strict';
// UI test replays an actual public Arc Pulse response; no invented chain news.
const {chromium}=require('playwright'),{spawn,execFileSync}=require('node:child_process'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:3159',base='b5d897dd5c5afb267e1bf4000c7ca6b2ea89f4f9';
const original=execFileSync('git',['show',base+':index.html'],{cwd:root,encoding:'utf8',maxBuffer:10000000}),current=fs.readFileSync(path.join(root,'index.html'),'utf8');
const normalize=s=>s.replace(/\r\n/g,'\n'),pulse=s=>s.match(/<section id="pulse"><div class="wrap">([\s\S]*?)<\/div><\/section>/)[1];
const arc=current.match(/<div id="pulse-panel-arc"[^>]*>([\s\S]*?)<\/div>\n <div id="pulse-panel-ethereum"/)[1];assert.equal(normalize(arc),normalize(pulse(original)),'original Arc markup must be byte-identical');
require('./helpers/v7-scope.cjs')();
const layout=()=>{const grid=document.getElementById('pulseGrid'),take=document.querySelector('#pulse .pulse-take');return{cards:[...grid.children].map(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{width:r.width,height:r.height,font:s.font,padding:s.padding,border:s.border,color:s.color}}),takeGap:take.getBoundingClientRect().top-grid.getBoundingClientRect().bottom,takeStyle:getComputedStyle(take).padding};};
(async()=>{let browser;const server=spawn(process.execPath,['dev.cjs'],{cwd:root,env:{...process.env,PORT:'3159'},windowsHide:true,stdio:['ignore','pipe','pipe']});try{
 const capture=path.join(root,'../.runtime/pulse-v7-live.json'),feed=fs.existsSync(capture)?JSON.parse(fs.readFileSync(capture,'utf8')):await(await fetch('https://www.arcyusdc.xyz/api/pulse')).json();assert.equal(feed.cards.length,3);
 await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j)});browser=await chromium.launch({headless:true,channel:'msedge'});
 for(const width of[1440,390]){
  const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});let requests=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',r=>{if(new URL(r.request().url()).pathname==='/api/pulse'){requests++;return r.fulfill({json:feed})}return r.fulfill({status:503,json:{ok:false}})});
  await page.route(origin+'/__baseline',r=>r.fulfill({contentType:'text/html',body:original}));await page.goto(origin+'/__baseline',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('pulseTitle').textContent.includes('#'));await page.locator('#pulse').scrollIntoViewIfNeeded();const baselineLayout=await page.evaluate(layout);
  await page.goto(origin+'/#pulse',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('pulseTitle').textContent.includes('#'));await page.locator('.pulse-chain-selector').scrollIntoViewIfNeeded();
  assert.deepEqual(await page.evaluate(layout),baselineLayout,'Arc card dimensions/style and TAKE spacing unchanged');
  const initial=await page.locator('#pulse-panel-arc').innerHTML(),initialArchive=await page.locator('#pulseArchive').getAttribute('href'),before=requests;assert.equal(await page.locator('[data-pulse-chain="arc"]').getAttribute('aria-selected'),'true');
  const headings=await page.locator('#pulseGrid .pulse-card > span').allTextContents();const sectionHeight=await page.locator('#pulse').evaluate(e=>e.offsetHeight);
  for(const chain of['ethereum','robinhood','arc']){
   await page.locator('[data-pulse-chain="'+chain+'"]').click();const panel=page.locator('#pulse-panel-'+chain);assert.equal(await panel.getAttribute('aria-hidden'),'false');assert.equal(await panel.locator('.pulse-card').count(),3);assert.deepEqual(await panel.locator('.pulse-card > span').allTextContents(),headings);assert.equal(await panel.locator('.pulse-take').count(),1);
   if(chain!=='arc'){assert.match(await panel.innerText(),/Verified weekly research has not been connected yet/);assert.equal(await panel.locator('a').count(),0);assert.equal(await panel.locator('[id="pulseTitle"]').count(),0);assert(!/(#\d{3})/.test(await panel.innerText()));}
   assert.equal(await page.locator('#pulse').evaluate(e=>e.offsetHeight),sectionHeight);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   fs.mkdirSync(path.join(root,'../.runtime/pulse-three-chain-v7'),{recursive:true});await page.locator('#pulse').screenshot({path:path.join(root,'../.runtime/pulse-three-chain-v7/'+width+'-'+chain+'.png')});
  }
  assert.equal(await page.locator('#pulse-panel-arc').innerHTML(),initial,'chain switches preserve Arc content, links and archive exactly');assert.equal(requests,before,'switching makes no API calls');
  await page.locator('[data-pulse-chain="arc"]').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-pulse-chain="ethereum"]').getAttribute('aria-selected'),'true');await page.keyboard.press('End');assert.equal(await page.locator('[data-pulse-chain="robinhood"]').getAttribute('aria-selected'),'true');await page.keyboard.press('Home');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('[data-pulse-chain="ethereum"]').click();await page.waitForTimeout(220);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Existing Arc refresh still targets its original IDs while another chain is active.
  await page.evaluate(()=>loadPulse());await page.locator('[data-pulse-chain="arc"]').click();assert.equal(await page.locator('#pulse-panel-arc').innerHTML(),initial);assert.equal(requests,before+1);assert(await page.locator('#pulseArchive').isVisible());assert.equal(await page.locator('#pulseArchive').getAttribute('href'),initialArchive);
  assert.deepEqual(errors,[]);console.log('PASS '+width+': Arc identical dimensions/content,3 matching headings,2 truthful skeletons,keyboard/touch targets,refresh/archive,no switch fetches/overflow/height shift');await page.close();
 }
}finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
