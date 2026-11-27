#!/usr/bin/env node
'use strict';
// Paired, reproducible before/after for the homepage Token Unlocks pipeline (issue #83). ONE live fetch of the three CoinBell
// feeds is recorded; BEFORE (main checkout) and AFTER (this checkout) then process the IDENTICAL recorded responses, so any
// difference comes from the code, not from the publisher changing between runs. Read-only: three public GETs, no state written.
//   BEFORE_DIR=<main checkout> AFTER_DIR=<this checkout> node scripts/unlock-bench.cjs
const path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const BEFORE=path.resolve(process.env.BEFORE_DIR||'.'),AFTER=path.resolve(process.env.AFTER_DIR||'.');
const SORTS=['soonest','impact','value'],URL_OF=s=>`https://api.coinbell.in/token-unlocks?sort=${s}&window=30`;
const ms=t=>Date.now()-t;
async function record(){
 const out={};
 for(const sort of SORTS){
  const t=Date.now();
  try{
   const r=await fetch(URL_OF(sort),{headers:{accept:'text/html,application/xhtml+xml','user-agent':'ARCY-Unlocks/2.0 (+https://arcyusdc.xyz)'},signal:AbortSignal.timeout(20000)});
   out[sort]={status:r.status,ok:r.ok,retryAfter:r.headers.get('retry-after'),text:r.ok?await r.text():'',ms:ms(t),at:new Date().toISOString()};
   out[sort].bytes=out[sort].text.length;
  }catch(e){out[sort]={status:0,ok:false,text:'',ms:ms(t),error:e.name+':'+e.message,at:new Date().toISOString()};}
 }
 return out;
}
const replay=rec=>async url=>{const s=SORTS.find(x=>url.includes('sort='+x)),r=s&&rec[s];if(!r)throw new Error('NO_RECORDING');
 if(r.status===0)throw new Error(r.error||'network');return {ok:r.ok,status:r.status,headers:{get:h=>h==='retry-after'?r.retryAfter:null},text:async()=>r.text,json:async()=>({})};};
function windows(events){const w={today:0,next7:0,days8to30:0};for(const e of events){const d=e.daysFromToday;if(d===0)w.today++;else if(d>=1&&d<=7)w.next7++;else if(d>=8&&d<=30)w.days8to30++;}return w;}
function summarise(ed){
 const ev=ed.events||[],ident=new Set(ev.map(e=>(e.name||'').toLowerCase()+'|'+e.symbol)),cov=ed.coverage||{};
 const count=(f)=>ev.filter(f).length;
 return {events:ev.length,uniqueTokenIdentities:ident.size,windows:windows(ev),projectConfirmed:count(e=>e.verification==='project-confirmed'),thirdPartyCalendar:count(e=>e.verification==='source-published'),
  conflicts:(cov.conflicts||[]).length,quarantined:(cov.quarantined||[]).length,rejectedSupplements:(cov.rejectedSupplements||[]).length,partial:!!ed.partial,
  sources:(cov.sources||[]).map(s=>({status:s.status,rows:s.rowCount,reason:s.reason||null,retryAfterSeconds:s.retryAfterSeconds??null,parse:s.parse||null})),
  blockedLinks:count(e=>e.sourceLinkStatus==='BLOCKED_OR_ABSENT'),withSourceLink:count(e=>!!e.sourceUrl),
  scheduleBasis:ev.reduce((m,e)=>{const k=e.scheduleBasis||'(field absent)';m[k]=(m[k]||0)+1;return m;},{}),
  ambiguousAmounts:count(e=>e.amountFormat==='AMBIGUOUS_SEPARATORS'),withLogo:count(e=>!!e.logo),
  executionVerification:ev.reduce((m,e)=>{const k=e.executionVerification||'(field absent)';m[k]=(m[k]||0)+1;return m;},{})};
}
async function run(dir,rec,now){
 const lib=require(path.join(dir,'lib/unlock-calendar.js'));const t=Date.now();
 try{const ed=await lib.generate({now,fetcher:replay(rec)});return {ok:true,ms:ms(t),summary:summarise(ed),ids:(ed.events||[]).map(e=>[e.name,e.symbol,e.date,e.amount,e.allocation].join('|'))};}
 catch(e){return {ok:false,error:e.code||e.message,ms:ms(t)};}
}
async function apiRun(dir,rec){
 const evidence=fs.readFileSync(path.join(dir,'lib/unlock-evidence.js'),'utf8').replaceAll('export const','const');
 const src=fs.readFileSync(path.join(dir,'api/unlocks.js'),'utf8').replace(/^import .*(?:unlock-evidence|unlock-core).*;\r?\n/gm,'').replace('export default async function handler','async function handler');
 const core=fs.existsSync(path.join(dir,'lib/unlock-core.cjs'))?require(path.join(dir,'lib/unlock-core.cjs')):undefined;
 const ctx=vm.createContext({process:{env:{}},Date,URL,URLSearchParams,AbortSignal,TextEncoder,atob,fetch:replay(rec),core});
 vm.runInContext(evidence,ctx);vm.runInContext(src,ctx);
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
 const t=Date.now();await ctx.handler({query:{}},res);
 return {code:res.code,ms:ms(t),summary:res.body?.ok?summarise(res.body):null,ids:(res.body?.events||[]).map(e=>[e.name,e.symbol,e.date,e.amount,e.allocation].join('|'))};
}
(async()=>{
 const now=Date.now(),rec=await record();
 const recorded=Object.fromEntries(SORTS.map(s=>[s,{status:rec[s].status,ms:rec[s].ms,bytes:rec[s].bytes??0,retryAfter:rec[s].retryAfter??null,at:rec[s].at,error:rec[s].error||null}]));
 const before=await run(BEFORE,rec,now),after=await run(AFTER,rec,now),apiAfter=await apiRun(AFTER,rec),apiBefore=await apiRun(BEFORE,rec);
 const parity=after.ok&&apiAfter.summary?{sameEventSet:JSON.stringify([...after.ids].sort())===JSON.stringify([...apiAfter.ids].sort()),worker:after.ids.length,api:apiAfter.ids.length}:null;
 const result={measuredAt:new Date(now).toISOString(),recorded,before:{worker:{ok:before.ok,error:before.error,ms:before.ms,...before.summary},api:{code:apiBefore.code,ms:apiBefore.ms,...apiBefore.summary}},
  after:{worker:{ok:after.ok,error:after.error,ms:after.ms,...after.summary},api:{code:apiAfter.code,ms:apiAfter.ms,...apiAfter.summary}},parity,
  requestCost:{liveRequests:3,provider:'api.coinbell.in',note:'before and after replay the same recorded responses; no extra provider calls'}};
 console.log(JSON.stringify(result,null,2));
 const e=s=>s.replace(/%/g,'%25').replace(/\r?\n/g,'%0A');
 if(process.env.GITHUB_ACTIONS){
  console.log('::notice title=unlock-bench-summary::'+e(JSON.stringify({measuredAt:result.measuredAt,recorded,parity,requestCost:result.requestCost})));
  console.log('::notice title=unlock-bench-before::'+e(JSON.stringify(result.before)).slice(0,3800));
  console.log('::notice title=unlock-bench-after::'+e(JSON.stringify(result.after)).slice(0,3800));
 }
 if(!after.ok&&recorded.soonest.status===200)process.exitCode=1;
 if(parity&&!parity.sameEventSet)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
