'use strict';
// Deterministic interface check for Arc holder jobs whose standard ERC-20 getters revert (issue #187).
// Production evidence (read-only CI probe, Arc RPC, 2026-11-07): 0x5bc5ced4… and 0xf89005cc… revert totalSupply(),
// balanceOf(), name(), symbol() and decimals() at deployment+10, mid-life and head, emit no Transfer events, and their
// runtimes dispatch token0()/token1()/fee()/slot0()/liquidity()/swap() and emit the Uniswap-V3 Initialize/Mint/Swap
// events. They are concentrated-liquidity POOLS, not tokens, so ERC-20 holder analysis does not apply to them.
// This check never infers balances and never turns a revert into zero: it only replaces the generic, every-6-hours
// GETTER_REVERTED retry with an accurate terminal reason when ALL of the following hold at ONE pinned block:
//   totalSupply() reverts AND token0()/token1() return two distinct non-zero addresses that have runtime code
//   AND fee() returns a uint24. Any provider error, malformed answer or partial match keeps GETTER_REVERTED.
const core=require('./core'),c=require('./holder-budget').facade(core,['rpc']);
const REASON='HOLDER_CONTRACT_IS_LIQUIDITY_POOL';
const SEL={totalSupply:'0x18160ddd',token0:'0x0dfe1681',token1:'0xd21220a7',fee:'0xddca3f43'};
const word=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
const asAddress=v=>word(v)&&/^0x0{24}/i.test(v)&&!/^0x0{64}$/i.test(v)?'0x'+v.slice(-40).toLowerCase():null;
const reverted=e=>e?.code==='GETTER_REVERTED'||/revert/i.test(String(e?.message||''));
async function attempt(a,data,block){try{return {ok:true,value:await c.rpc('eth_call',[{to:a,data},block])};}catch(e){if(e?.code==='HOLDER_WORKER_BUDGET_EXHAUSTED')throw e;return {ok:false,reverted:reverted(e)};}}
async function classify(a){
 if(!/^0x[0-9a-f]{40}$/.test(a))return null;
 const head=await c.rpc('eth_blockNumber',[]);if(typeof head!=='string'||!/^0x[0-9a-f]+$/i.test(head))return null;
 const supply=await attempt(a,SEL.totalSupply,head);if(supply.ok||!supply.reverted)return null;
 const [t0,t1,fee]=[await attempt(a,SEL.token0,head),await attempt(a,SEL.token1,head),await attempt(a,SEL.fee,head)];
 const token0=t0.ok?asAddress(t0.value):null,token1=t1.ok?asAddress(t1.value):null;
 if(!token0||!token1||token0===token1||!fee.ok||!word(fee.value)||BigInt(fee.value)>=2n**24n)return null;
 for(const t of [token0,token1]){const code=await c.rpc('eth_getCode',[t,head]);if(typeof code!=='string'||code.length<=2)return null;}
 return {reasonCode:REASON,block:head,token0,token1,fee:Number(BigInt(fee.value))};
}
module.exports={classify,REASON};
