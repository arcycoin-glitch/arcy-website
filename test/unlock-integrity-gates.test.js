'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const crypto=require('node:crypto');
const worker=require('../lib/unlock-calendar');

function app(fetchImpl=async()=>{throw Error('No remote fixture')},environment={}){
 const root=path.join(__dirname,'..'),context=vm.createContext({
  process:{env:environment},Date,URL,URLSearchParams,AbortSignal,
  crypto:crypto.webcrypto,TextEncoder,atob,fetch:fetchImpl
 });
 const evidence=fs.readFileSync(path.join(root,'lib/unlock-evidence.js'),'utf8').replaceAll('export const','const');
 const api=fs.readFileSync(path.join(root,'api/unlocks.js'),'utf8')
  .replace(/^import .*unlock-evidence.*;\r?\n/m,'')
  .replace('export default async function handler','async function handler');
 vm.runInContext(evidence,context);vm.runInContext(api,context);
 return context;
}
const when=Date.parse('2026-10-15T10:00:00Z');
const event=(name,symbol,date,amount,verification='source-published')=>({
 name,symbol,date,amount,allocation:'Team',percent:'1.37%',value:'$1M',verification,
 sourceUrl:'https://api.coinbell.in/token-unlocks?sort=soonest&window=30',
 evidence:[{kind:'published-calendar'}],daysFromToday:0
});
function edition(rows,generatedAt='2026-10-15T08:30:00Z'){
 return {schemaVersion:1,success:true,live:true,events:rows,
  windows:{today:rows,next7:rows,days8to30:rows},generatedAt,
  refreshAt:new Date(Date.parse(generatedAt)+6*3600000).toISOString(),
  coverage:{sources:[{url:'https://api.coinbell.in/token-unlocks?sort=soonest',status:'available'}]},
  partial:false};
}
function html(date='16 Oct 2026'){
 return '<table><tr><td>1</td><td>Celestia TIA</td><td>'+date+'</td><td>10K TIA</td><td>$9K</td><td>0.02%</td><td>Ecosystem</td></tr></table>';
}
function response(){return {code:0,headers:{},setHeader(key,val){this.headers[key]=val;},status(code){this.code=code;return this;},json(value){this.body=value;return value}};}

test('ARB October 15 published Team row is quarantined across worker and Vercel; no invented replacement',()=>{
 const row=worker.parseRows('<table><tr><td>1</td><td>Arbitrum ARB</td><td>15 Oct 2026</td><td>92.65M ARB</td><td>$16M</td><td>1.37%</td><td>Team</td></tr></table>')[0];
 assert.equal(row.symbol,'ARB');
 assert.equal(worker.mergeEvents([row]).events.length,0);
 const context=app();
 const sanitized=context.safeCurrentEdition(edition([row,event('Celestia','TIA','2026-10-16','100K TIA')]),when);
 assert.equal(sanitized.events.length,1);
 assert.equal(sanitized.events[0].symbol,'TIA');
 assert.equal(sanitized.windows.today.length,0);
 assert.equal(sanitized.windows.next7.length,1);
 assert.equal(sanitized.partial,true);
 assert.equal(sanitized.coverage.quarantined[0].symbol,'ARB');
 assert.equal(sanitized.coverage.complete,false);
 assert.ok(sanitized.coverage.reviews.find(review=>review.projectId==='arbitrum'));
});
test('dispute filter is date/project scoped, not a permanent ARB ticker ban',()=>{
 const source=(name,date)=>'<table><tr><td>1</td><td>'+name+' ARB</td><td>'+date+'</td><td>1M ARB</td><td>$1M</td><td>1.00%</td><td>Team</td></tr></table>';
 const independent=worker.parseRows(source('Arbitrum','16 Oct 2026'))[0];
 const other=worker.parseRows(source('Other Protocol','15 Oct 2026'))[0];
 assert.equal(worker.mergeEvents([independent]).events.length,1);
 assert.equal(worker.mergeEvents([other]).events.length,1);
 const ctx=app(),checked=ctx.safeCurrentEdition(edition([independent,other]),when);
 assert.equal(checked.events.length,2);
 assert.equal(checked.coverage.quarantined.length,0);
});
test('Arbitrum date quarantine does not silently suppress project-confirmed evidence if independently reviewed',()=>{
 const ctx=app();
 const official=event('Arbitrum','ARB','2026-10-16','92.65M ARB','project-confirmed');
 const clean=ctx.safeCurrentEdition(edition([official]),when);
 assert.equal(clean.events.length,1);
 assert.equal(clean.events[0].verification,'project-confirmed');
 assert.equal(clean.coverage.quarantined.length,0);
});
test('6h publisher edition has 2h grace but is always discarded across UTC midnight',()=>{
 const f=app().freshEdition;
 assert.equal(f(edition([], '2026-10-15T03:00:00Z'),when),true);
 assert.equal(f(edition([], '2026-10-15T01:59:00Z'),when),false);
 assert.equal(f(edition([], '2026-10-14T23:50:00Z'),Date.parse('2026-10-15T00:05:00Z')),false);
 assert.equal(f(edition([], '2026-10-15T10:07:00Z'),when),false);
 assert.equal(f(edition([], '2026-10-15T09:30:00Z'),when),true);
});
test('UTC date windows always rebase from the current day, never trust yesterday worker windows',()=>{
 const ctx=app();
 const items=[event('Old','OLD','2026-10-14','1M OLD'),
  event('Today','DAY','2026-10-15','1M DAY'),
  event('Soon','SOON','2026-10-22','1M SOON'),
  event('Later','LATE','2026-11-14','1M LATE'),
  event('Too far','FAR','2026-11-15','1M FAR')];
 const a=ctx.safeCurrentEdition(edition(items),when);
 assert.equal(a.events.length,3);
 assert.deepEqual([a.windows.today.length,a.windows.next7.length,a.windows.days8to30.length],[1,1,1]);
 assert.deepEqual(Array.from(a.events,e=>e.daysFromToday),[0,7,30]);
 const next=ctx.safeCurrentEdition(edition(items),Date.parse('2026-10-16T00:01:00Z'));
 assert.deepEqual([next.windows.today.length,next.windows.next7.length,next.windows.days8to30.length],[0,1,1]);
 assert.ok(next.events.every(e=>e.date>='2026-10-16'));
});
test('valid fresh signed publication can be read; old signed data cannot override refreshed fallback',async()=>{
 const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
 const pub=publicKey.export({format:'pem',type:'spki'}),env={
  ARC_UNLOCK_PUBLISHED_URL:'https://publisher.test/',ARC_UNLOCK_PUBLIC_KEY:pub
 };
 let calls=[];
 const fetchImpl=async url=>{
  calls.push(String(url));
  if(String(url).includes('/unlocks/latest')){
   const signed=edition([event('Old','OLD','2026-10-14','1M OLD')],'2026-10-14T23:30:00Z');
   const payload=JSON.stringify(signed);
   return new Response(JSON.stringify({payload,signature:crypto.sign(null,Buffer.from(payload),privateKey).toString('base64')}),{status:200});
  }
  return new Response(html('16 Oct 2026'),{status:200});
 };
 const context=app(fetchImpl,env);
 // Inject fixed UTC now; the prior UTC-day signed edition must be rejected.
 const originalDate=context.Date;
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-15T10:00:00Z']));}static now(){return when;}}
 context.Date=FixedDate;
 const res=response();
 await context.handler({},res);
 context.Date=originalDate;
 assert.equal(res.code,200);
 assert.equal(res.body.live,true);
 assert.equal(res.body.windows.next7[0].symbol,'TIA');
 assert.ok(calls.some(x=>x.includes('/unlocks/latest')));
 assert.ok(calls.some(x=>x.includes('coinbell.in')));
 assert.ok(res.body.events.every(x=>x.date>='2026-10-15'));
});
test('offline sources and stale signed edition fail closed rather than presenting past dates as live',async()=>{
 const context=app(async url=>{
  if(String(url).includes('/unlocks/latest'))return new Response(JSON.stringify({payload:JSON.stringify(edition([],'2026-10-13T00:00:00Z'))}),{status:200});
  throw Error('upstream unavailable');
 },{ARC_UNLOCK_PUBLISHED_URL:'https://publisher.test/',ARC_UNLOCK_PUBLIC_KEY:'bad-key'});
 const r=response();await context.handler({},r);
 assert.equal(r.code,503);
 assert.equal(r.body.live,false);
 assert.equal(r.headers['Cache-Control'],'no-store');
});
