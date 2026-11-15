'use strict';
// Mechanics V5 rendering check at 320/390/800/1440 px on all three networks. Fixtures are produced by the real server
// formatter (data-engine.formatCard) so supplementary Transfer Restrictions and short reasons arrive exactly as in
// Production. Rendering fixtures only, not real-source evidence.
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),schema=require('../search/server/schema'),engine=require('../search/server/lib/data-engine'),{chain}=require('../search/server/lib/chains');
const origin='http://127.0.0.1:3127',address='0x'+'1'.repeat(40),block='0x10';
(async()=>{let browser;const server=spawn(process.execPath,['dev.cjs'],{cwd:root,env:{...process.env,PORT:'3127'},windowsHide:true,stdio:['ignore','pipe','pipe']});
try{await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j);});
 browser=await chromium.launch({headless:true,channel:process.env.ARCY_BROWSER_CHANNEL||'chrome'});let checks=0;
 for(const width of[320,390,800,1440])for(const [network,chainId]of Object.entries({arc:5042,ethereum:1,robinhood:4663})){
  const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const unknown=()=>({value:null,dataState:'NOT_VERIFIED',status:'NOT_VERIFIED',reason:'Unknown fixture',evidence:[]});
  const fact=value=>({value,status:'VERIFIED_SOURCE',dataState:'DATA_FOUND',chainId,network,source:'Reviewed browser fixture',evidence:[{address,chainId,block,method:'Fixture',scope:'Fixture scope.'}]});
  const cards=Object.fromEntries(schema.map(c=>[c.id,{fields:Object.fromEntries(c.fields.map(([k])=>[k,unknown()]))}]));
  const raw={description:'V5 fixture',fields:{tradingTaxes:fact('Transfer 0% · DEX/hook fees NOT VERIFIED'),mintCapability:fact('NONE DETECTED ✓'),
   ownerAdmin:{value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reasonCode:'MECHANICS_VERIFIED_SOURCE_UNAVAILABLE',reason:'Verified source unavailable.',explanation:'Long technical explanation kept in evidence.',evidence:[]},
   contractArchitecture:fact('NON-PROXY · runtime verified')},
   supplementary:{transferRestrictions:{...fact('Pause + blacklist · not paused'),status:'VERIFIED_SOURCE_AND_STATE',evidence:[{address,chainId,network,block,method:'Reviewed whenNotPaused/notBlacklisted transfer modifiers',scope:'transfer/transferFrom revert while paused and for blacklisted accounts.'}]}}};
  cards.mechanics=engine.formatCard('mechanics',raw,chain(network),{address,block});
  assert.equal(Object.keys(cards.mechanics.fields).length,4);assert.ok(cards.mechanics.supplementary.transferRestrictions.dataState==='DATA_FOUND');
  const data={ok:true,chainId,network,address,block,cardCount:5,token:{name:'Fixture',symbol:'TEST'},cards};
  await page.route('**/api/search?**',r=>r.fulfill({json:data}));await page.route('https://www.geckoterminal.com/**',r=>r.fulfill({contentType:'text/html',body:'Fixture chart'}));
  await page.goto(origin+'/search/token/'+network+'/'+address);await page.waitForFunction(()=>document.querySelector('#detailState').textContent.includes('Snapshot complete'));
  await page.locator('#deepResearch').evaluate(e=>e.open=true);
  await page.evaluate(d=>render(d,{preserve:true}),data);
  const card='#cards [data-card-id="mechanics"]';
  assert.equal(await page.locator('#cards .card').count(),6,'five analysis cards + Live Trading');
  assert.equal(await page.locator(card+' > .metric').count(),4,'four mechanics rows');
  assert.match(await page.locator('#evidenceCount').innerText(),/\/20 |20 checks|of 20/,'20-check tally unchanged');
  assert.match(await page.locator(card).innerText(),/Verified source unavailable\./,'short reason');
  assert.doesNotMatch(await page.locator(card+' > .metric').allInnerTexts().then(t=>t.join(' ')),/Long technical explanation/,'technical text not in rows');
  await page.locator(card+' .proof-panel').evaluate(e=>e.open=true);
  const proof=await page.locator(card+' .proof-list').innerText();
  assert.match(proof,/Transfer Restrictions: Pause \+ blacklist · not paused \(reviewed source at block 16\)/,'restriction evidence in View sources & evidence');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow at '+width);
  assert.deepEqual(errors,[]);await page.close();checks++;
 }
 console.log('PASS: Mechanics V5 rendering at 320/390/800/1440 px for arc/ethereum/robinhood ('+checks+' views); four rows, 20-check tally, short reasons and supplementary restrictions; mocked fixtures only.');
}finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exit(1);});
