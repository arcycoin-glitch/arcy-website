'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {chromium}=require('playwright');

const root=path.resolve(__dirname,'..');
const port=3149,origin='http://127.0.0.1:'+port;
const widths=[320,360,390,430,768,1024,1440];
const server=spawn(process.execPath,['dev.cjs'],{
 cwd:root,env:{...process.env,PORT:String(port)},
 stdio:['ignore','pipe','pipe']
});
let browser;
let errlog='';
server.stderr.on('data',d=>{errlog+=String(d).slice(-1000)});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ready=async()=>{
 for(let i=0;i<80;i++){
  if(server.exitCode!==null)throw Error('dev.cjs exited: '+errlog);
  try{const r=await fetch(origin+'/',{signal:AbortSignal.timeout(1000)});if(r.ok)return}catch{}
  await pause(250);
 }
 throw Error('local dev server did not respond: '+errlog);
};
(async()=>{
 try{
  await ready();
  browser=await chromium.launch({headless:true});
  const PONS='0x39dbed3a2bd333467115de45665cc57f813c4571';
  for(const width of widths){
   const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
   const exceptions=[];page.on('pageerror',e=>exceptions.push(e.message));
   await page.route('**/api/search?**',async route=>{
    const u=new URL(route.request().url());
    if(u.searchParams.get('action')!=='discover'){await route.continue();return}
    const chain=u.searchParams.get('chain'),q=u.searchParams.get('q');
    const match={network:'robinhood',chainId:4663,address:PONS,name:'Pons',symbol:'PONS',
      identity:{status:'NOT_VERIFIED'},source:'Previously observed Robinhood DEX token-index candidate'};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      ok:true,network:chain,chainId:chain==='all'?null:chain==='arc'?5042:chain==='ethereum'?1:4663,
      matches:q?.toLowerCase()==='pons'&&['all','robinhood'].includes(chain)?[match]:[],
      providerError:false
    })});
   });
   await page.goto(origin+'/#search',{waitUntil:'domcontentloaded',timeout:25000});
   await page.locator('.home-search').waitFor({timeout:12000});
   await page.locator('.home-search').scrollIntoViewIfNeeded();
   const state=await page.evaluate(()=>{
    const box=el=>{const r=el.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
    const root=document.querySelector('#search .home-search');
    const input=document.querySelector('#search .home-search-input-wrap');
    const picker=document.querySelector('#search .home-network-picker');
    const submit=document.querySelector('#search .home-search-submit');
    const options=[...document.querySelectorAll('#search .home-network-option')];
    const labels=options.map(o=>({label:o.textContent.trim(),selected:o.getAttribute('aria-pressed'),
      height:box(o).h,contained:box(o).x>=box(picker).x-1&&box(o).right<=box(picker).right+1}));
    const logos=[...document.querySelectorAll('#search .home-network-option[data-network] img')]
     .map(i=>({src:i.getAttribute('src'),loaded:i.complete&&i.naturalWidth>0}));
    return {outer:box(root),input:box(input),picker:box(picker),submit:box(submit),
      labels,logos,width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth};
   });
   assert(state.outer.x>=-1&&state.outer.right<=width+1,'outer card overflow '+width+' '+JSON.stringify(state.outer));
   assert(state.input.y<state.picker.y&&state.picker.y<state.submit.y,
     'input -> network -> CTA order '+width+' '+JSON.stringify(state));
   assert(state.labels.length===4,'exactly four accessible choices '+width);
   assert(state.labels.every(x=>x.height>=38&&x.contained),'clipped network buttons '+width+' '+JSON.stringify(state.labels));
   assert(state.labels[0].label.includes('All 3 Networks')&&state.labels[0].selected==='true',
    'explicit All 3 Networks default '+width);
   assert(state.logos.length===3&&state.logos.every(x=>x.loaded),'missing official network SVG mark '+width);
   assert(state.submit.h>=44,'CTA must be tappable '+width);
   assert(state.input.w>150,'input must remain usable '+width);
   assert(exceptions.length===0,'JS console exception '+width+' '+exceptions.join(' | '));
   if(width===390){
    await page.locator('#homeSearchQuery').fill('PONS');
    await page.locator('.home-search-submit').click();
    await page.locator('a.home-search-result[href="/search/token/robinhood/'+PONS+'"]').first().waitFor({timeout:11000});
    await page.locator('.home-network-option[data-network="ethereum"]').click();
    assert.equal(await page.locator('.home-network-option[data-network="ethereum"]').getAttribute('aria-pressed'),'true');
   }
   console.log('RESPONSIVE_PASS',width,JSON.stringify({
      cardWidth:Math.round(state.outer.w),inputY:Math.round(state.input.y),
      pickerY:Math.round(state.picker.y),submitY:Math.round(state.submit.y),
      choices:state.labels.length,logosLoaded:state.logos.length}));
   await page.close();
  }
  console.log('COMPACT_HOME_SEARCH_ACCEPTANCE_OK 7 widths + exact Robinhood PONS');
 }finally{
  await browser?.close();
  server.kill('SIGTERM');
 }
})().catch(e=>{console.error('COMPACT_HOME_SEARCH_ACCEPTANCE_FAILED',e.stack||String(e));process.exitCode=1;server.kill('SIGTERM');});
