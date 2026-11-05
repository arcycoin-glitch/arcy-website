'use strict';
// Field-level explanations are evidence-gap descriptions, not replacement safety verdicts.
const LABELS=Object.freeze({
 tradingTaxes:{scope:'Transfer and trading fee execution',hint:'No verified percentage can be claimed, including 0%.'},
 mintCapability:{scope:'Mint and supply-increase execution',hint:'A missing mint() selector does not prove fixed supply.'},
 ownerAdmin:{scope:'Administrator, ownership and role permissions',hint:'A missing or zero owner() does not prove all authority is absent.'}
});
function explain(key,field,details){
 if(!field||field.dataState==='DATA_FOUND'||!Object.hasOwn(LABELS,key))return field;
 const info=details?.sourceVerification;
 if(!info)return field; // no supported runtime result, preserve existing fail-closed reason
 let reasonCode,reason;
 const label=LABELS[key];
 const fails=Array.isArray(details?.failures)?details.failures:[];
 if(info.matched){
  reasonCode='MECHANICS_EXECUTION_PATH_UNREVIEWED';
  reason=label.scope+' cannot yet be established from the exact-runtime verified source. '+label.hint;
 }else if(fails.some(f=>f.reason==='IMPLEMENTATION_EXECUTION_UNRESOLVED')){
  reasonCode='MECHANICS_IMPLEMENTATION_UNRESOLVED';
  reason='The executed implementation or delegated control path could not be independently established. '+label.hint;
 }else if(fails.some(f=>/SOURCE_BYTECODE_MISMATCH|SOURCE_IDENTITY_MISMATCH|SOURCE_SCHEMA_INVALID/.test(f.reason||''))){
  reasonCode='MECHANICS_SOURCE_IDENTITY_UNVERIFIED';
  reason='Published source did not pass exact contract and deployed-bytecode validation. '+label.hint;
 }else if(fails.some(f=>f.reason==='SOURCE_RATE_LIMIT'||f.reason==='SOURCE_TIMEOUT'||f.reason==='SOURCE_API_FAILED')){
  reasonCode='MECHANICS_SOURCE_READ_UNAVAILABLE';
  reason='Verified source retrieval was unavailable or timed out; no contract mechanic was inferred. '+label.hint;
 }else if(fails.some(f=>f.reason==='SOURCE_CODE_UNAVAILABLE'||f.reason==='SOURCE_VERIFICATION_INSUFFICIENT')){
  reasonCode='MECHANICS_VERIFIED_SOURCE_UNAVAILABLE';
  reason='No fully verified, pinned-runtime-matched contract source was obtained. '+label.hint;
 }else return field;
 return {...field,reasonCode,reason,reasonDetail:field.reasonDetail||field.reason||null,
  verificationGap:{sourceProvider:info.provider,sourceAssurance:info.assurance,
   templateRejection:info.templateRejection,implementationExecutionResolved:info.implementationExecutionResolved,
   cause:reasonCode}};
}
module.exports={explain,LABELS};
