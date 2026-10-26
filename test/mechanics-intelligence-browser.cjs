'use strict';
// Rendering fixtures only, not real-source evidence.
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),schema=require('../search/server/schema'),origin='http://127.0.0.1:3126',address='0x'+'1'.repeat(40);
(async()=>{let browser;const server=spawn(process.execPath,['dev.cjs'],{cwd:root,env:{...process.env,PORT:'3126'},windowsHide:true,stdio:['ignore','pipe','pipe']});
try{await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j);});browser=await chromium.launch({headless:true,channel:process.env.ARCY_BROWSER_CHANNEL||'msedge'});let checks=0;
for(const width of[1440,390])for(const [network,chainId]of Object.entries({arc:5042,ethereum:1,robinhood:4663})){
const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const unknown=()=>({value:null,dataState:'NOT_VERIFIED',status:'NOT_VERIFIED',reason:'Unknown fixture',evidence:[]});
const fact=value=>({value,status:'VERIFIED_SOURCE',dataState:'DATA_FOUND',chainId,network,source:'Reviewed browser fixture',evidence:[{address,chainId,block:'0x10',method:'Fixture'}]});
const cards=Object.fromEntries(schema.map(c=>[c.id,{fields:Object.fromEntries(c.fields.map(([k])=>[k,unknown()]))}]));
const data={ok:true,chainId,network,address,block:'0x10',cardCount:5,token:{name:'Fixture',symbol:'TEST'},cards};
await page.route('**/api/search?**',r=>r.fulfill({json:data}));await page.route('https://www.geckoterminal.com/**',r=>r.fulfill({contentType:'text/html',body:'Fixture chart'}));
await page.goto(origin+'/search/token/'+network+'/'+address);await page.waitForFunction(()=>document.querySelector('#detailState').textContent.includes('Snapshot complete'));
await page.locator('#deepResearch').evaluate(e=>e.open=true);
const selector='#cards [data-card-id="mechanics"]';
for(const mode of['unknown','architecture','partial-tax','two-rows','full-tax','lost-source','historical','recovered']){
 data.cards.mechanics.fields=Object.fromEntries(schema.find(c=>c.id==='mechanics').fields.map(([k])=>[k,unknown()]));const f=data.cards.mechanics.fields;
 if(mode!=='unknown'&&mode!=='full-tax')f.contractArchitecture=fact('NON-PROXY');
 if(mode==='partial-tax')f.tradingTaxes=fact('Transfer 0% · DEX/hook fees NOT VERIFIED');
 if(['two-rows','historical','recovered'].includes(mode))f.mintCapability=fact('Role-gated mint');
 if(mode==='full-tax')f.tradingTaxes=fact('Buy 0% · Sell 2% · Transfer 0%');
 if(mode==='historical')for(const x of Object.values(f).filter(x=>x.dataState==='DATA_FOUND'))x.freshness={state:'LAST_VERIFIED',observedAt:'2026-10-01T00:00:00Z'};
 await page.evaluate(d=>render(d,{preserve:true}),data);
 const visible=['architecture','partial-tax','two-rows','full-tax','historical','recovered'].includes(mode);assert.equal(await page.locator(selector).count(),visible?1:0,mode);
 if(visible){assert.ok(await page.locator(selector).isVisible());assert.equal(await page.locator(selector+' > .metric').count(),4);await page.locator(selector+' .proof-panel').evaluate(e=>e.open=true);assert.equal(await page.locator(selector+' .proof-entry').count(),4);if(mode==='historical')assert.match(await page.locator(selector).innerText(),/HISTORICAL/);}
 else assert.match(await page.locator('#evidenceCount').innerText(),/Contract & Mechanics has no evidence-backed fields/);
 assert.equal(await page.locator('#cards .card').count(),visible?5:4);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
}
assert.deepEqual(errors,[]);await page.close();}
console.log('PASS:'+checks+' multichain desktop/mobile hidden/reveal/recovery/history/evidence scenarios; other four cards preserved.');
}finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
