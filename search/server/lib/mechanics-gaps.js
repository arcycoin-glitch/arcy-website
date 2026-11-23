'use strict';
// Field-level explanations are evidence-gap descriptions, not replacement safety verdicts.
const LABELS=Object.freeze({
 tradingTaxes:{scope:'Transfer and trading fee execution',hint:'No verified percentage can be claimed, including 0%.'},
 mintCapability:{scope:'Mint and supply-increase execution',hint:'A missing mint() selector does not prove fixed supply.'},
 ownerAdmin:{scope:'Administrator, ownership and role permissions',hint:'A missing or zero owner() does not prove all authority is absent.'},
 transferRestrictions:{scope:'Pause, blacklist, allowlist and transfer-limit execution',hint:'A missing pause or blacklist selector does not prove transfers cannot be blocked.'}
});
// Short user-facing reasons (Mechanics V5). The complete technical explanation, including verified ABI interface hints,
// is kept in `explanation` and the evidence JSON shown under 'View sources & evidence'.
const PATH={tradingTaxes:'Fee',mintCapability:'Mint',ownerAdmin:'Admin',transferRestrictions:'Restriction'};
const SHORT=Object.freeze({
 MECHANICS_IMPLEMENTATION_UNRESOLVED:()=>'Proxy implementation path unresolved.',
 MECHANICS_SOURCE_IDENTITY_UNVERIFIED:()=>'Source identity or record format not verified.',
 MECHANICS_SOURCE_READ_UNAVAILABLE:()=>'Source provider unavailable; retry later.',
 MECHANICS_VERIFIED_SOURCE_UNAVAILABLE:()=>'Verified source unavailable.',
 MECHANICS_EXECUTION_PATH_UNREVIEWED:key=>PATH[key]+' execution path not yet reviewed in the verified source.'
});
function explain(key,field,details){
 if(!field||field.dataState==='DATA_FOUND'||!Object.hasOwn(LABELS,key))return field;
 const info=details?.sourceVerification;
 if(!info)return field; // no supported runtime result, preserve existing fail-closed reason
 let reasonCode,reason,preciseSourceReason=null;
 const label=LABELS[key];
 const fails=Array.isArray(details?.failures)?details.failures:[];
 if(info.matched){
  reasonCode='MECHANICS_EXECUTION_PATH_UNREVIEWED';
  reason=label.scope+' cannot yet be established from the exact-runtime verified source. '+label.hint;
  // Only ABI interface HINTS from source that already passed contract/runtime
  // identity verification. These are not tax rates, permissions or proven mint.
  const re=key==='tradingTaxes'?/tax|fee|levy|commission/i:
   key==='mintCapability'?/mint|issu|bridge|supply|cap/i:
   key==='transferRestrictions'?/pause|blacklist|blocklist|allowlist|whitelist|freeze|frozen|block|limit|max/i:
    /owner|admin|role|permission|auth|upgrade|pause|blacklist|masterminter/i;
  const candidates=(Array.isArray(details?.interfaceCandidates)?details.interfaceCandidates:[])
   .filter(x=>x&&typeof x.name==='string'&&/^[A-Za-z_][A-Za-z_0-9]{0,60}$/.test(x.name)&&re.test(x.name))
   .slice(0,4).map(x=>x.name);
  if(candidates.length)reason+=' Verified ABI exposes interface names: '+candidates.join(', ')+'. Their execution and authority are NOT VERIFIED.';
 }else if(fails.some(f=>f.reason==='IMPLEMENTATION_EXECUTION_UNRESOLVED')){
  reasonCode='MECHANICS_IMPLEMENTATION_UNRESOLVED';
  reason='The executed implementation or delegated control path could not be independently established. '+label.hint;
 }else if(fails.some(f=>/SOURCE_BYTECODE_MISMATCH|SOURCE_IDENTITY_MISMATCH|SOURCE_SCHEMA_INVALID/.test(f.reason||''))){
  reasonCode='MECHANICS_SOURCE_IDENTITY_UNVERIFIED';
  const cause=fails.find(f=>f?.reason==='SOURCE_SCHEMA_INVALID'||f?.reason==='SOURCE_BYTECODE_MISMATCH'||f?.reason==='SOURCE_IDENTITY_MISMATCH')?.reason;
  if(cause==='SOURCE_SCHEMA_INVALID'){
   preciseSourceReason='Published source record format is invalid or unsupported.';
   reason='The source response failed schema validation; this does not establish a mismatch with deployed bytecode. '+label.hint;
  }else if(cause==='SOURCE_BYTECODE_MISMATCH'){
   preciseSourceReason='Published source bytecode differs from deployed code.';
   reason='Source runtime bytecode does not match the pinned on-chain runtime. '+label.hint;
  }else{
   preciseSourceReason='Published source contract identity does not match.';
   reason='The source record failed contract chain/address identity validation. '+label.hint;
  }
 }else if(fails.some(f=>f.reason==='SOURCE_RATE_LIMIT'||f.reason==='SOURCE_TIMEOUT'||f.reason==='SOURCE_API_FAILED')){
  reasonCode='MECHANICS_SOURCE_READ_UNAVAILABLE';
  reason='Verified source retrieval was unavailable or timed out; no contract mechanic was inferred. '+label.hint;
 }else if(fails.some(f=>f.reason==='SOURCE_CODE_UNAVAILABLE'||f.reason==='SOURCE_VERIFICATION_INSUFFICIENT')){
  reasonCode='MECHANICS_VERIFIED_SOURCE_UNAVAILABLE';
  reason='No fully verified, pinned-runtime-matched contract source was obtained. '+label.hint;
 }else return field;
 return {...field,reasonCode,reason:preciseSourceReason||SHORT[reasonCode](key),explanation:reason,reasonDetail:field.reasonDetail||field.reason||null,
  verificationGap:{sourceProvider:info.provider,sourceAssurance:info.assurance,
   templateRejection:info.templateRejection,implementationExecutionResolved:info.implementationExecutionResolved,
   verifiedAbiHints:info.matched?(Array.isArray(details?.interfaceCandidates)?details.interfaceCandidates:[])
    .filter(x=>x&&typeof x.name==='string'&&/^[A-Za-z_][A-Za-z_0-9]{0,60}$/.test(x.name))
    .slice(0,16).map(x=>({name:x.name,mutability:x.stateMutability||null})):[],
   cause:reasonCode}};
}
module.exports={explain,LABELS,SHORT};
