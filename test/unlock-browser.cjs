'use strict';
// Browser check for the homepage Token Unlocks calendar at 320 / 390 / 1440 px. The page is served by dev.cjs; /api/unlocks is
// fulfilled with the REAL api/unlocks.js handler output computed from fixed publisher HTML (no live dependency), including a
// conflicting-amount pair, namesake tickers and a hostile link in a tampered edition. Frontend files are not modified.
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const root=path.join(__dirname,'..'),origin='http://127.0.0.1:3111';
const day=n=>new Date(Date.now()+n*86400000);
const fmt=d=>d.getUTCDate()+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]+' '+d.getUTCFullYear();
const row=(n,d,name,sym,amt,alloc='Team')=>`<tr><td>${n}</td><td>${name} ${sym}</td><td>${fmt(d)}</td><td>${amt}</td><td>$10M</td><td>1.2%</td><td>${alloc}</td></tr>`;
async function body(){
 const core=require('../lib/unlock-core.cjs');
 const rows=[row(1,day(0),'Today Coin','TDY','1M TDY'),row(2,day(3),'Celestia','TIA','10M TIA','Cliff'),row(3,day(4),'Alpha','ALP','10M ALP'),row(4,day(4),'Alpha','ALP','12M ALP'),
  row(5,day(5),'Beta Chain','BET','5M BET'),row(6,day(5),'Beta Finance','BET','9M BET'),...Array.from({length:14},(_,i)=>row(7+i,day(9+i),'Long Name Token '+i,'LNG'+i,(i+1)+'M LNG'+i,'Investors linear'))];
 const html='<table>'+rows.join('')+'</table>';
 const evidence=fs.readFileSync(path.join(root,'lib/unlock-evidence.js'),'utf8').replaceAll('export const','const');
 const src=fs.readFileSync(path.join(root,'api/unlocks.js'),'utf8').replace(/^import .*(?:unlock-evidence|unlock-core).*;\r?\n/gm,'').replace('export default async function handler','async function handler');
 const ctx=vm.createContext({process:{env:{}},Date,URL,URLSearchParams,AbortSignal,TextEncoder,atob,core,fetch:async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>html})});
 vm.runInContext(evidence,ctx);vm.runInContext(src,ctx);
 const res={headers:{},setHeader(){},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};await ctx.handler({query:{}},res);
 assert.equal(res.code,200);assert.ok(res.body.windows.today.length>=1);return JSON.parse(JSON.stringify(res.body));
}
(async()=>{
 const payload=await body();
 assert.ok(!JSON.stringify(payload.events).includes('"ALP"'),'conflicting amounts withheld before reaching the browser');
 assert.equal(payload.events.filter(e=>e.symbol==='BET').length,2);
 const server=spawn(process.execPath,['dev.cjs'],{cwd:root,env:{...process.env,PORT:'3111'},stdio:['ignore','pipe','pipe']});
 let browser;const results=[];
 try{
  await new Promise((ok,bad)=>{const t=setTimeout(()=>bad(Error('dev server timeout')),10000);server.stdout.once('data',()=>{clearTimeout(t);ok();});server.once('error',bad);});
  browser=await chromium.launch({headless:true});
  for(const [width,height] of [[320,700],[390,844],[1440,900]]){
   const page=await browser.newPage({viewport:{width,height}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/unlocks',r=>r.fulfill({status:200,contentType:'application/json',headers:{'cache-control':'no-store'},body:JSON.stringify(payload)}));
   await page.route('**/api/search**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":false}'}));
   await page.goto(origin+'/#unlocks',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('#unlockRows tr td.rank',{timeout:15000});
   const todayRows=await page.locator('#unlockRows tr').count();
   await page.click('.tab[data-days="7"]');await page.waitForTimeout(200);
   const next7=(await page.locator('#unlockRows tr td.rank').count());
   await page.click('.tab[data-days="30"]');await page.waitForTimeout(200);
   const later=(await page.locator('#unlockRows tr td.rank').count());
   const pager=await page.locator('#unlockPage').innerText();
   const hosts=await page.$$eval('#unlocks a[href]',a=>[...new Set(a.map(x=>{try{return new URL(x.href).hostname}catch{return'invalid'}}))]);
   const overflow=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:window.innerWidth}));
   const section=await page.locator('#unlocks').boundingBox();
   await page.locator('#unlocks').screenshot({path:path.join(require('node:os').tmpdir(),`unlock-${width}.png`)}).catch(()=>{});
   results.push({width,todayRows,next7,later,pager,hosts,overflow,sectionWidth:section&&Math.round(section.width),errors});
   assert.ok(todayRows>=1,'today rows render at '+width);assert.ok(next7>=1&&later>=1,'tabs render at '+width);
   assert.ok(overflow.sw<=overflow.iw+1,`no horizontal overflow at ${width}: ${JSON.stringify(overflow)}`);
   assert.deepEqual(errors,[],'no page errors at '+width);
   assert.ok(hosts.every(h=>/(^|\.)(coinbell\.in|defillama\.com|arcyusdc\.xyz|x\.com|twitter\.com|t\.me|github\.com)$/.test(h)||h==='127.0.0.1'),'only allowlisted hosts linked: '+hosts.join());
   await page.close();
  }
  console.log(JSON.stringify({ok:true,results},null,1));
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
