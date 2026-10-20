(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ARCYMechanicsPolicy=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const states=new Set(['ON_CHAIN','ONCHAIN_VERIFIED','ON_CHAIN_VERIFIED_UNITS','VERIFIED_SOURCE','VERIFIED_SOURCE_AND_STATE','GETTER_REPORTED','DETECTED','NOT_DETECTED','HISTORICAL_ONCHAIN_VERIFIED']);
 const keys=['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture'];
 function assess(card,context){
  const rows=keys.map(key=>{
   const f=card?.fields?.[key];if(!f||f.dataState!=='DATA_FOUND'||f.value===null||f.value===undefined)return false;
   const historical=f.freshness?.state==='LAST_VERIFIED'||f.status==='HISTORICAL_ONCHAIN_VERIFIED';
   if(historical&&(!Number.isFinite(Date.parse(f.freshness?.observedAt||''))||Date.parse(f.freshness.observedAt)>Date.now()+60000))return false;
   if(f.status==='NOT_DETECTED'&&f.value!==false)return false;
   const proofs=Array.isArray(f.evidence)?f.evidence:[];
   const proof=proofs.find(e=>e&&e.chainId===context.chainId&&(e.address||e.token||'').toLowerCase()===context.address?.toLowerCase()&&/^0x[0-9a-f]+$/i.test(e.block||'')&&(historical||e.block===context.block));
   if(!proof||f.chainId!==context.chainId||f.network!==context.network)return false;
   // Arc's legacy bridge labels reviewed hook/implementation evidence SOURCE_REPORTED.
   // A generic external security report is never upgraded by its label alone.
   const reviewedLegacy=f.status==='SOURCE_REPORTED'&&proofs.some(e=>e.block===proof.block&&e.hookSourceDigest&&e.runtimeMatch==='REVIEWED_COMPILER_TEMPLATE_IMMUTABLES_ONLY')&&/Sourcify/i.test(f.source||'');
   const normalizedLegacy=f.status==='VERIFIED'&&states.has(f.originalStatus)&&f.verificationStatus!=='MARKET_API_VERIFIED'&&f.source!=='GoPlus';
   if(!states.has(f.status)&&!normalizedLegacy&&!reviewedLegacy)return false;
   if(key==='tradingTaxes')return ['Buy','Sell','Transfer'].every(name=>{const m=new RegExp('\\b'+name+'\\s+([0-9]+(?:\\.[0-9]+)?)%').exec(String(f.value));return m&&Number(m[1])<=100;})&&!/NOT VERIFIED|unknown/i.test(String(f.value));
   return true;
  });
  const count=rows.filter(Boolean).length;
  return {visible:count>=2||rows[0],completeRows:count,rows,reason:count>=2||rows[0]?'Meaningful contract evidence available.':'Contract & Mechanics is hidden until two complete evidence-backed rows or a complete verified tax result are available.'};
 }
 return {assess};
});
