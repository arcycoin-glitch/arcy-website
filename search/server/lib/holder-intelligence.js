'use strict';
// Holder & Whale intelligence (additive, card-level `holderIntelligence`; the four schema fields are untouched).
// 1. census():   what KIND of holder evidence this is — complete census, reconciled candidate ranking, count only,
//                historical snapshot or unavailable — with indexed block, snapshot time and reconciliation status.
//                A bounded / explorer-ranked result is never presented as a complete census.
// 2. concentration(): top 1 / 5 / 10 / 20 from pinned candidate balances, plus concentration ADJUSTED for positively
//                identified infrastructure (burn custody, verified DEX pools, the token contract itself). Unknown wallets are
//                never excluded, however large.
// 3. classifyRoles(): optional on-chain role proof for ranked candidates (eth_getCode at the pinned block; exact Uniswap
//                V2 / V3 factory round-trip; Uniswap v4 PoolManager exact address). Gated by ARCY_HOLDER_ROLE_ONCHAIN=true.
const VERSION='arcy-holder-intelligence-1';
const ADDRESS=/^0x[0-9a-f]{40}$/;
const present=f=>!!f&&f.dataState==='DATA_FOUND'&&f.value!==null&&f.value!==undefined;
const historical=f=>f?.status==='HISTORICAL_ONCHAIN_VERIFIED'||f?.freshness?.state==='LAST_VERIFIED';
const blockDec=b=>{try{return typeof b==='string'&&/^0x[0-9a-f]+$/i.test(b)?BigInt(b).toString():null;}catch{return null;}};
const INFRA=new Set(['BURN_ADDRESS','LIQUIDITY_POOL','DEX_POOL_MANAGER','TOKEN_CONTRACT_SELF']);
const ROLES=new Set(['UNKNOWN','BURN_ADDRESS','EXTERNALLY_OWNED_ADDRESS','EIP7702_DELEGATED_EOA','LIQUIDITY_POOL','DEX_POOL_MANAGER','TOKEN_CONTRACT_SELF','UNKNOWN_CONTRACT']);
const COMPLETE_STATUSES=new Set(['RECONCILED_SNAPSHOT','ONCHAIN_VERIFIED','SIGNED_ONCHAIN_SNAPSHOT','ON_CHAIN']);
function census(fields={},{network=null,block=null}={}){
 const F=fields||{},hc=F.holderCount,rank=[F.largestWalletPct,F.top10Pct,F.top20Pct].find(present)||null;
 const any=[hc,F.largestWalletPct,F.top10Pct,F.top20Pct].some(present);
 const proof=(rank||hc)?.evidence?.[0]||{};
 const out={version:VERSION,network,state:'UNAVAILABLE',complete:false,countBasis:null,rankingBasis:null,
  indexedBlock:blockDec(proof.block||proof.atBlock||block)||null,snapshotAt:(rank||hc)?.freshness?.observedAt||(rank||hc)?.snapshot?.completedAt||proof.checkedAt||null,
  reconciliation:'NOT_RECONCILED',limitation:null};
 if(present(hc))out.countBasis=hc.status==='RECONCILED_SNAPSHOT'?'FULL_CENSUS_AT_BLOCK':/ONCHAIN|ON_CHAIN|SIGNED/.test(hc.status||'')?'ONCHAIN_INDEX':'EXPLORER_OR_PROVIDER_REPORTED';
 if(!any){out.limitation='No holder evidence was returned for this exact contract; nothing is shown as zero.';return out;}
 if(rank){
  out.rankingBasis=rank.status==='RECONCILED_SNAPSHOT'?'ALL_HOLDERS_READ_AT_BLOCK':rank.status==='SOURCE_REPORTED_RPC_RECONCILED'?'SOURCE_RANKED_CANDIDATES_PINNED_BALANCES':
   COMPLETE_STATUSES.has(rank.status)?'COMPLETE_INDEX_RECONCILED':'PROVIDER_REPORTED';
 }
 if((rank&&historical(rank))||(!rank&&historical(hc))){
  out.state='HISTORICAL_SNAPSHOT';out.reconciliation=rank&&COMPLETE_STATUSES.has(rank.status)?'RECONCILED_TO_TOTAL_SUPPLY':'UNKNOWN';
  out.limitation='Last verified snapshot, not current data.';return out;
 }
 if(rank&&COMPLETE_STATUSES.has(rank.status)){
  out.state='COMPLETE_CENSUS';out.complete=true;out.reconciliation='RECONCILED_TO_TOTAL_SUPPLY';
  out.limitation='Every holder balance was reconciled to totalSupply() at one block. Beneficial ownership and wallet clustering are not proven.';return out;
 }
 if(rank&&rank.status==='SOURCE_REPORTED_RPC_RECONCILED'){
  out.state='RECONCILED_CANDIDATES';out.reconciliation='CANDIDATE_BALANCES_PINNED';
  out.limitation='Top candidates come from an explorer ranking; their balances are pinned on-chain. Not an exhaustive census: an unlisted larger wallet cannot be excluded, and the holder count is explorer-reported.';return out;
 }
 if(rank){out.state='PROVIDER_REPORTED_CONCENTRATION';out.limitation='Concentration reported by a provider; not reconciled on-chain.';return out;}
 out.state='COUNT_ONLY';out.limitation='Only a holder count is available; no wallet distribution was verified.';return out;
}
const round=x=>Math.round(x*10000)/10000;
function concentration(candidates,{token=null}={}){
 const rows=(Array.isArray(candidates)?candidates:[]).filter(r=>ADDRESS.test(String(r?.address||'').toLowerCase())&&Number.isFinite(r?.sharePct))
  .map(r=>({address:r.address.toLowerCase(),sharePct:r.sharePct,role:ROLES.has(r.role)?r.role:'UNKNOWN',roleEvidence:r.roleEvidence||null}))
  .sort((a,b)=>b.sharePct-a.sharePct);
 if(!rows.length)return null;
 const isInfra=r=>INFRA.has(r.role)||(token&&r.address===token);
 const ranked=rows.filter(r=>r.role!=='BURN_ADDRESS'); // same rule as the four published fields
 const sum=(list,n)=>list.length>=n?round(list.slice(0,n).reduce((s,r)=>s+r.sharePct,0)):null;
 const nonInfra=rows.filter(r=>!isInfra(r));
 const infra=rows.filter(isInfra).map(r=>({address:r.address,role:token&&r.address===token?'TOKEN_CONTRACT_SELF':r.role,sharePct:r.sharePct,evidence:r.roleEvidence}));
 const roles={};for(const r of rows){const k=token&&r.address===token?'TOKEN_CONTRACT_SELF':r.role;roles[k]=(roles[k]||0)+1;}
 // adjusted metrics need enough candidates left after removing identified infrastructure; otherwise withheld (not padded)
 return {basis:'Pinned balances of the published candidate list; percentages of totalSupply().',candidates:rows.length,
  raw:{top1:ranked[0]?round(ranked[0].sharePct):null,top5:sum(ranked,5),top10:sum(ranked,10),top20:sum(ranked,20)},
  adjusted:infra.length?{largestNonInfrastructureWalletPct:nonInfra[0]?round(nonInfra[0].sharePct):null,top5:sum(nonInfra,5),top10:sum(nonInfra,10),
   excludedInfrastructurePct:round(infra.reduce((s,r)=>s+r.sharePct,0)),
   note:'Excludes only positively identified infrastructure (burn custody, verified DEX pools / pool manager, the token contract). Unknown wallets remain included.'}:null,
  infrastructure:infra,roles,
  unknownLargeWallets:nonInfra.filter(r=>r.role==='UNKNOWN'||r.role==='UNKNOWN_CONTRACT').slice(0,5).map(r=>({address:r.address,sharePct:r.sharePct,role:r.role}))};
}
function intelligence(fields,{holderCandidates=[],network=null,block=null,token=null}={}){
 const c=census(fields,{network,block});
 const conc=holderCandidates?.length?concentration(holderCandidates,{token}):null;
 return {...c,concentration:conc};
}
// ── optional on-chain role proof (Ethereum) ─────────────────────────────────────────────────────────────────────
const ETH=Object.freeze({
 V2_FACTORIES:new Map([['0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f','Uniswap V2'],['0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac','SushiSwap']]),
 V3_FACTORIES:new Map([['0x1f98431c8ad98523631ae4a59f267346ea31f984','Uniswap V3']]),
 V4_POOL_MANAGER:'0x000000000004444c5dc75cb358380d2e3de08a90'
});
const SEL={factory:'0xc45a0155',token0:'0x0dfe1681',token1:'0xd21220a7',fee:'0xddca3f43',getPair:'0xe6a43905',getPool:'0x1698ee82'};
const word=a=>a.slice(2).toLowerCase().padStart(64,'0');
const addrOf=hex=>typeof hex==='string'&&/^0x[0-9a-f]{64}$/i.test(hex)&&/^0x0{24}/i.test(hex)?'0x'+hex.slice(-40).toLowerCase():null;
const uintOf=hex=>typeof hex==='string'&&/^0x[0-9a-f]{1,64}$/i.test(hex)?BigInt(hex):null;
function enabled(env=process.env){return env?.ARCY_HOLDER_ROLE_ONCHAIN==='true';}
// rpc(method, params) -> result. Every proof is pinned to `block`. Fails closed to UNKNOWN on any error.
async function classifyRole(address,{token,block,rpc,network='ethereum'}){
 const a=String(address).toLowerCase(),t=String(token).toLowerCase();
 const ev=(method,extra={})=>({method,block,network,...extra});
 if(a===t)return {role:'TOKEN_CONTRACT_SELF',roleEvidence:ev('address equals the token contract')};
 if(network==='ethereum'&&a===ETH.V4_POOL_MANAGER)return {role:'DEX_POOL_MANAGER',roleEvidence:ev('exact Uniswap v4 PoolManager address (Ethereum)')};
 let code;try{code=await rpc('eth_getCode',[a,block]);}catch{return {role:'UNKNOWN'};}
 if(typeof code!=='string'||!/^0x[0-9a-f]*$/i.test(code))return {role:'UNKNOWN'};
 if(code==='0x')return {role:'EXTERNALLY_OWNED_ADDRESS',roleEvidence:ev('eth_getCode returned empty code at the pinned block')};
 if(/^0xef0100[0-9a-f]{40}$/i.test(code))return {role:'EIP7702_DELEGATED_EOA',roleEvidence:ev('EIP-7702 delegation designator code')};
 if(network!=='ethereum')return {role:'UNKNOWN_CONTRACT',roleEvidence:ev('contract code present')};
 const call=async(to,data)=>{try{return await rpc('eth_call',[{to,data},block]);}catch{return null;}};
 const factory=addrOf(await call(a,SEL.factory));
 if(factory&&(ETH.V2_FACTORIES.has(factory)||ETH.V3_FACTORIES.has(factory))){
  const t0=addrOf(await call(a,SEL.token0)),t1=addrOf(await call(a,SEL.token1));
  if(t0&&t1&&(t0===t||t1===t)){
   if(ETH.V2_FACTORIES.has(factory)){
    const pair=addrOf(await call(factory,SEL.getPair+word(t0)+word(t1)));
    if(pair===a)return {role:'LIQUIDITY_POOL',roleEvidence:ev('factory().getPair(token0,token1) round-trip equals this address',{dex:ETH.V2_FACTORIES.get(factory),factory,token0:t0,token1:t1})};
   }else{
    const fee=uintOf(await call(a,SEL.fee));
    if(fee!==null&&fee<1000000n){
     const pool=addrOf(await call(factory,SEL.getPool+word(t0)+word(t1)+fee.toString(16).padStart(64,'0')));
     if(pool===a)return {role:'LIQUIDITY_POOL',roleEvidence:ev('factory().getPool(token0,token1,fee) round-trip equals this address',{dex:ETH.V3_FACTORIES.get(factory),factory,token0:t0,token1:t1,fee:Number(fee)})};
    }
   }
  }
 }
 return {role:'UNKNOWN_CONTRACT',roleEvidence:ev('contract code present; no verified DEX pool binding')};
}
// Strict request budget (audit correction): role proofs are optional, sequential and must never dominate a report.
// Worst case per candidate is 6 RPC calls (getCode, factory, token0, token1, fee, getPool). Defaults: 36 calls / 2.5 s.
// A candidate that cannot be started inside the remaining budget keeps role UNKNOWN (never guessed); the profile says so.
const ROLE_BUDGET=Object.freeze({maxCalls:36,maxMs:2500,perCandidateWorstCase:6});
async function classifyRoles(candidates,{token,block,rpc,network='ethereum',max=12,maxCalls=ROLE_BUDGET.maxCalls,maxMs=ROLE_BUDGET.maxMs,now=Date.now}={}){
 const out=[],t0=now(),profile={calls:0,ms:0,classified:0,skippedBudget:0,skippedMax:0,budget:{maxCalls,maxMs,max}};
 const counted=async(m,p)=>{if(profile.calls>=maxCalls)throw Object.assign(Error('ROLE_BUDGET_EXHAUSTED'),{code:'ROLE_BUDGET_EXHAUSTED'});profile.calls++;return rpc(m,p);};
 for(const [i,c] of (Array.isArray(candidates)?candidates:[]).entries()){
  if(c.role==='BURN_ADDRESS'){out.push(c);continue;}
  if(i>=max){profile.skippedMax++;out.push(c);continue;}
  if(maxCalls-profile.calls<ROLE_BUDGET.perCandidateWorstCase||now()-t0>=maxMs){profile.skippedBudget++;out.push(c);continue;}
  const r=await classifyRole(c.address,{token,block,rpc:counted,network});
  if(r.role!=='UNKNOWN')profile.classified++;
  out.push(r.role==='UNKNOWN'?c:{...c,role:r.role,roleEvidence:r.roleEvidence});
 }
 profile.ms=now()-t0;profile.budgetExhausted=profile.skippedBudget>0;
 Object.defineProperty(out,'profile',{value:profile,enumerable:false});
 return out;
}
module.exports={VERSION,ROLE_BUDGET,COMPLETE_STATUSES,ROLES,INFRA,ETH,census,concentration,intelligence,classifyRole,classifyRoles,enabled};
