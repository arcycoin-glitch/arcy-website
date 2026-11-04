'use strict';
// Independent Arc (5042) holder candidate discovery from on-chain Transfer logs, used when the explorer index that
// DISCOVER normally paginates is unavailable. Evidence (CI read-only probes, 2026-11-04):
//  - arcexplorer.org answered HTTP 522 after ~19.7 s on /stats, /tokens/<a> and /holders for every contract (incl. ARCY);
//  - explorer.arc.io (Blockscout) answers automated clients with a Cloudflare bot challenge (HTTP 403), so it is NOT an
//    eligible machine source and is never bypassed;
//  - rpc.mainnet.arc.io serves archive eth_getCode and 1000/2000-block eth_getLogs windows; Blockdaemon prunes history.
// This module only locates the contract's deployment block (bounded, checkpointed binary search on eth_getCode). The scan
// itself reuses the existing CATCHUP phase (holder-log-range, same pacing, windows and provider failover) from
// deployBlock-1 to the pinned block, and publication still requires exact pinned-block totalSupply reconciliation.
const core=require('./core'),B=require('./holder-budget'),c=B.facade(core,['rpc']);
const DEFAULT_MAX_SPAN=10000000,HARD_MAX_SPAN=50000000,MAX_PASSES=2;
function enabled(){return String(process.env.ARC_HOLDER_RPC_DISCOVERY||'on').toLowerCase()!=='off';}
// Upper bound on blocks a single RPC discovery may scan (cost bound). Older contracts get an explicit, non-silent blocker.
function maxSpan(){const n=Math.floor(Number(process.env.ARC_HOLDER_RPC_DISCOVERY_MAX_BLOCKS));return Number.isFinite(n)&&n>0?Math.min(HARD_MAX_SPAN,n):DEFAULT_MAX_SPAN;}
const hex=n=>'0x'+n.toString(16);
const hasCode=v=>typeof v==='string'&&/^0x[0-9a-f]*$/i.test(v)&&v.length>2;
const err=(code,extra={})=>Object.assign(new Error(code),{code,...extra});
// Advances s.deploySearch in place. Returns true once s.deployBlock is known. `save` is called after every step so a
// restart resumes from the persisted bracket; `deadline()` returns true when the slice budget is spent.
async function locate(a,s,{deadline=()=>false,save=async()=>{}}={}){
 if(Number.isSafeInteger(s.deployBlock))return true;
 if(!s.deploySearch){
  const head=Number(BigInt(await c.rpc('eth_blockNumber',[])));
  if(!Number.isSafeInteger(head)||head<1)throw err('BLOCK_HEAD_UNAVAILABLE');
  if(!hasCode(await c.rpc('eth_getCode',[a,hex(head)])))throw err('HOLDER_RPC_DISCOVERY_NO_CONTRACT_CODE');
  s.deploySearch={lo:0,hi:head,head,steps:0};await save();
 }
 while(s.deploySearch.hi-s.deploySearch.lo>1){
  if(deadline())return false;
  const mid=Math.floor((s.deploySearch.lo+s.deploySearch.hi)/2),code=await c.rpc('eth_getCode',[a,hex(mid)]);
  if(typeof code!=='string'||!/^0x[0-9a-f]*$/i.test(code))throw err('MALFORMED_RPC_RESPONSE');
  s.deploySearch=hasCode(code)?{...s.deploySearch,hi:mid,steps:s.deploySearch.steps+1}:{...s.deploySearch,lo:mid,steps:s.deploySearch.steps+1};
  if(s.deploySearch.steps>64)throw err('HOLDER_RPC_DISCOVERY_SEARCH_DIVERGED');
  await save();
 }
 s.deployBlock=s.deploySearch.hi;return true;
}
// Called once the deployment block is known: rejects spans above the cost bound and hands the scan to READ -> CATCHUP.
function handoff(s,burns){
 const span=s.deploySearch.head-s.deployBlock+1;
 if(span>maxSpan())throw err('HOLDER_RPC_DISCOVERY_SPAN_EXCEEDED',{span,maxSpan:maxSpan()});
 s.phase='READ';s.block=null;s.offset=0;s.discoveryIndexedBlock=Math.max(0,s.deployBlock-1);
 s.addresses=[...new Set([...s.addresses,...burns])];
 return s;
}
module.exports={enabled,maxSpan,locate,handoff,hasCode,MAX_PASSES,DEFAULT_MAX_SPAN,HARD_MAX_SPAN};
