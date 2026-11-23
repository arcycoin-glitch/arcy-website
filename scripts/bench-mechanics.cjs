'use strict';
// Read-only Contract & Mechanics benchmark (CI / operator tool). Runs the repository's own Mechanics pipeline in-process.
// GoPlus stays disabled exactly like Production (VERCEL=1 without GOPLUS_PUBLIC_DISPLAY_APPROVED). No writes, no log scans.
// usage: node scripts/bench-mechanics.cjs <label> [samples.json]   -> writes mechanics-bench-<label>.json, prints annotations.
process.env.VERCEL='1';delete process.env.GOPLUS_PUBLIC_DISPLAY_APPROVED;
const fs=require('node:fs'),path=require('node:path');
const label=process.argv[2]||'run',samplesFile=process.argv[3]||'';
const root=process.env.BENCH_ROOT||process.cwd();
const req=p=>require(path.join(root,p));
const runMechanics=require('./mechanics-bench-run.cjs').mechanics;
const {proofs}=require('./mechanics-bench-proof.cjs');
const {isPinnedBlockTag,customRoleEvidence}=require('./mechanics-bench-budget.cjs');
const FIELDS=['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture','transferRestrictions'];
// Mechanics V5: transferRestrictions is supplementary (card.supplementary), never one of the four visible card fields.
const fieldOf=(card,k)=>k==='transferRestrictions'?card?.supplementary?.transferRestrictions:card?.fields?.[k];
// Real data-state classification (V5 brief): DATA_FOUND | PARTIAL_EVIDENCE | NOT_VERIFIED | RPC_ERROR | SOURCE_UNAVAILABLE | UNSUPPORTED_CONTRACT | STALE.
function dataClass(x,k){
 if(!x)return 'NOT_VERIFIED';
 if(x.dataState==='DATA_FOUND'){
  if(x.freshness?.state==='LAST_VERIFIED'||x.status==='HISTORICAL_ONCHAIN_VERIFIED')return 'STALE';
  // A token-transfer-only tax row is not a complete Buy/Sell/Transfer answer.
  if(k==='tradingTaxes'&&/NOT VERIFIED/.test(String(x.value)))return 'PARTIAL_EVIDENCE';
  return 'DATA_FOUND';
 }
 const rc=x.reasonCode||'',fails=(x.analysisDiagnostics?.failures||[]).map(f=>String(f?.reason||''));
 if(rc==='MECHANICS_EXECUTION_PATH_UNREVIEWED')return 'PARTIAL_EVIDENCE';
 if(fails.some(r=>/^RPC_/.test(r)))return 'RPC_ERROR';
 if(rc==='MECHANICS_SOURCE_READ_UNAVAILABLE'||fails.some(r=>/^SOURCE_(RATE_LIMIT|TIMEOUT|API_FAILED)$/.test(r))||rc==='MECHANICS_VERIFIED_SOURCE_UNAVAILABLE'||fails.includes('SOURCE_CODE_UNAVAILABLE'))return 'SOURCE_UNAVAILABLE';
 if(/^(MECHANICS_SOURCE_IDENTITY_UNVERIFIED|MECHANICS_IMPLEMENTATION_UNRESOLVED|ARCHITECTURE_TARGET_UNRESOLVED)$/.test(rc)||fails.some(r=>/RUNTIME_UNSUPPORTED|SOURCE_SCHEMA_INVALID|SOURCE_BYTECODE_MISMATCH|SOURCE_IDENTITY_MISMATCH|IMPLEMENTATION_EXECUTION_UNRESOLVED/.test(r)))return 'UNSUPPORTED_CONTRACT';
 return 'NOT_VERIFIED';
}
const REGRESSION=[['arc','0x73e5F588d27d6B5EC89C89c82692D1E7fECBd38b'],['arc','0xf76b1d00bd3d63a37246b5f512074e864010e33d'],['robinhood','0x39dbed3a2bd333467115de45665cc57f813c4571']];
const ETH_KNOWN=['0xdAC17F958D2ee523a2206206994597C13D831ec7','0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48','0x6B175474E89094C44Da98b954EedeAC495271d0F','0x514910771AF9Ca656af840dff83E8264EcF986CA','0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984','0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2','0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE','0x6982508145454Ce325dDbE47a25d4ec3d2311933','0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9','0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2','0xB8c77482e45F1F44dE1745F52C74426C631bDD52','0x4Fabb145d64652a948d72533023f6E7A623C7C53'];
// Outbound request accounting (host-level), no payloads recorded. BENCH_REPLAY=record|replay lets two code versions see IDENTICAL provider
// evidence (same pinned block, same RPC/Sourcify answers, same failures); replay misses return a controlled error, NEVER a live request; the paired quality gate reports misses explicitly.
const net={rpc:0,sourcify:0,goplus:0,explorer:0,other:0,failed:0,replayHit:0,replayMiss:0,augProbe:0,augSibling:0,augReference:0,augReviewed:0,augCustomRole:0,augRestriction:0,augBinding:0,augBindingSource:0,augAuthority:0,augAuthoritySource:0};
const MODE=process.env.BENCH_REPLAY||'off',RFILE=process.env.BENCH_REPLAY_FILE||'mechanics-replay.json';
const REPLAYING=MODE==='replay'||MODE==='augment';
const store=REPLAYING&&fs.existsSync(RFILE)?JSON.parse(fs.readFileSync(RFILE,'utf8')):{};
// BENCH_REPLAY=augment (AFTER step only): identical to replay, except that a replay MISS of an explicitly budgeted,
// read-only request kind introduced by the code under test is answered live (still pinned to the replayed block, because
// the block comes from the recorded eth_blockNumber/context answers). Every such request is counted per kind so the paired
// gate (assert-mechanics-bench.cjs) can enforce the per-contract budget and eligibility. Any other miss stays fail-closed.
//  augProbe     eth_call with the proxy-delegation probe selector (search/server/lib/mechanics-proxy-probe.js)
//  augSibling   eth_call of a sibling family's token getter (search/server/lib/mechanics-sibling-runtime.js)
//  augReference GET of a pinned sibling family's Sourcify reference record
//  augReviewed  eth_call / eth_getStorageAt issued only by a reviewed token-source profile (search/server/lib/mechanics-reviewed-tokens.js)
//  augCustomRole a bounded ABI-declared AccessControl role read (up to four known role getters per contract)
const optional=p=>{try{return req(p);}catch{return null;}};
const probeModule=optional('search/server/lib/mechanics-proxy-probe'),siblingModule=optional('search/server/lib/mechanics-sibling-runtime');
const keccakSel=s=>req('lib/keccak')(Buffer.from(s)).slice(0,10);
const siblingSelectors=new Set((siblingModule?.FAMILIES||[]).flatMap(f=>Object.keys(f.getters||{}).map(n=>keccakSel(n+'()'))));
const reviewedModule=optional('search/server/lib/mechanics-reviewed-tokens');
const reviewedSelectors=new Set((reviewedModule?.REVIEWED_GETTERS||reviewedModule?.TORCH_GETTERS||[]).map(keccakSel)),reviewedSlots=new Set(Object.values(reviewedModule?.SPX_SLOTS||{}).map(i=>reviewedModule.slotKey(i)));
//  augRestriction a bounded Transfer Restrictions state read issued only by a reviewed profile (search/server/lib/mechanics-restrictions.js)
const restrictionModule=optional('search/server/lib/mechanics-restrictions');
const restrictionSelectors=new Set((restrictionModule?.RESTRICTION_GETTERS||[]).map(keccakSel));
const customRoleSelectors=new Set(['PAUSER_ROLE()','BLACKLISTER_ROLE()','UPGRADER_ROLE()','BURNER_ROLE()'].map(keccakSel));
const accessRoleSelectors=new Set(['getRoleAdmin(bytes32)','getRoleMemberCount(bytes32)','getRoleMember(bytes32,uint256)','hasRole(bytes32,address)'].map(keccakSel));
const authority=optional('search/server/lib/mechanics-v8-authority');
const authoritySelectors=new Set((authority?.GETTERS||[]).map(keccakSel));
const referenceUrls=new Set((siblingModule?.FAMILIES||[]).map(f=>'https://sourcify.dev/server/v2/contract/'+f.chainId+'/'+f.reference+'?fields=abi,sources,compilation,runtimeBytecode'));
//  augBinding    reads made only once a legacy/EIP-1967 proxy outer source is newly reviewed-bound (mechanics-deep
//                publishProxy + authority pass): admin-slot read, proxiableUUID, getCode/owner() of a non-sample address,
//                and (augBindingSource) the Sourcify record of a non-sample authority address.
let CURRENT=null;
const LEGACY_ADMIN_SLOT='0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b',PROXIABLE='0x52d1902d',OWNER_SEL='0x8da5cb5b';
function budgetedKind(url,opts){
 if(MODE!=='augment')return null;
 const u=String(url?.url||url);
 const authScope=authority?.inScope()&&CURRENT;
 if(authScope&&(!opts?.method||opts.method==='GET')&&/^https:\/\/sourcify\.dev\/server\/v2\/contract\/\d+\/0x[0-9a-f]{40}\?/i.test(u)&&!u.toLowerCase().includes(CURRENT))return 'augAuthoritySource';
 if((!opts?.method||opts.method==='GET')&&referenceUrls.has(u))return 'augReference';
 if((!opts?.method||opts.method==='GET')&&CURRENT&&/^https:\/\/sourcify\.dev\/server\/v2\/contract\/\d+\/0x[0-9a-f]{40}\?/i.test(u)&&!u.toLowerCase().includes(CURRENT))return 'augBindingSource';
 if(opts?.method!=='POST'||typeof opts.body!=='string')return null;
 let b;try{b=JSON.parse(opts.body);}catch{return null;}
 if(authScope&&!Array.isArray(b)&&Array.isArray(b?.params)&&b.params.length===2&&isPinnedBlockTag(b.params[1])){
  const target=String(b.method==='eth_getCode'?b.params[0]:b.params[0]?.to||'').toLowerCase();
  if(/^0x[0-9a-f]{40}$/.test(target)&&target!==CURRENT&&
   (b.method==='eth_getCode'||b.method==='eth_call'&&authoritySelectors.has(String(b.params[0]?.data||'').toLowerCase())))return 'augAuthority';
 }
 if(!Array.isArray(b)&&b?.method==='eth_getStorageAt'&&Array.isArray(b.params)&&b.params.length===3&&reviewedSlots.has(String(b.params[1]).toLowerCase()))return 'augReviewed';
 if(!Array.isArray(b)&&b?.method==='eth_getStorageAt'&&Array.isArray(b.params)&&b.params.length===3&&String(b.params[1]).toLowerCase()===LEGACY_ADMIN_SLOT&&isPinnedBlockTag(b.params[2]))return 'augBinding';
 if(!Array.isArray(b)&&b?.method==='eth_getCode'&&Array.isArray(b.params)&&b.params.length===2&&CURRENT&&String(b.params[0]).toLowerCase()!==CURRENT&&isPinnedBlockTag(b.params[1]))return 'augBinding';
 if(Array.isArray(b)||b?.method!=='eth_call'||!Array.isArray(b.params))return null;
 const data=String(b.params[0]?.data||'').toLowerCase();
 if(b.params.length===2&&isPinnedBlockTag(b.params[1])&&(customRoleSelectors.has(data.slice(0,10))||accessRoleSelectors.has(data.slice(0,10))))return 'augCustomRole';
 if(probeModule&&data===probeModule.PROBE_SELECTOR&&b.params.length<=3){
  if(b.params.length===3){const ov=b.params[2]||{},keys=Object.keys(ov);const proxy=keys.find(k=>k!==probeModule.PROBE_TARGET);
   if(keys.length!==2||!ov[probeModule.PROBE_TARGET]||ov[probeModule.PROBE_TARGET].code!==probeModule.PROBE_CODE||Object.keys(ov[proxy]?.stateDiff||{}).length!==1)return null;}
  return 'augProbe';
 }
 if(b.params.length===2&&siblingSelectors.has(data))return 'augSibling';
 if(b.params.length===2&&reviewedSelectors.has(data))return 'augReviewed';
 if(b.params.length===2&&isPinnedBlockTag(b.params[1])&&restrictionSelectors.has(data))return 'augRestriction';
 const to=String(b.params[0]?.to||'').toLowerCase();
 if(b.params.length===2&&isPinnedBlockTag(b.params[1])&&(data===PROXIABLE||data===OWNER_SEL&&CURRENT&&to!==CURRENT))return 'augBinding';
 return null;
}
const cursor={};
const stripId=o=>{const c={...o};delete c.id;return c;};
function canon(url,opts){let b=opts?.body;if(typeof b==='string'){try{const j=JSON.parse(b);b=JSON.stringify(Array.isArray(j)?j.map(stripId):stripId(j));}catch{}}return (opts?.method||'GET')+' '+String(url?.url||url)+' '+(b||'');}
function reid(text,opts){try{const rq=JSON.parse(opts?.body),rs=JSON.parse(text);if(Array.isArray(rq)&&Array.isArray(rs))rs.forEach((x,i)=>{if(x&&rq[i])x.id=rq[i].id;});else if(rq&&rs&&!Array.isArray(rs))rs.id=rq.id;return JSON.stringify(rs);}catch{return text;}}
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,opts)=>{const u=String(url?.url||url);let k='other';
 if(/sourcify/.test(u))k='sourcify';else if(/gopluslabs/.test(u))k='goplus';else if(/blockscout|explorer/.test(u))k='explorer';else if(opts?.method==='POST'&&/rpc|publicnode|chain\.robinhood|arc\./.test(u))k='rpc';
 net[k]++;const key=canon(url,opts);
 if(REPLAYING&&store[key]?.length){net.replayHit++;const q=store[key];const e=q[Math.min(cursor[key]=(cursor[key]??-1)+1,q.length-1)];if(e.status>=400)net.failed++;return new Response(e.status===204?null:reid(e.text,opts),{status:e.status,headers:{'content-type':e.type||'application/json'}});}
 // A replay must never silently fetch a new live response: it would make the paired comparison non-deterministic.
 const aug=budgetedKind(url,opts);
 if(aug){net[aug]++;try{const r=await realFetch(url,opts);if(!r.ok)net.failed++;const text=await r.text();(store[key]||=[]).push({status:r.status,type:r.headers.get('content-type'),text});return new Response(r.status===204?null:text,{status:r.status,headers:{'content-type':r.headers.get('content-type')||'application/json'}});}catch(e){net.failed++;throw e;}}
 if(REPLAYING){net.replayMiss++;net.failed++;return new Response(JSON.stringify({error:'BENCH_REPLAY_UNRECORDED'}),{status:503,headers:{'content-type':'application/json'}});}
 try{const r=await realFetch(url,opts);if(!r.ok)net.failed++;
  if(MODE==='record'||REPLAYING){const text=await r.text();(store[key]||=[]).push({status:r.status,type:r.headers.get('content-type'),text});return new Response(r.status===204?null:text,{status:r.status,headers:{'content-type':r.headers.get('content-type')||'application/json'}});}
  return r;}catch(e){net.failed++;throw e;}};
async function get(p){const base=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';const r=await realFetch(base+p,{headers:{accept:'application/json',referer:base+'/','sec-fetch-site':'same-origin'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json();}
const fixed=require('../data/verified-coverage/radar-cohort-20261121.json').tokens;
async function buildSamples(){
 const out=[],seen=new Set();const add=(chain,address,group)=>{const k=chain+address.toLowerCase();if(!seen.has(k)&&/^0x[0-9a-f]{40}$/i.test(address)){seen.add(k);out.push({chain,address,group});}};
 if(process.env.BENCH_FIXED_COHORT==='1')return fixed.map(t=>({chain:t.network,address:t.address,group:t.section,symbol:t.symbol}));
 for(const [c,a] of REGRESSION)add(c,a,'regression');
 for(const a of ETH_KNOWN)add('ethereum',a,'known');
 for(const section of ['arc','ethereum','robinhood','pons']){try{const d=await get('/api/search?action=radar&chain='+section);for(const t of (d.tokens||[]).slice(0,10))add(section==='pons'?'robinhood':section,t.address||t.token||'',section==='pons'?'pons':'radar');}catch(e){console.error('radar',section,e.message);}}
 for(const t of fixed)add(t.network,t.address,t.section==='pons'?'pons':'fixed');
 return out;
}
const mechanics=(chain,address)=>runMechanics(req,chain,address);
const short=v=>String(v??'').replace(/\s+/g,' ').slice(0,70);
(async()=>{
 const {classify}=req('search/server/lib/evidence-class');
 const samples=samplesFile&&fs.existsSync(samplesFile)?JSON.parse(fs.readFileSync(samplesFile,'utf8')):await buildSamples();
 if(process.env.BENCH_SAMPLES_ONLY==='1'){fs.writeFileSync('mechanics-samples.json',JSON.stringify(samples));console.log('samples',samples.length);return;}
 const rows=[];
 for(const s of samples){
  const before={...net},t0=Date.now();let res=null,err=null;CURRENT=s.address.toLowerCase();
  let timer;
  try{res=await Promise.race([mechanics(s.chain,s.address),new Promise((_,r)=>{timer=setTimeout(()=>r(Error('BENCH_TIMEOUT_60S')),60000);})]);}catch(e){err=String(e.message||e).slice(0,80);}finally{clearTimeout(timer);}
  const ms=Date.now()-t0,d=Object.fromEntries(Object.keys(net).map(k=>[k,net[k]-before[k]]));
  const f={},fails=new Set();for(const k of FIELDS){const x=fieldOf(res?.card,k);for(const q of (x?.analysisDiagnostics?.failures||[]))if(q?.reason)fails.add(q.reason);const c=classify(x||null,{card:'mechanics'});f[k]={ok:x?.dataState==='DATA_FOUND',state:res?dataClass(x,k):(err&&/RPC|429|timeout/i.test(err)?'RPC_ERROR':'NOT_VERIFIED'),cls:c.evidenceClass,status:x?.status||null,reason:x?.reasonCode||null,value:short(x?.value).slice(0,70)+(k==='ownerAdmin'&&x?.value?String(x.value).replace(/\s+/g,' ').slice(70,256):''),scope:short(x?.scope),evidence:proofs(x)};}
  const allEvidence=Object.values(res?.card?.fields||{}).flatMap(x=>x?.evidence||[]);
  const proof=allEvidence.find(x=>x?.method==='Mechanics analysis detail'&&x.block===res?.block)||allEvidence.find(x=>x?.sourceVerification&&x.block===res?.block);
  for(const item of proof?.failures||[])if(item.reason)fails.add(item.reason);
  const fees=allEvidence.find(x=>x.evidenceType==='FEE_ATTRIBUTION'&&x.block===res?.block)?.fees||null;
  const audit=proof?{source:proof.sourceVerification||null,sources:proof.sources?.slice(0,8),proxy:proof.proxyBinding||null,
   path:proof.delegationPath||null,authority:proof.authorityGraph||null,forensics:proof.forensics||null,reads:proof.readBudget||null,
   privileges:(proof.observations||[]).filter(x=>x.method==='hasRole'&&x.value===true||x.method==='getRoleAdmin'||/^\w+(?:owner|pauser|blacklister)\(\)/i.test(x.method))
    .slice(0,36),failures:proof.failures?.slice(0,20)||[]}:null;
  rows.push({...s,block:res?.block||null,err,ms,net:d,f,fails:[...fails].sort(),audit,fees,customRoleEvidence:customRoleEvidence(res?.card)});
  await new Promise(r=>setTimeout(r,600));
 }
 const cov={};for(const r of rows){const c=cov[r.chain+(r.group==='pons'?'/pons':'')]||={n:0,err:0,ms:0,rpc:0,src:0,f:Object.fromEntries(FIELDS.map(k=>[k,0])),states:Object.fromEntries(FIELDS.map(k=>[k,{}]))};c.n++;if(r.err)c.err++;c.ms+=r.ms;c.rpc+=r.net.rpc;c.src+=r.net.sourcify;for(const k of FIELDS){if(r.f[k].ok)c.f[k]++;c.states[k][r.f[k].state]=(c.states[k][r.f[k].state]||0)+1;}}
 const reasons={};for(const r of rows)for(const k of FIELDS)if(!r.f[k].ok){const key=k+':'+(r.f[k].reason||r.err||'none');reasons[key]=(reasons[key]||0)+1;}
 if(MODE==='record'||MODE==='augment')fs.writeFileSync(RFILE,JSON.stringify(store));
 let commit=null;try{commit=require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
 const out={label,mode:MODE,at:new Date().toISOString(),commit,net,cov,reasons,rows};
 fs.writeFileSync('mechanics-bench-'+label+'.json',JSON.stringify(out,null,1));
 fs.writeFileSync('mechanics-samples.json',JSON.stringify(samples));
 const esc=x=>x.replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,'%0A');
 console.log('::notice title=mech-'+label+'-cov::'+esc(JSON.stringify({cov,net,reasons})));
 let cur=[],i=0;const flush=()=>{if(cur.length)console.log('::notice title=mech-'+label+'-rows-'+(i++)+'::'+esc(JSON.stringify(cur)));cur=[];};
 for(const r of rows){const row=[r.chain[0]+(r.group==='pons'?'p':''),r.address.slice(2,8),r.ms,r.net.rpc,r.net.sourcify,r.net.replayMiss,...FIELDS.map(k=>r.f[k].ok?1:0),FIELDS.map(k=>r.f[k].ok?r.f[k].status:(r.f[k].reason||r.err||'-')).join('|'),r.fails.join(',')];if(JSON.stringify([...cur,row]).length>3300)flush();cur.push(row);}
 flush();
})().catch(e=>{console.error(e);process.exitCode=1;});
