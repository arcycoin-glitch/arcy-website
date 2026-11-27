'use strict';
// Keep public provenance in measurement artifacts so every coverage gain can be
// audited against its contract, pinned block, full source digest and method.
function proofs(field){
 const keys=['chainId','network','address','block','method','scope','coverage','tokenTaxScope','sourceBoundNonDelegatingRuntime','sourceBoundProxyRuntime','reviewedTokenProfile','sourceDigest','hookSourceDigest','portalSourceDigest','runtimeMatch','implementation','profile','sourceAssurance','sourceUrl','sourceReference','provider','evidenceType','verificationStatus','observedAt','tokenTax','mutable'];
 const pick=b=>b&&typeof b==='object'?Object.fromEntries(['proxyType','pathComplete','verificationStatus','implementation','effectiveImplementation','sourceDigest'].filter(k=>b[k]!==undefined).map(k=>[k,b[k]])):undefined;
 return (field?.evidence||[]).map(e=>{const o=Object.fromEntries(keys.filter(k=>e?.[k]!==undefined).map(k=>[k,e[k]]));const b=pick(e?.binding);if(b)o.binding=b;return o;}).filter(e=>e.method||e.sourceDigest||e.hookSourceDigest);
}
module.exports={proofs};
