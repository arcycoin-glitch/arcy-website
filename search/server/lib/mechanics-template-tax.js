'use strict';
// Upgrade an already REVIEWED OpenZeppelin ERC20 transfer-only fact to complete
// token-contract fee semantics, without new RPC calls, only if the proof also
// establishes the exact (or independently bound immutable-sibling) DIRECT runtime.
// Pool/hook fees and execution restrictions are never inferred.
const DIGEST=/^[0-9a-f]{64}$/i,ADDR=/^0x[0-9a-f]{40}$/i,BLOCK=/^0x[0-9a-f]+$/i;
const VALUE='Buy 0% · Sell 0% · Transfer 0%';
function proofAccepted(e,identity){
 if(!e||e.profile!=='OZ_ERC20_TEMPLATE'||e.coverage!=='TOKEN_TRANSFER_ONLY'||!DIGEST.test(e.sourceDigest||'')||
  e.method!=='Pinned OpenZeppelin ERC20 transfer path (no override) + exact source/bytecode match'||
  e.chainId!==identity.chainId||e.network!==identity.network||
  e.address?.toLowerCase()!==identity.address?.toLowerCase()||e.block!==identity.block||
  e.implementation?.toLowerCase()!==identity.address?.toLowerCase()||!e.template?.libraries?.includes('ERC20')||
  !Array.isArray(e.template?.unprovenGates)||e.template.unprovenGates.length!==0)return false;
 if(['match','exact_match'].includes(e.runtimeMatch))return e.sourceAssurance==='EXACT_DEPLOYED_BYTECODE_MATCH';
 if(e.runtimeMatch!=='SIBLING_REFERENCE_EXACT_MATCH_IMMUTABLES_ONLY'||e.sourceAssurance!=='SIBLING_RUNTIME_MATCH_IMMUTABLES_ONLY')return false;
 const r=e.runtimeReview;
 return Boolean(r&&r.referenceChainId===identity.chainId&&r.sourceDigest===e.sourceDigest&&
  DIGEST.test(r.maskedRuntimeSha256||'')&&ADDR.test(r.referenceAddress||'')&&
  r.immutables&&Object.keys(r.immutables).length>0&&
  Object.values(r.immutables).every(v=>ADDR.test(v||''))&&
  typeof r.compiledContract==='string'&&r.compiledContract.length>4);
}
function upgrade(card,{network,address,block,chainId}={}){
 if(!card?.fields||!ADDR.test(address||'')||!BLOCK.test(block||'')||!Number.isInteger(chainId))return card;
 const f=card.fields.tradingTaxes,architecture=card.fields.contractArchitecture;
 if(f?.dataState!=='DATA_FOUND'||f.status!=='VERIFIED_SOURCE'||f.value!=='Transfer 0% · DEX/hook fees NOT VERIFIED'||
  architecture?.dataState!=='DATA_FOUND'||architecture.value!=='NON-PROXY · runtime verified')return card;
 const identity={network,address,block,chainId};
 const observations=Array.isArray(f.evidence)?f.evidence:[];
 const p=observations.find(x=>proofAccepted(x,identity));
 if(!p)return card;
 const detail=observations.find(x=>x?.method==='Mechanics analysis detail'&&x.address?.toLowerCase()===address.toLowerCase()&&
  x.block===block&&x.chainId===chainId&&x.sourceVerification);
 const verified=detail?.sourceVerification;
 if(!verified?.matched||!verified?.templateAccepted||!verified?.implementationExecutionResolved||
  verified.assurance!==p.sourceAssurance||detail.sources?.some(x=>x.address?.toLowerCase()===address.toLowerCase()&&x.digest!==p.sourceDigest))return card;
 const archPinned=Array.isArray(architecture.evidence)&&architecture.evidence.some(x=>
  x.chainId===chainId&&x.address?.toLowerCase()===address.toLowerCase()&&x.block===block);
 if(!archPinned)return card;
 const evidence={...p,method:'Reviewed OZ ERC20 full-amount paths + pinned direct runtime',
  coverage:'TOKEN_TAX_ALL_TRANSFERS',tokenTaxScope:'TOKEN_CONTRACT_ONLY',sourceBoundNonDelegatingRuntime:true,
  mutable:false,tokenTax:{buy:'0',sell:'0',transfer:'0',denominator:'100',rounding:'NO_DEDUCTION',
   scope:'TOKEN_CONTRACT_ONLY',externalFees:{dex:'NOT_VERIFIED',hook:'NOT_VERIFIED'}},
  scope:'Token-contract deductions only. Verified unmodified OpenZeppelin ERC20 transfer and transferFrom move exactly the full token amount for every permitted sender/recipient, including pool directions; the deployed direct runtime/source identity and inheritance are pinned and checked. Independent DEX/pool/V4 hook fees, slippage and trading permission are NOT VERIFIED.'};
 return {...card,fields:{...card.fields,tradingTaxes:{...f,value:VALUE,status:'VERIFIED_SOURCE_AND_STATE',
  evidence:[evidence,...observations]}}};
}
module.exports={upgrade,proofAccepted,VALUE};
