'use strict';
// Explicit live acceptance; never runs in the ordinary fixture-only npm test.
// No credentials, queue calls, production writes, provider approval overrides,
// or mocked Search API responses. Chart frames are not part of data acceptance.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:3117';
const tokens=[["arc","ARCY","0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b"],["arc","ARGUS","0xece5ca8bf9220718e5727754026757512212cb3c"],["arc","USDT-Arc","0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a"],["arc","UBI","0x547dd73ce97c886f51e2d530e9b9ed2fd5844b56"],["ethereum","USDT","0xdac17f958d2ee523a2206206994597c13d831ec7"],["ethereum","UNI","0x1f9840a85d5af5bf1d1762f925bdaddc4201f984"],["ethereum","DAI","0x6b175474e89094c44da98b954eedeac495271d0f"],["ethereum","USDC","0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],["robinhood","AAPL","0xaf3d76f1834a1d425780943c99ea8a608f8a93f9"],["robinhood","TSLA","0x322f0929c4625ed5bad873c95208d54e1c003b2d"],["robinhood","LINK","0x492641f648a4986844848e0befe66d14817bce34"],["arc","TOLLY","0xbc43ce8dec648ea298c4275559b81d6261c90b67"],["arc","cirBTC","0x171a4217b86a807a64eb94757db6849fb4bdbaa0"]];
async function main(){
 const output=process.argv[2];if(!output)throw Error('Explicit local output directory required');await fs.mkdir(output,{recursive:true});
 const env={...process.env,PORT:'3117',VERCEL:'1',VERCEL_ENV:'production'};
 // Test the conservative, unlicensed-provider-disabled policy, not a preview.
 delete env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED;delete env.GOPLUS_PUBLIC_DISPLAY_APPROVED;
 const server=spawn(process.execPath,['dev.cjs'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Preview startup timeout')),10000);server.stdout.once('data',()=>{clearTimeout(timer);resolve();});server.once('error',reject);});
  browser=await chromium.launch({headless:true,channel:'msedge'});const results=[];
  for(const [width,height,list]of [[1440,1000,tokens],[390,844,tokens.filter(x=>x[1]==='TOLLY'||x[1]==='USDC'||x[1]==='AAPL')]]){
   const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   for(const [network,symbol,address]of list){
    const started=Date.now(),response=page.waitForResponse(r=>r.url().includes('/api/search?')&&r.url().includes('action=report')&&r.url().includes(address),{timeout:90000});
    await page.goto(origin+'/search/token/'+network+'/'+address,{waitUntil:'domcontentloaded'});
    const r=await response,data=await r.json();assert.equal(r.status(),200);assert.equal(data.address,address);assert.equal(data.network,network);
    await page.waitForFunction(()=>document.querySelector('#detailState').textContent.includes('Snapshot complete'),{timeout:90000});
    // Approved design nests wholly unavailable cards in its existing reasons group.
    assert.equal(await page.locator('#cards .card').count(),5);
    const fields=Object.values(data.cards).flatMap(x=>Object.values(x.fields)),found=fields.filter(x=>x.dataState==='DATA_FOUND').length;assert.equal(fields.length,20);
    assert.equal(await page.locator('#cards .metric').count(),20);assert.match(await page.locator('#evidenceCount').innerText(),new RegExp(found+' source-backed'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No document overflow');
    await page.locator('#deepResearch').evaluate(el=>{el.open=true;});assert.match(await page.locator('#evidenceCount').innerText(),/20 checks/);
    const result={network,symbol,address,width,height,ms:Date.now()-started,sourceBacked:found,total:20,mechanics:Object.fromEntries(Object.entries(data.cards.mechanics.fields).map(([k,f])=>[k,{value:f.value,status:f.status,source:f.source}])),pass:true};results.push(result);console.log(JSON.stringify(result));
    if(symbol==='TOLLY'||symbol==='AAPL')await page.screenshot({path:path.join(output,network+'-'+symbol+'-'+width+'.png'),fullPage:true});
    await page.locator('#cards details').evaluateAll(items=>items.forEach(el=>{el.open=true;}));
    assert.equal(await page.locator('#cards .proof-panel').count(),5);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Evidence JSON must not overflow document');
    assert.ok((await page.locator('#cards .advanced-proof pre').allTextContents()).some(s=>s.includes('runtimeCodeHash')),'Mechanics technical runtime evidence is accessible');
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({mode:'live public sources; production policy; local API and real browser',results},null,2));
  console.log('PASS: real Search browser/API/source flow, 5 cards / 20 metrics, Mechanics evidence and desktop/mobile. Not a production deployment.');
 }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
