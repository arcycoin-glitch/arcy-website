(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ARCYMechanicsPolicy=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const states=new Set(['ON_CHAIN','ONCHAIN_VERIFIED','ON_CHAIN_VERIFIED_UNITS','VERIFIED_SOURCE','VERIFIED_SOURCE_AND_STATE','GETTER_REPORTED','DETECTED','NOT_DETECTED','HISTORICAL_ONCHAIN_VERIFIED']);
 const keys=['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture'];
 function unavailableLabel(field){
  const code=String(field?.reasonCode||'').toUpperCase();
  if(code==='ANALYSIS_PENDING')return 'PENDING';
  if(code.includes('PROVIDER_DISABLED'))return 'SOURCE DISABLED';
  if(/UNSUPPORTED|NOT_SUPPORTED|NOT_IMPLEMENTED/.test(code))return 'UNSUPPORTED';
  if(/RPC/.test(code)&&/FAIL|TIMEOUT|UNAVAILABLE|RATE_LIMIT|ERROR/.test(code))return 'RPC UNAVAILABLE';
  if(field?.dataState==='SOURCE_API_FAILED'||/SOURCE_API_FAILED|SOURCE_TIMEOUT|SOURCE_RATE_LIMIT|UPSTREAM_HTTP_ERROR/.test(code))return 'SOURCE UNAVAILABLE';
  if(field?.dataState==='SOURCE_HAS_NO_DATA'||/SOURCE_UNAVAILABLE|DATA_UNAVAILABLE|SUPPLY_UNAVAILABLE|NO_SOURCE_DATA/.test(code))return 'DATA UNAVAILABLE';
  return 'NOT VERIFIED';
 }
 function validRate(value,name){
  const match=new RegExp('\\b'+name+'\\s+([0-9]+(?:\\.[0-9]+)?)%').exec(String(value));
  return !!match&&Number(match[1])<=100;
 }
 function assess(card,context){
  const outcomes=keys.map(key=>{
   const f=card?.fields?.[key];if(!f||f.dataState!=='DATA_FOUND'||f.value===null||f.value===undefined)return 'none';
   const historical=f.freshness?.state==='LAST_VERIFIED'||f.status==='HISTORICAL_ONCHAIN_VERIFIED';
   if(historical&&(!Number.isFinite(Date.parse(f.freshness?.observedAt||''))||Date.parse(f.freshness.observedAt)>Date.now()+60000))return 'none';
   if(f.status==='NOT_DETECTED'&&f.value!==false)return 'none';
   const proofs=Array.isArray(f.evidence)?f.evidence:[];
   const subject=e=>{const address=e?.address||e?.token;return typeof address==='string'&&typeof context.address==='string'&&e.chainId===context.chainId&&address.toLowerCase()===context.address.toLowerCase()&&(!e.network||e.network===context.network)};
   const proof=proofs.find(e=>subject(e)&&/^0x[0-9a-f]+$/i.test(e.block||'')&&(historical||e.block===context.block));
   if(f.chainId!==context.chainId||f.network!==context.network||typeof f.source!=='string'||!f.source.trim())return 'none';
   // Arc's legacy bridge labels reviewed hook/implementation evidence SOURCE_REPORTED.
   // A generic external security report is never upgraded by its label alone.
   const reviewedLegacy=!!proof&&f.status==='SOURCE_REPORTED'&&proofs.some(e=>e?.block===proof.block&&e.hookSourceDigest&&e.runtimeMatch==='REVIEWED_COMPILER_TEMPLATE_IMMUTABLES_ONLY')&&/Sourcify/i.test(f.source||'');
   const normalizedLegacy=f.status==='VERIFIED'&&states.has(f.originalStatus)&&f.verificationStatus!=='MARKET_API_VERIFIED'&&f.source!=='GoPlus';
   const verified=!!proof&&(states.has(f.status)||normalizedLegacy||reviewedLegacy);
   if(verified){
    if(key!=='tradingTaxes')return 'verified';
    if(['Buy','Sell','Transfer'].every(name=>validRate(f.value,name))&&!/NOT VERIFIED|unknown/i.test(String(f.value)))return 'verified';
    // A source-reviewed transfer path is valuable evidence but does not prove
    // buy/sell or external DEX/hook fees. Keep it visibly scoped and partial.
    if(['VERIFIED_SOURCE','VERIFIED_SOURCE_AND_STATE'].includes(f.status)&&
       proofs.some(e=>subject(e)&&e.block===proof.block&&e.coverage==='TOKEN_TRANSFER_ONLY'&&typeof e.sourceDigest==='string')&&
       /^Transfer\s+[0-9]+(?:\.[0-9]+)?%\s*·\s*DEX\/hook fees NOT VERIFIED$/i.test(String(f.value))&&validRate(f.value,'Transfer'))return 'partial';
    return 'none';
   }
   // Secondary providers remain labelled SOURCE REPORTED, never verified.
   if(f.status==='SOURCE_REPORTED'&&!historical&&proofs.some(subject)){
    if(key!=='tradingTaxes'||(validRate(f.value,'Buy')&&validRate(f.value,'Sell')&&
       (!/\bTransfer\s+[0-9]/i.test(String(f.value))||validRate(f.value,'Transfer'))))return 'reported';
   }
   return 'none';
  });
  const rows=outcomes.map(x=>x==='verified'),partialRows=outcomes.map(x=>x==='partial'),sourceReportedRows=outcomes.map(x=>x==='reported');
  const displayRows=outcomes.map(x=>x!=='none'),count=rows.filter(Boolean).length;
  return {visible:displayRows.some(Boolean),completeRows:count,partialCount:partialRows.filter(Boolean).length,sourceReportedCount:sourceReportedRows.filter(Boolean).length,rows,partialRows,sourceReportedRows,displayRows,reason:displayRows.some(Boolean)?'Exact-contract evidence is shown with its stated scope.':'Contract & Mechanics has no evidence-backed fields yet.'};
 }
 return {assess,unavailableLabel};
});
