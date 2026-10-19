'use strict';
// Browser-only rendering fixtures; these are not real contract evidence.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:3126';
const schema=require('../search/server/schema');
const address='0x322f0929c4625ed5bad873c95208d54e1c003b2d';
const chains={arc:5042,ethereum:1,robinhood:4663};
const labels=['Trading Taxes','Mint Capability','Owner / Admin','Contract Architecture'];
const unknown=()=>({value:null,dataState:'NOT_VERIFIED',status:'NOT_VERIFIED',
 reasonCode:'INSUFFICIENT_EVIDENCE',reason:'No reliable exact-contract evidence is available.',evidence:[]});
const known=value=>({value,dataState:'DATA_FOUND',status:'VERIFIED_SOURCE',source:'Browser fixture only',evidence:[]});
function report(network,mode){
 const cards={};for(const spec of schema)cards[spec.id]={fields:Object.fromEntries(spec.fields.map(([k])=>[k,unknown()]))};
 if(mode==='architecture-only')cards.mechanics.fields.contractArchitecture=known('NON-PROXY · VERIFIED');
 if(mode==='missing-fields')cards.mechanics.fields={};
 if(mode==='missing-card')delete cards.mechanics;
 if(mode==='verified')cards.mechanics.fields={tradingTaxes:known('Buy 0% · Sell 0% · Transfer 0%'),
  mintCapability:known('NONE DETECTED ✓'),ownerAdmin:known('OWNER DETECTED'),contractArchitecture:known('PROXY · VERIFIED')};
 return {ok:true,network,chainId:chains[network],address,cardCount:5,cards,
  token:{name:'Visibility fixture',symbol:'TEST'},tokenIdentity:{status:'NOT_VERIFIED'},block:'0x10'};
}
(async()=>{
 const server=spawn(process.execPath,['dev.cjs'],{cwd:root,env:{...process.env,PORT:'3126'},
  windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j);setTimeout(()=>j(Error('Startup timeout')),10000).unref();});
  browser=await chromium.launch({headless:true,...(process.env.ARCY_BROWSER_CHANNEL?{channel:process.env.ARCY_BROWSER_CHANNEL}:{})});
  const results=[];
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:width===390?844:1000}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));let current;
   await page.route('**/api/search?**',route=>{
    const q=new URL(route.request().url()).searchParams;
    return route.fulfill(['report','progress'].includes(q.get('action'))?{json:current}:{status:503,json:{ok:false}});
   });
   await page.route('https://www.geckoterminal.com/**',r=>r.fulfill({contentType:'text/html',body:'<title>Chart fixture</title>'}));
   for(const network of Object.keys(chains))for(const mode of ['architecture-only','unverified','missing-fields','missing-card','verified']){
    const fixture=report(network,mode);
    // The API contract correctly rejects absent schema fields. Test renderer
    // resilience separately, without weakening that response validation.
    current=mode.startsWith('missing-')?report(network,'unverified'):fixture;
    await page.goto(origin+'/search/token/'+network+'/'+address,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#detailState').textContent.includes('Snapshot complete'));
    if(mode.startsWith('missing-'))await page.evaluate(data=>render(data),fixture);
    assert.ok(await page.locator('#deepResearch').evaluate(el=>el.open));
    assert.equal(await page.locator('#cards .card').count(),5);assert.equal(await page.locator('#cards .metric').count(),20);
    const count=mode==='verified'?0:mode==='architecture-only'?3:4;
    const card=page.locator('#cards .card').filter({has:page.locator('h2',{hasText:'Contract & Mechanics'})});
    assert.equal(await card.count(),1);
    if(count===4){
     assert.equal(await card.isVisible(),false,'Empty Mechanics category starts collapsed');
     await page.locator('#cards .unverifiedModules').evaluate(e=>e.open=true);
    }else assert.ok(await card.isVisible());
    assert.equal(await card.locator(':scope > .metric').count(),4-count);
    if(count){
     const missing=card.locator('.missingGroup');assert.equal(await missing.evaluate(e=>e.open),false);
     assert.equal(await missing.locator('.metric').count(),count);
     await missing.evaluate(e=>e.open=true);
    }
    const rows=card.locator('.metric');assert.equal(await rows.count(),4);
    assert.deepEqual((await rows.locator(':scope > span').allTextContents()).sort(),labels.slice().sort());
    for(const row of await rows.all())assert.ok(await row.isVisible());
    const values=await rows.locator('.result > b').allTextContents();
    assert.equal(values.filter(v=>v==='NOT VERIFIED').length,count);
    assert.equal(await rows.locator('.reason').count(),count);
    if(mode!=='missing-card'){
     assert.equal(await card.locator('.proof-panel').count(),1);
     await card.locator('.proof-panel').evaluate(el=>{el.open=true;});
     if(mode!=='missing-fields')assert.equal(await card.locator('.proof-entry').count(),4);
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
    assert.ok(await card.evaluate(el=>el.scrollWidth<=el.clientWidth),'No card clipping/overflow');
    const result={network,mode,width,rows:4,values,pass:true};results.push(result);
    if(process.argv[2]&&network==='robinhood'&&mode==='architecture-only'){
     await fs.mkdir(process.argv[2],{recursive:true});
     await card.screenshot({path:path.join(process.argv[2],'mechanics-'+width+'.png')});
    }
   }
   // Every category, including Mechanics, follows the identical clean-card rule.
   for(const spec of schema){
    const fixture=report('ethereum','verified');
    for(const category of schema)for(const [key] of category.fields)fixture.cards[category.id].fields[key]=known(0);
    for(const [key] of spec.fields)fixture.cards[spec.id].fields[key]={value:null,dataState:'NOT_VERIFIED',status:'NOT_VERIFIED',reason:'Explicit missing-source test reason',evidence:[]};
    await page.evaluate(data=>render(data),fixture);
    const group=page.locator('#cards .unverifiedModules');assert.equal(await group.count(),1);assert.equal(await group.evaluate(e=>e.open),false);
    const empty=group.locator('.card');assert.equal(await empty.count(),1);assert.equal(await empty.isVisible(),false);
    assert.equal(await empty.locator('.metric').count(),4);assert.equal(await page.locator('#cards > .card > .metric').count(),16);
    await group.evaluate(e=>e.open=true);await empty.locator('.missingGroup').evaluate(e=>e.open=true);
    for(const row of await empty.locator('.metric').all())assert.ok(await row.isVisible());
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  if(process.argv[2])await fs.writeFile(path.join(process.argv[2],'results.json'),JSON.stringify(results,null,2));
  console.log('PASS: 30 Mechanics scenarios plus 10 all-category empty-card/zero-value scenarios, 5 cards/20 fields retained, evidence and no overflow.');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
