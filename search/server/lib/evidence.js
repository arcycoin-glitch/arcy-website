'use strict';
// Every metric carries its verification state. A missing value is NEVER coerced to zero.
function unknown(reason='Reliable evidence unavailable.',code='INSUFFICIENT_EVIDENCE'){
  return {value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reasonCode:code,reason,source:null,evidence:[]};
}
function found(value,source,evidence,status='SOURCE_REPORTED',observedAt=Date.now()){
  if(value===null||value===undefined||(typeof value==='number'&&!Number.isFinite(value)))throw Error('Invalid verified field');
  if(!source||!Array.isArray(evidence)||!evidence.length)throw Error('Verified field needs source and evidence');
  const checkedAt=Date.now(),observed=Number.isFinite(observedAt)?observedAt:checkedAt;
  return {value,status,dataState:'DATA_FOUND',reasonCode:null,reason:null,source,chainId:1,network:'ethereum',freshness:{retrievedAt:new Date(observed).toISOString(),ageMs:Math.max(0,checkedAt-observed),basis:'Time since this provider response was retrieved; upstream publication time may be unavailable.'},evidence};
}
function error(e,source){
  return {...unknown('Data provider request failed.','SOURCE_API_FAILED'),dataState:'SOURCE_API_FAILED',source:source||null,details:String(e?.message||'Unexpected provider failure').slice(0,140)};
}
function card(fields,description){
  const values=Object.values(fields);
  return {description,status:values.some(x=>x.dataState==='DATA_FOUND')?'PARTIAL_EVIDENCE':values.some(x=>x.dataState==='SOURCE_API_FAILED')?'SOURCE_API_FAILED':'NOT_VERIFIED',fields};
}
module.exports={unknown,found,error,card};
