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
// Real-chain finding (probe 46152526256, 2026-11-28): the block at which historical StateView state first shows the pool is NOT the block of
// its Initialize log (Arc: log 4-41 blocks EARLIER; Robinhood: outside +-300). A single-block log query therefore returns nothing. The log is
// searched in bounded windows moving outward from the bisected block; topic1 (poolId) filters server-side and the keccak proof still decides.
const INITIALIZE='0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const addrOf=h=>typeof h==='string'&&/^0x[0-9a-f]{64}$/i.test(h)?'0x'+h.slice(-40).toLowerCase():null;
const signed24=x=>{x&=0xffffffn;return x>=0x800000n?x-0x1000000n:x;};
async function findInitializeLog(rpc,{poolManager,poolId,cb,chunk=5000,windows=6,head}){
 const q=async(from,to)=>{
  if(to<from||to<0)return [];from=Math.max(0,from);if(head!==undefined)to=Math.min(to,head);if(to<from)return [];
  const out=await rpc('eth_getLogs',[{address:poolManager,topics:[INITIALIZE,poolId],fromBlock:hex(from),toBlock:hex(to)}]);
  if(!Array.isArray(out))throw fail('V4_LOG_MALFORMED');
  return out.filter(l=>String(l.address).toLowerCase()===poolManager&&!l.removed&&String(l.topics?.[1]).toLowerCase()===poolId&&Array.isArray(l.topics)&&l.topics.length===4);
 };
 const tries=[[cb-64,cb+64]];
 for(let i=0;i<windows;i++){tries.push([cb-(i+1)*chunk,cb-i*chunk-1]);tries.push([cb+i*chunk,cb+(i+1)*chunk-1]);}
 const seen=new Set();
 for(const [a,b] of tries){
  const k=a+':'+b;if(seen.has(k))continue;seen.add(k);
  let logs;try{logs=await q(a,b);}catch(e){if(e.code==='ONCHAIN_BUDGET_EXHAUSTED'||e.code==='ONCHAIN_TIMEOUT')throw e;continue;}
  if(logs.length===1)return logs[0];
  if(logs.length>1)throw fail('V4_INITIALIZE_LOG_AMBIGUOUS');
 }
 throw fail('V4_INITIALIZE_LOG_NOT_FOUND');
}
// -> PoolKey proven by keccak256(abi.encode(PoolKey)) == poolId (hash = market-onchain.poolId). The RPC is trusted for nothing.
async function resolveKey(rpc,{stateView,poolManager,poolId,head,chunk,windows,hash}){
 const cb=await creationBlock(rpc,{stateView,poolId,head});
 const l=await findInitializeLog(rpc,{poolManager,poolId,cb,chunk,windows,head});
 if(typeof l.data!=='string'||!/^0x([0-9a-f]{64}){3,}$/i.test(l.data))throw fail('V4_LOG_MALFORMED');
 const w=l.data.slice(2).match(/.{64}/g).map(x=>BigInt('0x'+x));
 const k={currency0:addrOf(l.topics[2]),currency1:addrOf(l.topics[3]),fee:Number(w[0]&0xffffffn),tickSpacing:Number(signed24(w[1])),hooks:'0x'+(w[2]&((1n<<160n)-1n)).toString(16).padStart(40,'0')};
 if(!k.currency0||!k.currency1||hash(k)!==poolId)throw fail('V4_KEY_HASH_MISMATCH');
 return {...k,initializeBlock:Number(BigInt(l.blockNumber)),bisectedBlock:cb};
}
module.exports={creationBlock,initialisedAt,findInitializeLog,resolveKey,INITIALIZE,SEL_GETSLOT0};
