'use strict';
// Keep public provenance in measurement artifacts so every coverage gain can be
// audited against its contract, pinned block, full source digest and method.
function proofs(field){
 const keys=['chainId','network','address','block','method','scope','coverage','taxProofClass','absenceProofClass','directRuntime','sourceDigest','hookSourceDigest','portalSourceDigest','runtimeMatch','implementation','profile','sourceAssurance'];
 return (field?.evidence||[]).map(e=>Object.fromEntries(keys.filter(k=>e?.[k]!==undefined).map(k=>[k,e[k]]))).filter(e=>e.method||e.sourceDigest||e.hookSourceDigest);
}
module.exports={proofs};
