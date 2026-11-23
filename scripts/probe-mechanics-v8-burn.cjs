'use strict';
// Explicit transaction, no log scan. Only an exact scoped burn receipt can
// become execution evidence. No signatures, writes, or market data required.
const deep=require('../search/server/lib/mechanics-deep'),{chain,verifyChainId}=require('../search/server/lib/chains');
const {verifiedBurnReceipt}=require('../search/server/lib/mechanics-v8-forensics');
const {address,recorder}=require('../search/server/lib/mechanics-v8-evidence');
const HASH=/^0x[0-9a-f]{64}$/i;
async function main(){
 const [network,rawToken,txHash]=process.argv.slice(2),token=address(rawToken);
 if(!network||!token||!HASH.test(txHash||''))throw Error('Usage: node scripts/probe-mechanics-v8-burn.cjs NETWORK TOKEN TX_HASH');
 const cfg=chain(network),client=require('../search/server/lib/'+(network==='ethereum'?'eth':network+'-rpc'));
 const sites=new Set();
 const rpc=(method,params,options)=>client.rpc(method,params,{timeoutMs:5000,...options,onProvider:host=>{sites.add(host);options?.onProvider?.(host);}});
 verifyChainId(network,await rpc('eth_chainId',[]));
 const [transaction,receipt]=await Promise.all([rpc('eth_getTransactionByHash',[txHash]),rpc('eth_getTransactionReceipt',[txHash])]);
 const block=receipt?.blockNumber;
 const unknown=reason=>process.stdout.write(JSON.stringify({network,chainId:cfg.chainId,address:token,block:block||null,
  transactionHash:txHash,verificationStatus:'UNKNOWN',reason},null,2)+'\n');
 if(!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(block||'')||receipt.transactionHash?.toLowerCase()!==txHash.toLowerCase())return unknown('RECEIPT_NOT_BOUND');
 const anchor=async()=>{const h=await rpc('eth_getBlockByNumber',[block,false]);return h?.number===block&&HASH.test(h.hash||'')?h.hash:null;};
 const before=await anchor();
 if(!before)return unknown('CANONICAL_HEADER_UNAVAILABLE');
 const r=await deep.inspect({network,address:token,block,rpc});
 const after=await anchor();
 if(after!==before)return unknown('CANONICAL_HASH_CHANGED_OR_UNAVAILABLE');
 const stamp=recorder({network,chainId:cfg.chainId,address:token,block,provider:[...sites].sort().join(', ')||cfg.label+' RPC'});
 const proof=verifiedBurnReceipt({token,proof:r.details.forensics?.burnCapability,transaction,receipt,canonicalHash:after,stamp});
 if(!proof)return unknown('EXACT_DIRECT_REVIEWED_BURN_RECEIPT_NOT_ESTABLISHED');
 process.stdout.write(JSON.stringify(proof,null,2)+'\n');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
