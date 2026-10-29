'use strict';
// Field-level verification. Two independent public indexers (GeckoTerminal, DEX Screener) agreeing on the SAME pool is
// CROSS_VERIFIED. One provider alone is SOURCE_REPORTED. Missing or contradicting values are NOT_VERIFIED. Nothing is estimated.
// This is agreement between indexers, not an onchain proof.
const TOLERANCE=Object.freeze({priceUsd:0.03,volume24hUsd:0.25,liquidityUsd:0.25,fdvUsd:0.10,marketCapUsd:0.10,change24hPct:{abs:3},poolCreatedAt:{ms:10*60*1000}});
const FIELDS=['priceUsd','volume24hUsd','liquidityUsd','change24hPct','fdvUsd','marketCapUsd','poolCreatedAt'];
const finite=v=>typeof v==='number'&&Number.isFinite(v);
function agree(name,a,b){
 const t=TOLERANCE[name];
 if(name==='poolCreatedAt'){const x=Date.parse(a),y=Date.parse(b);return Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<=t.ms;}
 if(!finite(a)||!finite(b))return false;
 if(t.abs!==undefined)return Math.abs(a-b)<=t.abs;
 if(a===0&&b===0)return true;
 return Math.abs(a-b)<=t*Math.max(Math.abs(a),Math.abs(b));
}
const has=v=>v!==null&&v!==undefined&&!(typeof v==='number'&&!Number.isFinite(v));
// state: 'DISABLED' | 'UNAVAILABLE' | 'NO_MATCH' | 'MATCHED'
function verifyRow(gt,ds){
 const state=ds?.state||'DISABLED',pair=state==='MATCHED'?ds.pair:null,fields={};
 for(const f of FIELDS){
  const g=gt[f],d=pair?pair[f]:null,src=[];
  if(has(g))src.push({provider:'GeckoTerminal',value:g});
  if(has(d))src.push({provider:'DEX Screener',value:d});
  if(!has(g)&&!has(d)){fields[f]={status:'NOT_VERIFIED',value:null,reasonCode:'FIELD_NOT_PROVIDED',sources:[]};continue;}
  if(has(g)&&has(d)){
   fields[f]=agree(f,g,d)?{status:'CROSS_VERIFIED',value:g,sources:src}:{status:'NOT_VERIFIED',value:null,reasonCode:'SOURCES_DISAGREE',sources:src};
   continue;
  }
  fields[f]={status:'SOURCE_REPORTED',value:has(g)?g:d,sources:src,...(pair?{}:{crossCheck:state})};
 }
 const counts={CROSS_VERIFIED:0,SOURCE_REPORTED:0,NOT_VERIFIED:0};
 for(const v of Object.values(fields))counts[v.status]++;
 return {fields,counts,crossCheck:state,dexUrl:pair?.url||null};
}
// Pair-level join: the DEX Screener pair must be the SAME pool as the GeckoTerminal pool.
function matchPair(gt,pairs){
 if(!pairs||!pairs.length)return {state:'NO_MATCH'};
 const pair=pairs.find(p=>p.pair===gt.pool&&p.token===gt.address);
 return pair?{state:'MATCHED',pair}:{state:'NO_MATCH'};
}
module.exports={TOLERANCE,FIELDS,agree,verifyRow,matchPair};
