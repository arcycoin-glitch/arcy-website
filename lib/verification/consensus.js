'use strict';
// Deterministic source-consensus decisions for ARCY verification.
//
// This module does not publish a MetricEvidence value by itself. In particular,
// tolerance-based market agreement may contain two different raw values; callers
// must preserve both observations and must not rewrite them as exact agreement.
//
// Market presets intentionally mirror the already-deployed Radar V2 comparison
// policy so introducing this engine does not silently change current semantics.
const PRESETS=Object.freeze({
 EXACT_ONCHAIN:Object.freeze({id:'exact-onchain-v1',kind:'EXACT',anchor:'REQUIRED'}),
 MARKET_PRICE_USD:Object.freeze({id:'market-price-usd-v1',kind:'RELATIVE',tolerance:0.03,anchor:'NONE',legacyField:'priceUsd'}),
 MARKET_VOLUME_24H_USD:Object.freeze({id:'market-volume-24h-usd-v1',kind:'RELATIVE',tolerance:0.25,anchor:'NONE',legacyField:'volume24hUsd'}),
 MARKET_LIQUIDITY_USD:Object.freeze({id:'market-liquidity-usd-v1',kind:'RELATIVE',tolerance:0.25,anchor:'NONE',legacyField:'liquidityUsd'}),
 MARKET_FDV_USD:Object.freeze({id:'market-fdv-usd-v1',kind:'RELATIVE',tolerance:0.10,anchor:'NONE',legacyField:'fdvUsd'}),
 MARKET_CAP_USD:Object.freeze({id:'market-cap-usd-v1',kind:'RELATIVE',tolerance:0.10,anchor:'NONE',legacyField:'marketCapUsd'}),
 MARKET_CHANGE_24H_PCT:Object.freeze({id:'market-change-24h-pct-v1',kind:'ABSOLUTE',tolerance:3,anchor:'NONE',legacyField:'change24hPct'}),
 POOL_CREATED_AT:Object.freeze({id:'pool-created-at-v1',kind:'TIME_MS',tolerance:10*60*1000,anchor:'NONE',legacyField:'poolCreatedAt'})
});
const STATES=Object.freeze({
 AGREED:'AGREED',
 SINGLE_SOURCE:'SINGLE_SOURCE',
 CONFLICTING:'CONFLICTING',
 NOT_COMPARABLE:'NOT_COMPARABLE',
 NO_EVIDENCE:'NO_EVIDENCE'
});
const SLUG=/^[a-z][a-z0-9_.-]{0,63}$/,HASH=/^0x[0-9a-f]{64}$/i,UINT=/^(0|[1-9][0-9]*)$/;
const fail=(code)=>Object.assign(Error(code),{code});
function plain(o){return o&&Object.getPrototypeOf(o)===Object.prototype;}
function source(o){
 if(!plain(o)||!SLUG.test(o.id||'')||!SLUG.test(o.operator||''))throw fail('CONSENSUS_INVALID_SOURCE');
 return {id:o.id,operator:o.operator};
}
function block(o){
 if(o===null||o===undefined)return null;
 if(!plain(o)||!UINT.test(o.number||'')||!HASH.test(o.hash||''))throw fail('CONSENSUS_INVALID_BLOCK');
 return {number:o.number,hash:o.hash.toLowerCase()};
}
function observation(o){
 if(!plain(o))throw fail('CONSENSUS_INVALID_OBSERVATION');
 const s=source(o.source),b=block(o.block);
 if(typeof o.unit!=='string'||!SLUG.test(o.unit)||!(o.scope===null||typeof o.scope==='string'))throw fail('CONSENSUS_INVALID_OBSERVATION');
 const t=Date.parse(o.observedAt);
 if(!Number.isFinite(t))throw fail('CONSENSUS_INVALID_OBSERVATION');
 return {source:s,value:o.value,unit:o.unit,scope:o.scope,observedAt:new Date(t).toISOString(),block:b};
}
function policy(p){
 if(!plain(p)||!SLUG.test(p.id||'')||!['EXACT','RELATIVE','ABSOLUTE','TIME_MS'].includes(p.kind)||
  !['REQUIRED','OPTIONAL','NONE'].includes(p.anchor))throw fail('CONSENSUS_INVALID_POLICY');
 if(p.kind!=='EXACT'&&!(typeof p.tolerance==='number'&&Number.isFinite(p.tolerance)&&p.tolerance>=0))throw fail('CONSENSUS_INVALID_POLICY');
 return p;
}
function number(v){
 if(typeof v==='number'&&Number.isFinite(v))return v;
 if(typeof v==='string'&&/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(v)){const n=Number(v);if(Number.isFinite(n))return n;}
 return null;
}
function time(v){
 if(typeof v==='number'&&Number.isFinite(v))return v;
 if(typeof v==='string'){
  if(/^(0|[1-9][0-9]*)$/.test(v)){const n=Number(v);if(Number.isFinite(n))return n;}
  const n=Date.parse(v);if(Number.isFinite(n))return n;
 }
 return null;
}
function equalValue(a,b,p){
 if(p.kind==='EXACT')return Object.is(a,b)||String(a)===String(b);
 if(p.kind==='TIME_MS'){const x=time(a),y=time(b);return x!==null&&y!==null&&Math.abs(x-y)<=p.tolerance;}
 const x=number(a),y=number(b);if(x===null||y===null)return false;
 if(p.kind==='ABSOLUTE')return Math.abs(x-y)<=p.tolerance;
 if(x===0&&y===0)return true;
 return Math.abs(x-y)<=p.tolerance*Math.max(Math.abs(x),Math.abs(y));
}
function difference(a,b,p){
 if(p.kind==='EXACT')return equalValue(a,b,p)?0:null;
 if(p.kind==='TIME_MS'){const x=time(a),y=time(b);return x===null||y===null?null:Math.abs(x-y);}
 const x=number(a),y=number(b);if(x===null||y===null)return null;
 if(p.kind==='ABSOLUTE')return Math.abs(x-y);
 const scale=Math.max(Math.abs(x),Math.abs(y));return scale===0?0:Math.abs(x-y)/scale;
}
function anchorDecision(rows,p){
 if(p.anchor==='NONE')return null;
 const present=rows.map(x=>x.block);
 if(p.anchor==='REQUIRED'&&present.some(x=>x===null))return {state:STATES.NOT_COMPARABLE,reasonCode:'BLOCK_ANCHOR_REQUIRED'};
 const anchored=present.filter(Boolean);if(anchored.length<2)return null;
 const numbers=new Set(anchored.map(x=>x.number));
 if(numbers.size>1)return {state:STATES.NOT_COMPARABLE,reasonCode:'BLOCK_NUMBER_MISMATCH'};
 const hashes=new Set(anchored.map(x=>x.hash));
 if(hashes.size>1)return {state:STATES.CONFLICTING,reasonCode:'BLOCK_HASH_MISMATCH'};
 return null;
}
function evaluate(input,chosenPolicy){
 const p=policy(chosenPolicy),rows=Array.from(input||[],observation);
 if(rows.length===0)return {state:STATES.NO_EVIDENCE,reasonCode:'NO_OBSERVATIONS',policy:p.id,operators:[],sources:[],selectedValue:null};
 if(rows.length>8)throw fail('CONSENSUS_TOO_MANY_OBSERVATIONS');
 if(new Set(rows.map(x=>x.source.id)).size!==rows.length)throw fail('CONSENSUS_DUPLICATE_SOURCE');
 const units=new Set(rows.map(x=>x.unit));if(units.size!==1)return {state:STATES.NOT_COMPARABLE,reasonCode:'UNIT_MISMATCH',policy:p.id,operators:[...new Set(rows.map(x=>x.source.operator))],sources:rows.map(x=>x.source.id),selectedValue:null};
 const scopes=new Set(rows.map(x=>JSON.stringify(x.scope)));if(scopes.size!==1)return {state:STATES.NOT_COMPARABLE,reasonCode:'SCOPE_MISMATCH',policy:p.id,operators:[...new Set(rows.map(x=>x.source.operator))],sources:rows.map(x=>x.source.id),selectedValue:null};
 const anchored=anchorDecision(rows,p);if(anchored)return {...anchored,policy:p.id,operators:[...new Set(rows.map(x=>x.source.operator))],sources:rows.map(x=>x.source.id),selectedValue:null};
 let maxDifference=0;
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
  const d=difference(rows[i].value,rows[j].value,p);
  if(d===null&&!equalValue(rows[i].value,rows[j].value,p))return {state:STATES.NOT_COMPARABLE,reasonCode:'VALUE_TYPE_MISMATCH',policy:p.id,operators:[...new Set(rows.map(x=>x.source.operator))],sources:rows.map(x=>x.source.id),selectedValue:null};
  if(d!==null)maxDifference=Math.max(maxDifference,d);
  if(!equalValue(rows[i].value,rows[j].value,p))return {state:STATES.CONFLICTING,reasonCode:'VALUES_DISAGREE',policy:p.id,operators:[...new Set(rows.map(x=>x.source.operator))],sources:rows.map(x=>x.source.id),selectedValue:null,maxDifference};
 }
 const operators=[...new Set(rows.map(x=>x.source.operator))];
 if(operators.length<2)return {state:STATES.SINGLE_SOURCE,reasonCode:'ONLY_ONE_OPERATOR',policy:p.id,operators,sources:rows.map(x=>x.source.id),selectedValue:p.kind==='EXACT'?rows[0].value:null,maxDifference};
 // A tolerance-based agreement deliberately has no selected value. The producer
 // must retain its chosen source separately instead of pretending both raw values were identical.
 return {state:STATES.AGREED,reasonCode:p.kind==='EXACT'?'EXACT_AGREEMENT':'WITHIN_DOCUMENTED_TOLERANCE',policy:p.id,
  operators,sources:rows.map(x=>x.source.id),selectedValue:p.kind==='EXACT'?rows[0].value:null,maxDifference};
}
module.exports={PRESETS,STATES,evaluate,equalValue,difference};
