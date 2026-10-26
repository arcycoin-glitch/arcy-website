'use strict';
// Restore a narrowly scoped exact-Arc-hook observation when an independent
// reviewed-source pass only established ordinary ERC-20 transfer behavior.
// NO ticker/address-specific override and NO manufactured percentage.
const {reviewed}=require('../../../lib/mechanics-hook');
const {contract}=require('./arc-legacy-evidence');
const ADDRESS=/^0x[0-9a-f]{40}$/;
function recover(original,{address,block,now=Date.now()}={}){
 if(!ADDRESS.test(address||'')||!/^0x[0-9a-f]+$/i.test(block||'')||
    original?.chainId!==5042||original.address!==address||!/^0x[0-9a-f]+$/i.test(original.block||''))return null;
 const delta=BigInt(original.block)-BigInt(block);
 // A different historical market or a stale scan is not a current read.
 if(delta>512n||delta< -512n)return null;
 const candidate=contract(original,address).tradingTaxes;
 if(candidate?.dataState!=='DATA_FOUND'||typeof candidate.value!=='string'||
  !/^Buy (?:0|[1-9]\d*)(?:\.\d+)?% · Sell (?:0|[1-9]\d*)(?:\.\d+)?% · Transfer (?:0|[1-9]\d*)(?:\.\d+)?%$/.test(candidate.value)||
  !/^Sourcify bytecode-matched reviewed V4 hook \+ Arc RPC$/.test(candidate.source||''))return null;
 const validHook=e=>e?.chainId===5042&&e.address===address&&e.block===original.block&&
  e.hookSourceDigest===reviewed.hook&&e.portalSourceDigest===reviewed.portal&&
  /^0x[0-9a-f]{40}$/i.test(e.hook||'')&&
  ['REVIEWED_COMPILER_TEMPLATE_IMMUTABLES_ONLY','match','exact_match'].includes(e.runtimeMatch);
 // All three rate fields must independently name the SAME reviewed hook at
 // the SAME block; one good sell proof may never legitimize an untrusted buy.
 const proofSets=['buyTax','sellTax','transferTax'].map(k=>
  (original.contractFields?.[k]?.evidence||[]).filter(validHook));
 if(proofSets.some(set=>set.length===0))return null;
 const hook=proofSets[0][0].hook;
 if(proofSets.some(set=>!set.some(e=>e.hook===hook)))return null;
 // The hook's buy/sell configuration is compiler-verified immutable; the
 // last successful on-chain reading is still tied to its actual block, not
 // relabeled as the report's different pinned block.
 if(original.block!==block)return {...candidate,status:'HISTORICAL_ONCHAIN_VERIFIED',
  freshness:{state:'LAST_VERIFIED',observedAt:new Date(now).toISOString(),block:original.block},
  scope:'Verified immutable launch-hook rates from a nearby on-chain block. Wallet-to-wallet transfer fees and other pools are distinct.'};
 return candidate;
}
module.exports={recover};
