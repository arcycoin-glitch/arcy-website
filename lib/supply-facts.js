const c=require('./core');
const f=require('./fields');
const source=require('./verified-source');
const runtime=require('./mechanics-runtime');

// A zero lifetime supply-burn assertion is valid only for reviewed immutable
// ERC-20 implementations whose exact matched profile excludes all supply burns.
// Sending tokens to 0xdead is custody, not a reduction in totalSupply().
const IMMUTABLE_NONBURNABLE=new Set(['FIXED_SUPPLY_CAPPED_ERC20']);
async function verifiedSupplyBurned(address){
 const ctx=await c.context(address);
 if(!runtime.nonDelegating(ctx.code))return c.unknown('Outer runtime can delegate or is not proven immutable.','BURN_HISTORY_NOT_ESTABLISHED');
 const attestation=await source.lookup(address,ctx.code);
 if(attestation.dataState!=='DATA_FOUND'||attestation.address!==address||!IMMUTABLE_NONBURNABLE.has(attestation.profile?.id)||!['match','exact_match'].includes(attestation.runtimeMatch)){
  return c.unknown('No exact bytecode-matched immutable source profile proves lifetime supply burns.','BURN_HISTORY_NOT_ESTABLISHED');
 }
 const currentSupply=c.uint(await c.call(address,'0x18160ddd',ctx.block));
 const evidence=[{source:'Arc RPC + bytecode-matched reviewed source',address,chainId:c.CHAIN,block:ctx.block,sourceDigest:attestation.sourceDigest,profile:attestation.profile.id,method:'totalSupply() / complete reviewed nonburnable runtime',totalSupplyRaw:currentSupply.toString(),scope:'Proves zero supply-reducing token burns for this immutable reviewed implementation only. Tokens sent to zero/dead custody are NOT counted; buybacks are not implied.'}];
 return f.field('0','ONCHAIN_VERIFIED','Arc RPC / reviewed immutable source',evidence,'HIGH');
}
async function safelyVerifiedSupplyBurned(address){
 try{return await verifiedSupplyBurned(address);}
 catch(error){return {...c.unknown('The exact-contract burn evidence check could not complete.','BURN_EVIDENCE_REQUEST_FAILED',c.failure(error).dataState),failure:c.failure(error)};}
}
module.exports={verifiedSupplyBurned,safelyVerifiedSupplyBurned,IMMUTABLE_NONBURNABLE};
