'use strict';
// Explicit live acceptance; never runs in the ordinary fixture-only npm test.
// No credentials, queue calls, production writes, provider approval overrides,
// or mocked Search API responses. Chart frames are not part of data acceptance.
const {chromium}=require('C:/Users/cicek/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:3114';
const tokens=[
 ['arc','ARCY','0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'],
 ['arc','ARGUS','0xece5ca8bf9220718e5727754026757512212cb3c'],
 ['arc','LINK','0x76a443768a5e3b8d1aed0105fc250877841deb40'],
 ['ethereum','USDC','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
 ['ethereum','UNI','0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'],
 ['ethereum','USDT','0xdac17f958d2ee523a2206206994597c13d831ec7'],
 ['robinhood','AAPL','0xaf3d76f1834a1d425780943c99ea8a608f8a93f9'],
 ['robinhood','TSLA','0x322f0929c4625ed5bad873c95208d54e1c003b2d'],
 ['robinhood','LINK','0x492641f648a4986844848e0befe66d14817bce34'],
 ['ethereum','AAVE','0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'],
 ['ethereum','GRT','0xc944e90c64b2c07662a292be6244bdf05cda44a7']
];
async function main(){
 const output=process.argv[2];if(!output)throw Error('Explicit local output directory required');await fs.mkdir(output,{recursive:true});
 const env={...process.env,PORT:'3114',VERCEL:'1',VERCEL_ENV:'production'};
 // Test the conservative, unlicensed-provider-disabled policy, not a preview.
 delete env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED;delete env.GOPLUS_PUBLIC_DISPLAY_APPROVED;
 const server=spawn(process.execPath,['dev.cjs'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Preview startup timeout')),10000);server.stdout.once('data',()=>{clearTimeout(timer);resolve();});server.once('error',reject);});
  browser=await chromium.launch({headless:true,channel:'msedge'});const results=[];
  for(const [width,height,list]of [[1440,1000,tokens],[390,844,tokens.filter(x=>x[1]==='AAVE'||x[1]==='LINK')]]){
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
    const expected=require('../search/server/lib/search-logo').localLogo(network,address);
    if(expected){const img=page.locator('#asset img.token-title-logo');assert.equal(await img.getAttribute('src'),expected);await img.waitFor();assert.ok(await img.evaluate(el=>el.complete&&el.naturalWidth>0),'Exact-contract artwork loads');}
    await page.locator('#deepResearch').evaluate(el=>{el.open=true;});assert.match(await page.locator('#evidenceCount').innerText(),/20 checks/);
    const result={network,symbol,address,width,height,ms:Date.now()-started,sourceBacked:found,total:20,logo:expected||null,pass:true};results.push(result);console.log(JSON.stringify(result));
    if(symbol==='LINK'||symbol==='AAVE')await page.screenshot({path:path.join(output,network+'-'+symbol+'-'+width+'.png'),fullPage:true});
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({mode:'live public sources; production policy; local API and real browser',results},null,2));
  console.log('PASS: real Search browser/API/source flow, 5 cards / 20 metrics, exact logos, evidence and desktop/mobile. Not a production deployment.');
 }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
