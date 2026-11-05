'use strict';
// Verified-sibling runtime reuse. NOT a selector/name heuristic and NOT a safety verdict.
// A token whose own source is unpublished may reuse a curated, Sourcify EXACT-matched reference contract's source ONLY when:
//  1. same chain, identical runtime length;
//  2. every byte outside the reference's compiler-declared immutableReferences is identical, INCLUDING the trailing CBOR
//     metadata (same source tree + compiler settings);
//  3. every immutable region is an ABI-clean address word and regions of the same immutable id hold the same value;
//  4. the reference Sourcify record still exact-matches, has the pinned source digest, compiler, contract name and the
//     same immutable layout;
//  5. (enforced by the caller at the pinned block) the token's OWN getters return exactly its own immutable values.
// Exactly one family may match; anything else fails closed. Evidence (2026-11-05 audit): OAK, SIC, Kitsu, UPOCH, NOVUS,
// ZHOOK, LMNI equal ORBIO/VRAX outside the 4 declared immutables; each token's deployer()/launchFactory()/curve()
// return exactly its own immutable words.
const crypto=require('node:crypto');
const CODE=/^0x(?:[0-9a-f]{2})+$/i,ADDRESS_WORD=/^0{24}[0-9a-f]{40}$/i;
const FAMILIES=Object.freeze([Object.freeze({
 id:'PONS_V2_LAUNCHER_TOKEN',chainId:4663,length:3248,
 reference:'0xaa07a0e9209e16ac99708c3ec70159c6ef3128a3',
 compilation:'contracts/src/v2/PonsV2LauncherToken.sol:PonsV2LauncherToken',compilerVersion:'0.8.35+commit.47b9dedd',
 sourceDigest:'da39d2a3e273884304af6aff4ce471d35b8b5d44e233e45d11da5f670ffe304d',
 maskedRuntimeSha256:'4863376dd612d9d23f5e8c25eb84aecfe5a317764ba543497f6d14c9a70e64ea',
 immutableReferences:Object.freeze({'857':[{start:379,length:32},{start:529,length:32}],'859':[{start:1357,length:32}],'861':[{start:1094,length:32}]}),
 // view getter -> immutable id it must return (checked on the token itself at the pinned block)
 getters:Object.freeze({deployer:'857',launchFactory:'859',curve:'861'})
})]);
const regions=refs=>Object.entries(refs).flatMap(([id,list])=>list.map(r=>({id,start:r.start,length:r.length})));
function sameLayout(a,b){
 const x=regions(a||{}).map(r=>r.id+':'+r.start+':'+r.length).sort(),y=regions(b||{}).map(r=>r.id+':'+r.start+':'+r.length).sort();
 return x.length>0&&x.length===y.length&&x.every((v,i)=>v===y[i]);
}
// Returns the masked hash plus per-id immutable address values, or null when the runtime is not address-shaped/consistent.
function fingerprint(code,family){
 if(typeof code!=='string'||!CODE.test(code))return null;
 const bytes=Buffer.from(code.slice(2),'hex');if(bytes.length!==family.length)return null;
 const values={};
 for(const r of regions(family.immutableReferences)){
  if(r.length!==32||r.start<0||r.start+r.length>bytes.length)return null;
  const hex=bytes.subarray(r.start,r.start+r.length).toString('hex');
  if(!ADDRESS_WORD.test(hex)||/^0+$/.test(hex))return null;
  const value='0x'+hex.slice(24);
  if(values[r.id]&&values[r.id]!==value)return null;
  values[r.id]=value;
 }
 const masked=Buffer.from(bytes);for(const r of regions(family.immutableReferences))masked.fill(0,r.start,r.start+r.length);
 return {maskedRuntimeSha256:crypto.createHash('sha256').update(masked).digest('hex'),immutables:values};
}
function match(code,chainId,families=FAMILIES){
 const hits=families.filter(f=>f.chainId===Number(chainId)).map(f=>{const p=fingerprint(code,f);return p&&p.maskedRuntimeSha256===f.maskedRuntimeSha256?{family:f,immutables:p.immutables}:null;}).filter(Boolean);
 return hits.length===1?hits[0]:null; // ambiguity fails closed
}
// Validate the reference record exactly as pinned. Throws on any deviation.
function validateReference(d,family){
 const deep=require('./mechanics-deep');
 const onchain=d?.runtimeBytecode?.onchainBytecode;
 if(d?.runtimeMatch!=='exact_match'||typeof onchain!=='string')throw Error('SIBLING_REFERENCE_NOT_EXACT');
 const checked=deep.validateSource(d,{chainId:family.chainId,address:family.reference,code:onchain});
 if(checked.digest!==family.sourceDigest)throw Error('SIBLING_REFERENCE_SOURCE_CHANGED');
 if(d.compilation?.fullyQualifiedName!==family.compilation||d.compilation?.compilerVersion!==family.compilerVersion)throw Error('SIBLING_REFERENCE_COMPILATION_CHANGED');
 if(!sameLayout(d.runtimeBytecode.immutableReferences,family.immutableReferences))throw Error('SIBLING_REFERENCE_LAYOUT_CHANGED');
 const ref=fingerprint(onchain,family);
 if(!ref||ref.maskedRuntimeSha256!==family.maskedRuntimeSha256)throw Error('SIBLING_REFERENCE_RUNTIME_CHANGED');
 return checked;
}
async function reference({cfg,code,reader,diagnostics,hit}){
 const family=hit.family,url='https://sourcify.dev/server/v2/contract/'+family.chainId+'/'+family.reference+'?fields=abi,sources,compilation,runtimeBytecode';
 try{
  const body=await reader.json(url,{maxBytes:4*1024*1024,timeoutMs:4000,validate:d=>{validateReference(d,family);return true;}});
  const checked=validateReference(body,family);
  const opts={lib:require('./oz-library-hashes'),main:typeof body.compilation?.name==='string'?body.compilation.name:undefined};
  let template=null,templateDiagnostic=null;
  try{const oz=require('./oz-template');template=oz.analyze(body.sources,opts);if(!template)templateDiagnostic=oz.diagnose(body.sources,opts)?.reason||'NOT_CLASSIFIED';}catch{}
  return {...checked,...(template?{template}:{}),templateDiagnostic,
   runtimeMatch:'SIBLING_REFERENCE_EXACT_MATCH_IMMUTABLES_ONLY',
   sourceProvider:'Sourcify (verified sibling reference)',sourceAssurance:'SIBLING_RUNTIME_MATCH_IMMUTABLES_ONLY',
   url,retrievedAt:new Date(reader.observedAt(url)).toISOString(),
   siblingReview:{family:family.id,getters:family.getters,immutables:hit.immutables},
   runtimeReview:{family:family.id,referenceAddress:family.reference,referenceChainId:family.chainId,compiledContract:family.compilation,
    compiler:family.compilerVersion,sourceDigest:family.sourceDigest,maskedRuntimeSha256:family.maskedRuntimeSha256,immutables:hit.immutables,
    scope:'This token\'s runtime equals the Sourcify exact-matched reference byte-for-byte outside the compiler-declared immutable regions (metadata included). Its own getters were re-read at the pinned block. Same code does NOT imply same safety: launch factory, curve and pool contracts are separate and NOT audited.'}};
 }catch(e){
  diagnostics.push({source:'Sourcify',address:family.reference,chainId:family.chainId,sourceUrl:url,reason:e.httpStatus?('SIBLING_REFERENCE_HTTP_'+e.httpStatus):String(e.message||'SIBLING_REFERENCE_INVALID').slice(0,60)});
  return null;
 }
}
module.exports={FAMILIES,fingerprint,match,validateReference,reference,sameLayout};
