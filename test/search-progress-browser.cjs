'use strict';
// Controlled streaming fixture tests, explicitly separate from real-source acceptance.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),schema=require('../search/server/schema');
const root=path.resolve(__dirname,'..'),address='0x'+'7'.repeat(40);let mode='normal',market,finish,scans=0;
function snapshot(){return {ok:true,network:'ethereum',chainId:1,address,block:'0x123',cardCount:5,scannedAt:new Date().toISOString(),token:{name:'Streaming fixture',symbol:'TEST'},tokenIdentity:{status:'NOT_VERIFIED'},cards:Object.fromEntries(schema.map(c=>[c.id,{fields:Object.fromEntries(c.fields.map(([k])=>[k,{value:null,dataState:'NOT_VERIFIED',reason:'Fixture pending source',evidence:[]}]))}]))}}
const found=value=>({value,dataState:'DATA_FOUND',status:'SOURCE_REPORTED',network:'ethereum',chainId:1,source:'Browser fixture only',evidence:[{block:'0x123',address}]});
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/search'){
  if(url.searchParams.get('action')!=='progress'){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"ok":false}');return}
  scans++;const data=snapshot();data.address=url.searchParams.get('address');res.writeHead(200,{'Content-Type':'application/x-ndjson'});
  const write=(phase,report=data)=>{if(!res.destroyed&&!res.writableEnded)res.write(JSON.stringify({phase,report})+'\n')};
  data.cards.supply.fields.totalSupply=found(0);write('identity');
  market=()=>{data.cards.activity.fields.priceUsd=found(.25);write('activity')};
  finish=()=>{if(mode==='changed-block')data.block='0x124';if(mode!=='truncated')write('complete');if(!res.destroyed&&!res.writableEnded)res.end()};return;
 }
 const file=url.pathname.startsWith('/search/token/')?path.join(root,'search/index.html'):path.resolve(root,'.'+decodeURIComponent(url.pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'image/png');res.end(fs.readFileSync(file));
});
(async()=>{let browser;try{
 await new Promise(r=>server.listen(3165,'127.0.0.1',r));browser=await chromium.launch({headless:true,channel:'msedge'});
 for(const width of [1440,390])for(const variant of ['normal','changed-block','truncated']){
  mode=variant;const page=await browser.newPage({viewport:{width,height:844}});
  await page.route('https://www.geckoterminal.com/**',r=>r.fulfill({body:'Chart fixture'}));
  await page.goto('http://127.0.0.1:3165/search/token/ethereum/'+address,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#asset').textContent.includes('Streaming fixture'));
  assert.match(await page.locator('#detailState').innerText(),/in progress/);
  assert.equal(await page.locator('#cards > .card > .metric').count(),1,'valid zero remains visible before deep completion');
  const supply=page.locator('#cards [data-card-id="supply"]');await supply.locator('.missingGroup').evaluate(e=>e.open=true);
  market();await page.waitForFunction(()=>document.querySelector('#detailState').dataset.phase==='activity');
  assert.ok(await supply.locator('.missingGroup').evaluate(e=>e.open),'user disclosure state survives a progress update');
  assert.equal(await page.locator('#cards > .card > .metric').count(),2);
  finish();await page.waitForFunction(()=>/Snapshot complete|Deep analysis unavailable/.test(document.querySelector('#detailState').textContent));
  if(variant==='normal')assert.match(await page.locator('#detailState').innerText(),/Snapshot complete/);
  else{assert.match(await page.locator('#detailState').innerText(),/Deep analysis unavailable/);assert.match(await page.locator('#asset').innerText(),/Streaming fixture/);assert.equal(await page.locator('#cards > .card > .metric').count(),2)}
  assert.equal(await page.locator('#cards .metric').count(),16,'unsupported Mechanics stays hidden while the other four cards retain every row');assert.match(await page.locator('#evidenceCount').innerText(),/Contract & Mechanics is hidden/);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.close();
 }
 for(const width of [1440,390]){
  mode='normal';const page=await browser.newPage({viewport:{width,height:844}});
  // Deliberately keep the old network stream alive after cancellation, so the
  // client must reject the late response rather than relying on TCP closure.
  await page.addInitScript(()=>{const original=fetch;window.fetch=(url,options)=>original(url,{...options,signal:undefined})});
  await page.route('https://www.geckoterminal.com/**',r=>r.fulfill({body:'Chart fixture'}));
  await page.goto('http://127.0.0.1:3165/search/token/ethereum/'+address,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#asset').textContent.includes('Streaming fixture'));
  const oldFinish=finish,next='0x'+'8'.repeat(40);
  await page.evaluate(next=>activateDetail(next,'ethereum'),next);
  await page.waitForFunction(next=>document.querySelector('#asset').textContent.includes(next),next);
  oldFinish();await page.waitForTimeout(100);
  assert.ok((await page.locator('#asset').innerText()).includes(next),'late old result must not replace the new token');
  finish();await page.waitForFunction(()=>document.querySelector('#detailState').textContent.includes('Snapshot complete'));
  assert.ok((await page.locator('#asset').innerText()).includes(next));await page.close();
 }
 assert.equal(scans,10);console.log('PASS: 8 desktop/mobile progressive scenarios (10 scans); early identity/market, valid zero, preserved disclosure, block change, truncation and late-response navigation safety; one scan per navigation.');
}finally{await browser?.close();server.closeAllConnections();server.close()}})().catch(e=>{console.error(e);process.exitCode=1});
