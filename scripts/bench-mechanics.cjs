'use strict';
// Read-only Contract & Mechanics benchmark (CI / operator tool). Runs the repository's own Mechanics pipeline in-process.
// GoPlus stays disabled exactly like Production (VERCEL=1 without GOPLUS_PUBLIC_DISPLAY_APPROVED). No writes, no log scans.
// usage: node scripts/bench-mechanics.cjs <label> [samples.json]   -> writes mechanics-bench-<label>.json, prints annotations.
process.env.VERCEL='1';delete process.env.GOPLUS_PUBLIC_DISPLAY_APPROVED;
const fs=require('node:fs'),path=require('node:path');
const label=process.argv[2]||'run',samplesFile=process.argv[3]||'';
const root=process.env.BENCH_ROOT||process.cwd();
const req=p=>require(path.join(root,p));
const FIELDS=['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture'];
const REGRESSION=[['arc','0x73e5F588d27d6B5EC89C89c82692D1E7fECBd38b'],['arc','0xf76b1d00bd3d63a37246b5f512074e864010e33d'],['robinhood','0x39dbed3a2bd333467115de45665cc57f813c4571']];
const ETH_KNOWN=['0xdAC17F958D2ee523a2206206994597C13D831ec7','0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48','0x6B175474E89094C44Da98b954EedeAC495271d0F','0x514910771AF9Ca656af840dff83E8264EcF986CA','0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984','0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2','0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE','0x6982508145454Ce325dDbE47a25d4ec3d2311933','0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9','0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2','0xB8c77482e45F1F44dE1745F52C74426C631bDD52','0x4Fabb145d64652a948d72533023f6E7A623C7C53'];
// Outbound request accounting (host-level), no payloads recorded. BENCH_REPLAY=record|replay lets two code versions see IDENTICAL provider
// evidence (same pinned block, same RPC/Sourcify answers, same failures); replay misses return a controlled error, NEVER a live request; the paired quality gate reports misses explicitly.
const net={rpc:0,sourcify:0,goplus:0,explorer:0,other:0,failed:0,replayHit:0,replayMiss:0};
const MODE=process.env.BENCH_REPLAY||'off',RFILE=process.env.BENCH_REPLAY_FILE||'mechanics-replay.json';
const store=MODE==='replay'&&fs.existsSync(RFILE)?JSON.parse(fs.readFileSync(RFILE,'utf8')):{};
const cursor={};
const stripId=o=>{const c={...o};delete c.id;return c;};
function canon(url,opts){let b=opts?.body;if(typeof b==='string'){try{const j=JSON.parse(b);b=JSON.stringify(Array.isArray(j)?j.map(stripId):stripId(j));}catch{}}return (opts?.method||'GET')+' '+String(url?.url||url)+' '+(b||'');}
function reid(text,opts){try{const rq=JSON.parse(opts?.body),rs=JSON.parse(text);if(Array.isArray(rq)&&Array.isArray(rs))rs.forEach((x,i)=>{if(x&&rq[i])x.id=rq[i].id;});else if(rq&&rs&&!Array.isArray(rs))rs.id=rq.id;return JSON.stringify(rs);}catch{return text;}}
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,opts)=>{const u=String(url?.url||url);let k='other';
 if(/sourcify/.test(u))k='sourcify';else if(/gopluslabs/.test(u))k='goplus';else if(/blockscout|explorer/.test(u))k='explorer';else if(opts?.method==='POST'&&/rpc|publicnode|chain\.robinhood|arc\./.test(u))k='rpc';
 net[k]++;const key=canon(url,opts);
 if(MODE==='replay'&&store[key]?.length){net.replayHit++;const q=store[key];const e=q[Math.min(cursor[key]=(cursor[key]??-1)+1,q.length-1)];if(e.status>=400)net.failed++;return new Response(e.status===204?null:reid(e.text,opts),{status:e.status,headers:{'content-type':e.type||'application/json'}});}
 // A replay must never silently fetch a new live response: it would make the paired comparison non-deterministic.
 if(MODE==='replay'){net.replayMiss++;net.failed++;return new Response(JSON.stringify({error:'BENCH_REPLAY_UNRECORDED'}),{status:503,headers:{'content-type':'application/json'}});}
 try{const r=await realFetch(url,opts);if(!r.ok)net.failed++;
  if(MODE==='record'||MODE==='replay'){const text=await r.text();(store[key]||=[]).push({status:r.status,type:r.headers.get('content-type'),text});return new Response(r.status===204?null:text,{status:r.status,headers:{'content-type':r.headers.get('content-type')||'application/json'}});}
  return r;}catch(e){net.failed++;throw e;}};
async function get(p){const base=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';const r=await realFetch(base+p,{headers:{accept:'application/json',referer:base+'/','sec-fetch-site':'same-origin'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json();}
async function buildSamples(){
 const out=[],seen=new Set();const add=(chain,address,group)=>{const k=chain+address.toLowerCase();if(!seen.has(k)&&/^0x[0-9a-f]{40}$/i.test(address)){seen.add(k);out.push({chain,address,group});}};
 for(const [c,a] of REGRESSION)add(c,a,'regression');
 for(const a of ETH_KNOWN)add('ethereum',a,'known');
 for(const section of ['arc','ethereum','robinhood','pons']){try{const d=await get('/api/search?action=radar&chain='+section);for(const t of (d.tokens||[]).slice(0,10))add(section==='pons'?'robinhood':section,t.address||t.token||'',section==='pons'?'pons':'radar');}catch(e){console.error('radar',section,e.message);}}
 return out;
}
async function mechanics(chain,address){
 if(chain==='ethereum'){
  const evidence=req('search/server/lib/evidence'),report=req('search/server/lib/report'),control=req('search/server/lib/control'),security=req('search/server/lib/security');
  const eth=req('search/server/lib/eth'),t=await eth.inspect(address);
  const [c,sec]=await Promise.all([control.inspect(t.address,t.block).catch(control.failure),security.inspect('ethereum',t.address).catch(()=>({}))]);let extra={};
  if(c.fields?.owner?.dataState!=='DATA_FOUND'||c.fields?.proxyImplementation?.dataState!=='DATA_FOUND'){try{extra=await req('search/server/lib/admin-getters').inspect({network:'ethereum',address:t.address,block:t.block,rpc:eth.rpc,needAdmin:c.fields?.owner?.dataState!=='DATA_FOUND',needImplementation:c.fields?.proxyImplementation?.dataState!=='DATA_FOUND'});}catch{}}
  return {block:t.block,card:await req('search/server/lib/mechanics-deep').enrich({network:'ethereum',address:t.address,block:t.block,rpc:eth.rpc,card:report.mechanicsCard(c,sec,extra)})};
 }
 const adapter=req('search/server/lib/'+(chain==='arc'?'arc':'robinhood')+'-adapter');
 const base=await adapter.inspectToken({address});
 return {block:base.block,card:await adapter.inspectCard({base,cardId:'mechanics',address})};
}
const short=v=>String(v??'').replace(/\s+/g,' ').slice(0,70);
(async()=>{
 const {classify}=req('search/server/lib/evidence-class');
 const samples=samplesFile&&fs.existsSync(samplesFile)?JSON.parse(fs.readFileSync(samplesFile,'utf8')):await buildSamples();
 if(process.env.BENCH_SAMPLES_ONLY==='1'){fs.writeFileSync('mechanics-samples.json',JSON.stringify(samples));console.log('samples',samples.length);return;}
 const rows=[];
 for(const s of samples){
  const before={...net},t0=Date.now();let res=null,err=null;
  try{res=await Promise.race([mechanics(s.chain,s.address),new Promise((_,r)=>setTimeout(()=>r(Error('BENCH_TIMEOUT_60S')),60000))]);}catch(e){err=String(e.message||e).slice(0,80);}
  const ms=Date.now()-t0,d=Object.fromEntries(Object.keys(net).map(k=>[k,net[k]-before[k]]));
  const f={},fails=new Set();for(const k of FIELDS){const x=res?.card?.fields?.[k];for(const q of (x?.analysisDiagnostics?.failures||[]))if(q?.reason)fails.add(q.reason);const c=classify(x||null,{card:'mechanics'});f[k]={ok:x?.dataState==='DATA_FOUND',cls:c.evidenceClass,status:x?.status||null,reason:x?.reasonCode||null,value:short(x?.value),scope:short(x?.scope)};}
  rows.push({...s,block:res?.block||null,err,ms,net:d,f,fails:[...fails].sort()});
  await new Promise(r=>setTimeout(r,600));
 }
 const cov={};for(const r of rows){const c=cov[r.chain+(r.group==='pons'?'/pons':'')]||={n:0,err:0,ms:0,rpc:0,src:0,f:Object.fromEntries(FIELDS.map(k=>[k,0]))};c.n++;if(r.err)c.err++;c.ms+=r.ms;c.rpc+=r.net.rpc;c.src+=r.net.sourcify;for(const k of FIELDS)if(r.f[k].ok)c.f[k]++;}
 const reasons={};for(const r of rows)for(const k of FIELDS)if(!r.f[k].ok){const key=k+':'+(r.f[k].reason||r.err||'none');reasons[key]=(reasons[key]||0)+1;}
 if(MODE==='record')fs.writeFileSync(RFILE,JSON.stringify(store));
 const out={label,mode:MODE,at:new Date().toISOString(),commit:process.env.GITHUB_SHA||null,net,cov,reasons,rows};
 fs.writeFileSync('mechanics-bench-'+label+'.json',JSON.stringify(out,null,1));
 fs.writeFileSync('mechanics-samples.json',JSON.stringify(samples));
 const esc=x=>x.replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,'%0A');
 console.log('::notice title=mech-'+label+'-cov::'+esc(JSON.stringify({cov,net,reasons})));
 let cur=[],i=0;const flush=()=>{if(cur.length)console.log('::notice title=mech-'+label+'-rows-'+(i++)+'::'+esc(JSON.stringify(cur)));cur=[];};
 for(const r of rows){const row=[r.chain[0]+(r.group==='pons'?'p':''),r.address.slice(2,8),r.ms,r.net.rpc,r.net.sourcify,r.net.replayMiss,...FIELDS.map(k=>r.f[k].ok?1:0),FIELDS.map(k=>r.f[k].ok?r.f[k].status:(r.f[k].reason||r.err||'-')).join('|'),r.fails.join(',')];if(JSON.stringify([...cur,row]).length>3300)flush();cur.push(row);}
 flush();
})().catch(e=>{console.error(e);process.exitCode=1;});
