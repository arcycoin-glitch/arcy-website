'use strict';
// Seed additional chain holder queues from an operator-controlled, bounded allowlist.
// Example: ARC_HOLDER_CHAINS=5042,4663 + ARC_HOLDER_CHAIN_4663_SEED_ADDRESSES=0x...,0x...
// This never changes the Arc queue or searches arbitrary contracts on public demand.
const chains=require('./holder-chains');
const MAX_SEEDS=40;
const ADDRESS=/^0x[0-9a-f]{40}$/;
const invalid=code=>Object.assign(Error(code),{code});
function parse(chainId,env=process.env){
 const c=chains.get(chainId);
 if(c.chainId===5042)return [];
 const raw=String(env['ARC_HOLDER_CHAIN_'+c.chainId+'_SEED_ADDRESSES']||'').trim();
 if(!raw)return [];
 const values=raw.split(/[\s,]+/).filter(Boolean).map(s=>s.toLowerCase());
 if(values.length>MAX_SEEDS)throw invalid('HOLDER_CHAIN_SEED_LIMIT');
 if(values.some(s=>!ADDRESS.test(s)))throw invalid('HOLDER_CHAIN_SEED_INVALID_ADDRESS');
 return [...new Set(values)];
}
async function enqueue({env=process.env,submit=(chainId,addresses)=>require('./holder-chain-worker').enqueue(chainId,addresses),emit=()=>{}}={}){
 const output=[];
 for(const chainId of [...new Set(chains.enabledChains(env))].filter(id=>id!==5042)){
  const addresses=parse(chainId,env);
  if(!addresses.length)continue;
  const accepted=await submit(chainId,addresses);
  if(!Array.isArray(accepted)||accepted.length!==addresses.length||!accepted.every(Boolean))throw invalid('HOLDER_CHAIN_SEED_QUEUE_REJECTED');
  const row={chainId,state:'QUEUED',count:addresses.length};
  output.push(row);emit(row);
 }
 return output;
}
module.exports={parse,enqueue,MAX_SEEDS};
