'use strict';
// Bounded historical resolution of a Uniswap v4 PoolKey WITHOUT a full-range log scan (public Arc / Robinhood / Ethereum RPCs reject
// topic-filtered getLogs over the whole chain, #337 probe 2026-11-28). A pool is initialised exactly once and stays initialised, so
// StateView.getSlot0(poolId).sqrtPriceX96 != 0 is MONOTONIC in block height. A binary search over historical state therefore finds the
// creation block in ~log2(head) calls; one single-block eth_getLogs (topic0 = Initialize, topic1 = poolId) then returns the event whose
// data carries the key. The caller must still prove keccak256(abi.encode(PoolKey)) == poolId, so the RPC is trusted for nothing.
// Requires historical eth_call state on the RPC (archive). If it is pruned the search fails closed (V4_HISTORY_UNAVAILABLE).
const SEL_GETSLOT0='0xc815641c';
const fail=(c,x)=>Object.assign(Error(c),{code:c},x||{});
const hex=n=>'0x'+BigInt(n).toString(16);
async function initialisedAt(rpc,stateView,poolId,block){
 let out;
 try{out=await rpc('eth_call',[{to:stateView,data:SEL_GETSLOT0+poolId.slice(2)},hex(block)]);}
 catch(e){
  if(e.code==='ONCHAIN_BUDGET_EXHAUSTED'||e.code==='ONCHAIN_TIMEOUT')throw e;
  // A revert / empty return before the StateView or PoolManager existed means "not initialised yet". Pruned-state errors are not that.
  if(/pruned|missing trie|state.*not available|header not found|historical state|4444/i.test(String(e.message)+' '+String(e.code)))throw fail('V4_HISTORY_UNAVAILABLE');
  return false;
 }
 if(typeof out!=='string'||!/^0x[0-9a-f]*$/i.test(out))throw fail('V4_HISTORY_UNAVAILABLE');
 if(out.length<66)return false;
 return BigInt('0x'+out.slice(2,66))>0n;
}
// -> creation block number (first block at which the pool is initialised), within head.
async function creationBlock(rpc,{stateView,poolId,head,lowerBound=0}){
 head=Number(head);if(!Number.isSafeInteger(head)||head<=0)throw fail('V4_HEAD_INVALID');
 if(!(await initialisedAt(rpc,stateView,poolId,head)))throw fail('V4_POOL_NOT_INITIALISED');
 let lo=Math.max(0,Number(lowerBound)),hi=head; // invariant: initialised at hi, unknown/false below lo
 if(lo>0&&await initialisedAt(rpc,stateView,poolId,lo))return lo;
 while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(await initialisedAt(rpc,stateView,poolId,mid))hi=mid;else lo=mid;}
 return hi;
}
module.exports={creationBlock,initialisedAt,SEL_GETSLOT0};
