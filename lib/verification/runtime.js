'use strict';
// ARCY Autonomous Verification Runtime (opt-in: ARC_AUTONOMY_VERIFICATION_RUNTIME_ENABLED=1, default OFF).
//
// Runs after a Search report is built and adds ONE top-level `verification` object. It never changes a card, a
// field, a value, a status or a reasonCode, so with the flag OFF (or on any runtime failure) every existing API
// contract is byte-for-byte what it was.
//
// For every displayed metric it answers, with machine-readable states:
//   current?          freshness engine (lib/verification/freshness.js), per data class
//   where from?       source id, class and OPERATOR (lib/verification/source-identity.js)
//   independently confirmed?  same-block re-read by a second registered operator (on-chain) or the existing,
//                     licence-gated market cross-check (market); decided by lib/verification/consensus.js
//   do sources disagree?      explicit CONFLICTING with both original values
//   may it be called VERIFIED?  only through the strict MetricEvidence contract (lib/verification/metric-evidence.js)
//   changed since the last trusted observation?  durable Evidence Ledger, when storage exists
//
// Hard rules kept here:
//  * a tolerance agreement between market providers is never published as exact agreement (it stays SINGLE_SOURCE
//    with both raw values kept in `consensus`);
//  * a value whose age cannot be shown is never FRESH, and only FRESH evidence can become VERIFIED;
//  * the ledger's lastTrusted is reported as history, never as today's reading;
//  * without durable storage the runtime says history is NOT_PRESERVED instead of pretending.
const crypto=require('node:crypto');
const evidence=require('./metric-evidence');
const consensus=require('./consensus');
const freshness=require('./freshness');
const identity=require('./source-identity');
const catalog=require('./metric-catalog');
const observer=require('./onchain-observer');
const evidenceLedger=require('./evidence-ledger');
const {chain}=require('../../search/server/lib/chains');

const FLAG='ARC_AUTONOMY_VERIFICATION_RUNTIME_ENABLED';
const ENGINE=Object.freeze({id:'arcy-verification-runtime',version:1});
const SCHEMA_VERSION=1;
const LEDGER=Object.freeze({opTimeoutMs:1500,concurrency:4,minRewriteMs:60000,throttleEntries:4096});
const S=evidence.STATES,F=freshness.STATES;
const ADDRESS=/^0x[0-9a-f]{40}$/i,BLOCK_HEX=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const fail=code=>Object.assign(Error(code),{code});
const enabled=(env=process.env)=>env[FLAG]==='1';
const isoMs=ms=>new Date(ms).toISOString();
const found=f=>f&&f.dataState==='DATA_FOUND'&&f.value!==null&&f.value!==undefined;

// ---- value encoding (MetricEvidence accepts integers, canonical decimals, lowercase slugs and 0x-hex only) ----
function expand(text){
 // Expand a JS number string (possibly in exponent form) into a plain decimal without trailing zeros.
 const m=/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);if(!m)return null;
 // The decimal point position is computed from the ORIGINAL digit string; leading zeros are trimmed only afterwards.
 const sign=m[1],digits=m[2]+(m[3]||''),exp=Number(m[4]||0),point=m[2].length+exp;
 let int,frac;
 if(point<=0){int='0';frac='0'.repeat(-point)+digits;}
 else if(point>=digits.length){int=digits+'0'.repeat(point-digits.length);frac='';}
 else{int=digits.slice(0,point);frac=digits.slice(point);}
 int=int.replace(/^0+(?=\d)/,'');frac=frac.replace(/0+$/,'');
 // The evidence contract allows 36 fractional digits. A longer value is refused, never silently truncated.
 if(frac.length>36)return null;
 const out=(int==='0'&&!frac?'':sign)+int+(frac?'.'+frac:'');
 return out==='-0'?'0':out;
}
function decimal(value){
 if(typeof value==='number'){
  if(!Number.isFinite(value))return null;
  if(Object.is(value,-0))return '0';
  // String(number) is the shortest representation that round-trips to the same double: the provider's value exactly.
  return expand(String(value));
 }
 if(typeof value==='string'&&/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value))return expand(value);
 return null;
}
function encode(value,unit){
 if(unit==='address'){const a=String(value).toLowerCase();return ADDRESS.test(a)?a:null;}
 if(unit==='text-sha256')return '0x'+crypto.createHash('sha256').update(String(value)).digest('hex');
 if(unit==='token-base-units')return typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value)?value:null;
 if(unit==='count'){const d=decimal(value);return d!==null&&/^(0|[1-9][0-9]*)$/.test(d)?d:null;}
 return decimal(value);
}
// Exact share of burn custody in percent, 18 decimal places, as a canonical decimal.
function exactPercent(part,total){
 const p=BigInt(part),t=BigInt(total);if(t<=0n||p<0n||p>t)return null;
 const scaled=(p*100n*10n**18n+t/2n)/t,int=scaled/10n**18n,frac=(scaled%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');
 return int.toString()+(frac?'.'+frac:'');
}
function units(raw,decimals){return require('../../search/server/lib/eth').units(BigInt(raw),decimals);}

// ---- MetricEvidence construction (always validated by the strict parser; a rejected record fails closed) ----
function record(ctx,metric,{state,reasonCode,value=null,unit,observedAt=null,block=null,source=null,observations=[],disagreement=null}){
 const present=value!==null;
 const doc={schemaVersion:evidence.SCHEMA_VERSION,metricId:metric.metricId,network:ctx.network,token:ctx.token,scope:null,
  value:present?value:null,unit:unit||metric.unit,observedAt:present?observedAt:null,generatedAt:ctx.generatedAt,
  block:present?block:null,source:present?source:null,state,reasonCode,
  dataAgeMs:present?Date.parse(ctx.generatedAt)-Date.parse(observedAt):null,observations,disagreement,engine:{...ENGINE}};
 try{return evidence.parseMetricEvidence(doc);}
 catch{
  return evidence.parseMetricEvidence({...doc,value:null,observedAt:null,block:null,source:null,dataAgeMs:null,observations:[],disagreement:null,
   state:S.NOT_VERIFIED,reasonCode:'EVIDENCE_CONTRACT_REJECTED'});
 }
}
function observation(ctx,metric,{source,value,unit,observedAt,block,method,reference=null}){
 return {source:{id:source.id,class:source.class,operator:source.operator},value,unit:unit||metric.unit,token:ctx.token,scope:null,
  observedAt,block,chainId:ctx.chainId,provenance:{method,reference}};
}
// Never later than generatedAt (the contract requires observedAt <= generatedAt); never earlier than the source said.
const clampTime=(ms,ctx)=>isoMs(Math.min(ms,Date.parse(ctx.generatedAt)));

// ---- on-chain metrics re-read by two operators -------------------------------------------------------------
function readingOf(metric,r){
 if(!r)return null;
 if(metric.read==='totalSupply')return r.totalSupply??null;
 if(metric.read==='burnBalance')return r.burnBalance??null;
 if(metric.read==='nonBurnSupply')return r.totalSupply!==undefined&&r.burnBalance!==undefined&&BigInt(r.burnBalance)<=BigInt(r.totalSupply)?(BigInt(r.totalSupply)-BigInt(r.burnBalance)).toString():null;
 if(metric.read==='burnPct')return r.totalSupply!==undefined&&r.burnBalance!==undefined?exactPercent(r.burnBalance,r.totalSupply):null;
 if(metric.read==='owner')return r.owner??null;
 if(metric.read==='implementation')return r.implementation??null;
 return null;
}
const OWNER_TEXT=/^owner\(\) getter: (0x[0-9a-fA-F]{40})\b/,IMPLEMENTATION_TEXT=/^EIP-1967 implementation: (0x[0-9a-fA-F]{40})\b/;
// What the user sees must equal what the operators read; otherwise the displayed value is not what was verified.
function displayCheck(metric,field,value,primary){
 if(!found(field))return {matches:null,basis:'FIELD_NOT_DISPLAYED'};
 if(value===null)return {matches:null,basis:'NO_REFERENCE_READING'};
 if(['totalSupply','burnBalance','nonBurnSupply'].includes(metric.read)){
  if(!Number.isInteger(primary?.decimals))return {matches:null,basis:'DECIMALS_UNAVAILABLE'};
  const expected=units(value,primary.decimals);
  const ok=typeof field.value==='number'?Number(expected)===field.value:String(field.value)===expected;
  return {matches:ok,basis:'units(raw, decimals) equals the displayed value',expected};
 }
 if(metric.read==='burnPct'){const ok=typeof field.value==='number'&&Math.abs(field.value-Number(value))<=1e-9;return {matches:ok,basis:'displayed percent within 1e-9 of the exact 18-decimal share'};}
 const m=(metric.read==='owner'?OWNER_TEXT:IMPLEMENTATION_TEXT).exec(String(field.value));
 if(!m)return {matches:null,basis:metric.read==='owner'?'DISPLAYED_VALUE_IS_NOT_AN_OWNER_GETTER':'DISPLAYED_VALUE_IS_NOT_AN_EIP1967_SLOT'};
 return {matches:m[1].toLowerCase()===value,basis:'displayed address equals the same-block read'};
}
function onchainMetric(ctx,metric,field){
 const obs=ctx.observation;
 if(!obs)return {evidence:record(ctx,metric,{state:S.UNAVAILABLE,reasonCode:ctx.observationFailure||'ONCHAIN_OBSERVATION_UNAVAILABLE'}),freshness:null,consensus:null,display:{matches:null,basis:'NO_OBSERVATION'}};
 const usable=obs.endpoints.filter(e=>e.readings?.header&&readingOf(metric,e.readings)!==null);
 const primary=obs.endpoints.find(e=>e.role==='primary');
 const reference=usable[0]||null,refValue=reference?readingOf(metric,reference.readings):null;
 const display=displayCheck(metric,field,refValue,reference?.readings);
 const head=primary?.readings?.head?{number:primary.readings.head}:null;
 const fresh=reference?freshness.assess({policy:metric.policy,now:ctx.now,block:{number:obs.block.number,timestamp:reference.readings.header.timestamp},head}):null;
 const result=extra=>({freshness:fresh,display,providers:obs.endpoints.map(e=>({role:e.role,operator:e.operator,state:e.state,reasonCode:e.reasonCode||null})),...extra});
 if(!found(field))return result({evidence:record(ctx,metric,{state:field?.dataState==='SOURCE_API_FAILED'?S.UNAVAILABLE:S.NOT_VERIFIED,reasonCode:'FIELD_NOT_DISPLAYED'}),consensus:null});
 if(!reference){
  const why=obs.endpoints.map(e=>e.errors&&Object.values(e.errors)[0]||e.reasonCode).find(Boolean)||'NO_USABLE_ONCHAIN_READING';
  return result({evidence:record(ctx,metric,{state:S.UNAVAILABLE,reasonCode:/^[A-Z][A-Z0-9_]{0,63}$/.test(why)?why:'NO_USABLE_ONCHAIN_READING'}),consensus:null});
 }
 const unit=metric.unit,rows=usable.map(e=>{
  const value=encode(readingOf(metric,e.readings),unit),block={number:obs.block.number,hash:e.readings.header.hash};
  return {e,value,block,obs:observation(ctx,metric,{source:{id:(ctx.network+'-rpc-'+e.operator).slice(0,64),class:'ONCHAIN_RPC',operator:e.operator},value,unit,
   observedAt:clampTime(e.readings.header.timestamp*1000,ctx),block,method:metric.read.toLowerCase(),reference:ctx.token})};
 }).filter(r=>r.value!==null);
 if(!rows.length)return result({evidence:record(ctx,metric,{state:S.NOT_VERIFIED,reasonCode:'READING_NOT_ENCODABLE'}),consensus:null});
 const decision=consensus.evaluate(rows.map(r=>({source:{id:r.obs.source.id,operator:r.e.operator},value:r.value,unit,scope:null,observedAt:r.obs.observedAt,block:r.block})),consensus.PRESETS.EXACT_ONCHAIN);
 const single=(reasonCode,row=rows[0])=>record(ctx,metric,{state:S.SINGLE_SOURCE,reasonCode,value:row.value,unit,observedAt:row.obs.observedAt,block:row.block,source:row.obs.source,observations:[row.obs]});
 let out;
 if(display.matches===false)out=record(ctx,metric,{state:S.NOT_VERIFIED,reasonCode:'DISPLAYED_VALUE_MISMATCH'});
 else if(fresh.state===F.STALE)out=record(ctx,metric,{state:S.STALE,reasonCode:fresh.reasonCode,observations:rows.map(r=>r.obs)});
 else if([F.INVALID_TIMESTAMP,F.FUTURE_TIMESTAMP,F.BLOCK_INCONSISTENT].includes(fresh.state))out=record(ctx,metric,{state:S.NOT_VERIFIED,reasonCode:fresh.reasonCode});
 else if(decision.state===consensus.STATES.CONFLICTING)
  out=record(ctx,metric,{state:S.CONFLICTING,reasonCode:decision.reasonCode,observations:rows.map(r=>r.obs),
   disagreement:{kind:decision.reasonCode==='BLOCK_HASH_MISMATCH'?'BLOCK_HASH_MISMATCH':'VALUE_MISMATCH',sources:rows.map(r=>r.obs.source.id)}});
 else if(decision.state===consensus.STATES.AGREED&&obs.independence.independent&&freshness.permitsTrust(fresh)&&display.matches===true)
  out=record(ctx,metric,{state:S.VERIFIED_ONCHAIN,reasonCode:'EXACT_ONCHAIN_AGREEMENT',value:rows[0].value,unit,observedAt:rows[0].obs.observedAt,block:rows[0].block,source:rows[0].obs.source,observations:rows.map(r=>r.obs)});
 else{
  const independent=obs.endpoints.find(e=>e.role==='independent');
  const reason=decision.state===consensus.STATES.AGREED&&!obs.independence.independent?'OPERATOR_INDEPENDENCE_UNVERIFIED':
   display.matches===null?'DISPLAY_NOT_COMPARABLE':!freshness.permitsTrust(fresh)?'FRESHNESS_NOT_ESTABLISHED':
   rows.length<2?(independent?(independent.state==='SKIPPED'?'INDEPENDENT_PROVIDER_COOLDOWN':'INDEPENDENT_READ_FAILED'):(obs.independence.reasonCode||'NO_INDEPENDENT_ENDPOINT')):
   decision.reasonCode;
  out=single(/^[A-Z][A-Z0-9_]{0,63}$/.test(reason||'')?reason:'NO_INDEPENDENT_CONFIRMATION');
 }
 return result({evidence:out,consensus:{state:decision.state,reasonCode:decision.reasonCode,policy:decision.policy,operators:decision.operators,
  values:rows.map(r=>({operator:r.e.operator,value:r.value,blockHash:r.block.hash}))}});
}

// ---- market metrics: the existing licence-gated cross-check is reused; nothing new is requested -------------
function strictPolicy(metric){
 const preset=consensus.PRESETS[metric.preset];
 const key={'liquidity.liquidity_usd':'liquidityUsd','liquidity.volume_24h':'volume24h','activity.volume_24h':'volume24h','activity.price_usd':'priceUsd'}[metric.metricId];
 const existing=key?require('../../search/server/lib/market-cross').TOLERANCE[key]:undefined;
 // The stricter of the consensus preset and the cross-check tolerance already shipped to users.
 if(existing===undefined||existing>=preset.tolerance)return preset;
 return {...preset,id:preset.id+'.strict',tolerance:existing};
}
function marketMetric(ctx,metric,field){
 if(!found(field))return {evidence:record(ctx,metric,{state:field?.dataState==='SOURCE_API_FAILED'?S.UNAVAILABLE:S.NOT_VERIFIED,reasonCode:field?.reasonCode&&/^[A-Z][A-Z0-9_]{0,63}$/.test(field.reasonCode)?field.reasonCode:'FIELD_NOT_DISPLAYED'}),freshness:null,consensus:null};
 const unit=metric.unit,value=encode(field.value,unit);
 if(value===null)return {evidence:record(ctx,metric,{state:S.NOT_VERIFIED,reasonCode:'VALUE_NOT_ENCODABLE'}),freshness:null,consensus:null};
 const retrievedAt=field.freshness?.retrievedAt??null;
 // Providers used here publish no data timestamp; observedAt in the evidence is ARCY's retrieval time and the
 // freshness result says so (SOURCE_AGE_UNKNOWN).
 const fresh=freshness.assess({policy:metric.policy,now:ctx.now,retrievedAt,observedAt:null});
 const source=identity.fieldSource(field.source,ctx.network);
 const t=Number.isFinite(Date.parse(retrievedAt||''))?Date.parse(retrievedAt):null;
 if(t===null||fresh.state===F.FUTURE_TIMESTAMP||fresh.state===F.INVALID_TIMESTAMP||fresh.state===F.NOT_OBSERVED)
  return {evidence:record(ctx,metric,{state:S.NOT_VERIFIED,reasonCode:fresh.reasonCode||'NO_OBSERVATION_TIME'}),freshness:fresh,consensus:null};
 const primary=observation(ctx,metric,{source,value,unit,observedAt:clampTime(t,ctx),block:null,method:'provider-reported',reference:null});
 if(fresh.state===F.STALE)return {evidence:record(ctx,metric,{state:S.STALE,reasonCode:fresh.reasonCode,observations:[primary]}),freshness:fresh,consensus:null};
 let decision=null,second=null;
 const cc=field.crossCheck;
 if(metric.preset&&cc&&['AGREE','DISAGREE','SCOPE_MISMATCH'].includes(cc.state)&&cc.values&&Array.isArray(cc.providers)&&cc.providers.length===2){
  const otherLabel=cc.providers.find(p=>p!==field.source),otherValue=otherLabel!==undefined?encode(cc.values[otherLabel],unit):null;
  const otherSource=otherLabel!==undefined?identity.fieldSource(otherLabel,ctx.network):null,checked=Date.parse(cc.checkedAt||'');
  if(otherSource&&otherValue!==null&&Number.isFinite(checked)&&otherSource.operator!==source.operator){
   second=observation(ctx,metric,{source:otherSource,value:otherValue,unit,observedAt:clampTime(checked,ctx),block:null,method:'provider-reported',reference:null});
   // Pool coverage decides comparability: the cross-check already compared the providers' pool sets.
   const scopes=cc.state==='SCOPE_MISMATCH'?['pools-primary','pools-secondary']:['pools-same','pools-same'];
   decision=consensus.evaluate([{source:{id:primary.source.id,operator:source.operator},value,unit,scope:scopes[0],observedAt:primary.observedAt,block:null},
    {source:{id:second.source.id,operator:otherSource.operator},value:otherValue,unit,scope:scopes[1],observedAt:second.observedAt,block:null}],strictPolicy(metric));
  }
 }
 const view=decision?{state:decision.state,reasonCode:decision.reasonCode,policy:decision.policy,operators:decision.operators,maxDifference:decision.maxDifference??null,
  values:[{operator:source.operator,value},{operator:second.source.operator,value:second.value}]}:
  {state:'NOT_RUN',reasonCode:metric.preset?(cc?.reasonCode||'MARKET_CROSSCHECK_NOT_ENABLED'):'NO_CROSSCHECK_FOR_METRIC'};
 let out;
 if(decision?.state===consensus.STATES.CONFLICTING)
  out=record(ctx,metric,{state:S.CONFLICTING,reasonCode:'MARKET_VALUES_DISAGREE',observations:[primary,second],disagreement:{kind:'VALUE_MISMATCH',sources:[primary.source.id,second.source.id]}});
 else if(decision?.state===consensus.STATES.AGREED&&decision.reasonCode==='EXACT_AGREEMENT'&&freshness.permitsTrust(fresh)&&primary.observedAt===second.observedAt)
  out=record(ctx,metric,{state:S.INDEPENDENTLY_CROSS_CHECKED,reasonCode:'INDEPENDENT_AGREEMENT',value,unit,observedAt:primary.observedAt,block:null,source:primary.source,observations:[primary,second]});
 else{
  const reason=decision?.state===consensus.STATES.AGREED?'WITHIN_TOLERANCE_NOT_EXACT':decision?.state===consensus.STATES.NOT_COMPARABLE?(decision.reasonCode==='SCOPE_MISMATCH'?'POOL_COVERAGE_MISMATCH':decision.reasonCode):
   fresh.state!==F.FRESH?'SOURCE_AGE_UNKNOWN':'NO_INDEPENDENT_SOURCE';
  out=record(ctx,metric,{state:S.SINGLE_SOURCE,reasonCode:reason,value,unit,observedAt:primary.observedAt,block:null,source:primary.source,observations:[primary]});
 }
 return {evidence:out,freshness:fresh,consensus:view};
}

// ---- everything else: single-source by construction, with freshness and an honest reason ---------------------
const SINGLE_REASON=Object.freeze({INDEXER:'INDEXER_ENUMERATION_SINGLE_OPERATOR',SOURCE_ANALYSIS:'SOURCE_ANALYSIS_SINGLE_ENGINE',
 MARKET_DERIVED:'DERIVED_FROM_MARKET_INPUT',MARKET:'NO_INDEPENDENT_SOURCE',ONCHAIN:'NOT_INDEPENDENTLY_CHECKABLE',ONCHAIN_DERIVED:'NOT_INDEPENDENTLY_CHECKABLE'});
function anchorOf(ctx,field){
 const proof=Array.isArray(field.evidence)?field.evidence[0]:null;
 const hex=[field.snapshot?.block,proof?.block].find(b=>typeof b==='string'&&BLOCK_HEX.test(b))||null;
 if(!hex)return null;
 const header=ctx.primaryHeader,same=hex.toLowerCase()===ctx.blockHex;
 const hash=[proof?.anchor,field.snapshot?.blockHash].find(h=>typeof h==='string'&&/^0x[0-9a-f]{64}$/i.test(h))?.toLowerCase()||(same&&header?header.hash:null);
 const timestampMs=same&&header?header.timestamp*1000:Number.isFinite(Date.parse(field.snapshot?.blockTime||''))?Date.parse(field.snapshot.blockTime):null;
 return {number:BigInt(hex).toString(),hash,timestampMs};
}
function singleMetric(ctx,metric,field){
 if(!found(field))return {evidence:record(ctx,metric,{state:field?.dataState==='SOURCE_API_FAILED'?S.UNAVAILABLE:S.NOT_VERIFIED,reasonCode:field?.reasonCode&&/^[A-Z][A-Z0-9_]{0,63}$/.test(field.reasonCode)?field.reasonCode:'FIELD_NOT_DISPLAYED'}),freshness:null,consensus:null};
 // Numeric metrics keep their unit; any textual display value (e.g. "Buy 3% · Sell 3%") is attested by its SHA-256.
 const numeric=decimal(field.value)!==null;
 const unit=['count','percent','usd','ratio','token-base-units'].includes(metric.unit)&&numeric?metric.unit:'text-sha256';
 const value=encode(field.value,unit),source=identity.fieldSource(field.source,ctx.network),anchor=anchorOf(ctx,field);
 const policyBasis=freshness.policy(metric.policy).basis;
 // Market-derived values inherit the retrieval time of the field (or the price field) they were derived from.
 const retrievedAt=field.freshness?.retrievedAt??ctx.cards?.activity?.fields?.priceUsd?.freshness?.retrievedAt??null;
 const fresh=policyBasis==='BLOCK_TIMESTAMP'?
  freshness.assess({policy:metric.policy,now:ctx.now,block:anchor?{number:anchor.number,...(anchor.timestampMs!==null?{timestampMs:anchor.timestampMs}:{})}:null,head:ctx.head}):
  freshness.assess({policy:metric.policy,now:ctx.now,retrievedAt,observedAt:null});
 if(value===null)return {evidence:record(ctx,metric,{state:S.NOT_VERIFIED,reasonCode:'VALUE_NOT_ENCODABLE'}),freshness:fresh,consensus:null};
 if([F.INVALID_TIMESTAMP,F.FUTURE_TIMESTAMP,F.BLOCK_INCONSISTENT].includes(fresh.state))return {evidence:record(ctx,metric,{state:S.NOT_VERIFIED,reasonCode:fresh.reasonCode}),freshness:fresh,consensus:null};
 const block=anchor&&anchor.hash?{number:anchor.number,hash:anchor.hash}:null;
 // An RPC-class source needs a block anchor with a hash under the contract; without one the value cannot be anchored.
 if(source.class==='ONCHAIN_RPC'&&!block)return {evidence:record(ctx,metric,{state:S.NOT_VERIFIED,reasonCode:'BLOCK_ANCHOR_UNVERIFIED'}),freshness:fresh,consensus:null};
 const observedMs=anchor?.timestampMs??(Number.isFinite(Date.parse(retrievedAt||''))?Date.parse(retrievedAt):Date.parse(ctx.scannedAt||'')||Date.parse(ctx.generatedAt));
 const row=observation(ctx,metric,{source,value,unit,observedAt:clampTime(observedMs,ctx),block,method:metric.kind.toLowerCase().replace(/_/g,'-'),reference:null});
 if(fresh.state===F.STALE)return {evidence:record(ctx,metric,{state:S.STALE,reasonCode:fresh.reasonCode,observations:[row]}),freshness:fresh,consensus:null};
 return {evidence:record(ctx,metric,{state:S.SINGLE_SOURCE,reasonCode:SINGLE_REASON[metric.kind]||'NO_INDEPENDENT_SOURCE',value,unit,observedAt:row.observedAt,block,source:row.source,observations:[row]}),
  freshness:fresh,consensus:{state:'NOT_RUN',reasonCode:SINGLE_REASON[metric.kind]||'NO_INDEPENDENT_SOURCE'}};
}

// ---- change detection against the durable ledger ----------------------------------------------------------
function changeOf(previous,current){
 if(!previous)return {kind:'FIRST_OBSERVATION'};
 const last=previous.lastTrusted,prior=previous.current,trusted=evidence.isTrustedEvidence;
 if(current.state===S.CONFLICTING)return {kind:'PROVIDER_DISAGREEMENT',lastTrustedValue:last?.value??null};
 if(trusted(current)){
  if(!last)return {kind:'FIRST_TRUSTED_OBSERVATION'};
  if(last.value!==current.value||last.unit!==current.unit)
   return {kind:'VALUE_CHANGED',from:last.value,to:current.value,fromBlock:last.block?.number??null,toBlock:current.block?.number??null,lastTrustedAt:last.observedAt};
  if(prior&&!trusted(prior))return {kind:'COVERAGE_RESTORED'};
  return {kind:'UNCHANGED'};
 }
 if(current.state===S.SINGLE_SOURCE){
  if(prior&&trusted(prior))return {kind:prior.value===current.value?'COVERAGE_REDUCED':'UNVERIFIED_VALUE_CHANGE'};
  if(prior?.state===S.SINGLE_SOURCE){
   if(prior.value!==current.value)return {kind:'UNVERIFIED_VALUE_CHANGE'};
   const ops=e=>[...new Set(e.observations.map(o=>o.source.operator))].sort().join(',');
   return {kind:ops(prior)!==ops(current)?'SOURCE_COVERAGE_CHANGED':'UNCHANGED'};
  }
  return {kind:'UNVERIFIED_OBSERVATION'};
 }
 // STALE / UNAVAILABLE / NOT_VERIFIED / UNSUPPORTED: no current reading. History is not a change.
 return {kind:last?'NO_CURRENT_TRUSTED_READING':'NO_CURRENT_READING',lastTrustedAt:last?.observedAt??null};
}
function historyOf(previous,generatedAt){
 const last=previous?.lastTrusted;
 if(!last)return null;
 // Explicitly historical: the value, when it was observed and how long ago. Never presented as current.
 return {historical:true,value:last.value,unit:last.unit,state:last.state,observedAt:last.observedAt,block:last.block,
  ageMs:Math.max(0,Date.parse(generatedAt)-Date.parse(last.observedAt))};
}
const throttle=new Map();
function withTimeout(promise,ms){let timer;return Promise.race([promise,new Promise((_,r)=>{timer=setTimeout(()=>r(fail('EVIDENCE_LEDGER_TIMEOUT')),ms);})]).finally(()=>clearTimeout(timer));}
async function pool(items,limit,work){const out=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await work(items[i]);}}));return out;}
async function ledgerPass(ctx,rows,{env,ledger=evidenceLedger}){
 try{ledger.directory(env);}catch(e){
  for(const r of rows){r.change={kind:'HISTORY_UNAVAILABLE'};r.history=null;}
  return {state:'UNAVAILABLE',reasonCode:e.code||'EVIDENCE_LEDGER_STORAGE_UNCONFIGURED',history:'NOT_PRESERVED',written:0};
 }
 let written=0,throttled=0;const errors={};
 await pool(rows,LEDGER.concurrency,async r=>{
  const id={metricId:r.evidence.metricId,network:r.evidence.network,token:r.evidence.token,scope:null};
  let previous=null;
  try{previous=await withTimeout(ledger.read(id,{env}),LEDGER.opTimeoutMs);}
  catch(e){r.change={kind:'HISTORY_UNAVAILABLE',reasonCode:e.code||'EVIDENCE_LEDGER_READ_FAILED'};r.history=null;r.ledger={state:'READ_FAILED',reasonCode:e.code||'EVIDENCE_LEDGER_READ_FAILED'};errors[r.ledger.reasonCode]=(errors[r.ledger.reasonCode]||0)+1;return;}
  r.change=changeOf(previous,r.evidence);r.history=historyOf(previous,ctx.generatedAt);
  const key=evidenceLedger.keyFor(id),last=throttle.get(key),sig=r.evidence.state+'|'+r.evidence.reasonCode+'|'+r.evidence.value;
  // Bounded write rate: an unchanged reading is rewritten at most once per minute per metric per process.
  if(last&&last.sig===sig&&ctx.now-last.at<LEDGER.minRewriteMs){throttled++;r.ledger={state:'THROTTLED',reasonCode:null};return;}
  try{
   const saved=await withTimeout(ledger.record(r.evidence,{env}),LEDGER.opTimeoutMs);
   written++;r.ledger={state:'RECORDED',reasonCode:null,revision:saved.revision};
   throttle.set(key,{sig,at:ctx.now});if(throttle.size>LEDGER.throttleEntries)throttle.delete(throttle.keys().next().value);
  }catch(e){
   const code=e.code||'EVIDENCE_LEDGER_WRITE_FAILED';
   r.ledger={state:code==='EVIDENCE_LEDGER_REGRESSION'||code==='EVIDENCE_LEDGER_TIME_CONFLICT'?'OUT_OF_ORDER_REJECTED':'WRITE_FAILED',reasonCode:code};
   errors[code]=(errors[code]||0)+1;
  }
 });
 const failed=Object.values(errors).reduce((a,b)=>a+b,0);
 return {state:failed?(written?'PARTIAL':'FAILED'):'RECORDED',reasonCode:failed?Object.keys(errors)[0]:null,history:failed&&!written?'NOT_PRESERVED':'PRESERVED',written,throttled,errors};
}

// ---- entry point -----------------------------------------------------------------------------------------
async function verify(report,{network=report?.network,env=process.env,fetcher=fetch,now=Date.now,observe=observer.observe,ledger}={}){
 const cfg=chain(network),started=now();
 if(!report||typeof report!=='object'||!report.cards||!ADDRESS.test(report.address||'')||!BLOCK_HEX.test(report.block||''))throw fail('VERIFICATION_REPORT_INVALID');
 const token=report.address.toLowerCase(),blockHex=report.block.toLowerCase();
 const ctx={network:cfg.id,chainId:cfg.chainId,token,blockHex,now:started,generatedAt:isoMs(started),scannedAt:report.scannedAt,cards:report.cards};
 const mechanics=report.cards.mechanics?.fields||{};
 const wants={owner:found(mechanics.ownerAdmin)&&OWNER_TEXT.test(String(mechanics.ownerAdmin.value)),
  implementation:found(mechanics.contractArchitecture)&&IMPLEMENTATION_TEXT.test(String(mechanics.contractArchitecture.value))};
 try{ctx.observation=await observe({network:cfg.id,address:token,block:blockHex,wants,env,fetcher,now});}
 catch(e){ctx.observation=null;ctx.observationFailure=/^[A-Z][A-Z0-9_]{0,63}$/.test(e?.code||'')?e.code:'ONCHAIN_OBSERVATION_FAILED';}
 const primary=ctx.observation?.endpoints.find(e=>e.role==='primary');
 ctx.primaryHeader=primary?.readings?.header||ctx.observation?.endpoints.find(e=>e.readings?.header)?.readings.header||null;
 ctx.head=primary?.readings?.head?{number:primary.readings.head}:null;
 const rows=catalog.ENTRIES.map(metric=>{
  const field=report.cards[metric.card]?.fields?.[metric.field];
  const built=metric.verification==='INDEPENDENT_RPC_SAME_BLOCK'&&(metric.read!=='owner'||wants.owner)&&(metric.read!=='implementation'||wants.implementation)?onchainMetric(ctx,metric,field):
   metric.kind==='MARKET'&&metric.preset?marketMetric(ctx,metric,field):singleMetric(ctx,metric,field);
  return {card:metric.card,field:metric.field,kind:metric.kind,verificationPath:metric.verification,...built};
 });
 const ledgerResult=await ledgerPass(ctx,rows,{env,ledger:ledger||evidenceLedger});
 const summary={};for(const s of Object.keys(S))summary[s]=0;
 const metrics={};
 for(const r of rows){
  summary[r.evidence.state]++;
  metrics[r.evidence.metricId]={card:r.card,field:r.field,kind:r.kind,verificationPath:r.verificationPath,
   state:r.evidence.state,reasonCode:r.evidence.reasonCode,verified:evidence.isTrustedEvidence(r.evidence),
   evidence:r.evidence,freshness:r.freshness,consensus:r.consensus,...(r.display?{display:r.display}:{}),...(r.providers?{providers:r.providers}:{}),
   change:r.change,history:r.history,...(r.ledger?{ledger:r.ledger}:{})};
 }
 const obs=ctx.observation;
 return {schemaVersion:SCHEMA_VERSION,engine:{...ENGINE},state:'COMPLETE',generatedAt:ctx.generatedAt,network:cfg.id,chainId:cfg.chainId,token,
  block:{hex:blockHex,number:BigInt(blockHex).toString(),hash:ctx.primaryHeader?.hash??null,timestamp:ctx.primaryHeader?isoMs(ctx.primaryHeader.timestamp*1000):null},
  independence:obs?.independence??{independent:false,reasonCode:ctx.observationFailure},
  providers:(obs?.endpoints||[]).map(e=>({role:e.role,providerId:e.providerId,operator:e.operator,operatorBasis:e.operatorBasis,operatorReference:e.operatorReference,
   state:e.state,reasonCode:e.reasonCode||null,watchdogState:e.watchdogState,rpcCalls:e.cost.rpcCalls,ms:e.cost.ms})),
  healthPersistence:obs?.healthPersistence??null,
  budget:{rpcCalls:obs?.cost.rpcCalls??0,observerMs:obs?.cost.ms??null,deadlineMs:obs?.cost.deadlineMs??null,totalMs:now()-started},
  ledger:ledgerResult,summary,verifiedCount:summary.VERIFIED_ONCHAIN+summary.INDEPENDENTLY_CROSS_CHECKED,metricCount:rows.length,metrics,
  notes:['Additive verification view: the cards above are unchanged.','Only VERIFIED_ONCHAIN and INDEPENDENTLY_CROSS_CHECKED are verified; SINGLE_SOURCE values are displayed but unconfirmed.',
   'history.* is a past trusted observation, never a current reading.']};
}
// Called from the Search report builder. OFF => untouched report. Any failure => an explicit FAILED sidecar.
async function annotateIfEnabled(report,options={}){
 const env=options.env||process.env;
 if(!enabled(env)||!report||typeof report!=='object')return report;
 try{report.verification=await verify(report,{...options,env});}
 catch(e){report.verification={schemaVersion:SCHEMA_VERSION,engine:{...ENGINE},state:'FAILED',reasonCode:/^[A-Z][A-Z0-9_]{0,63}$/.test(e?.code||'')?e.code:'VERIFICATION_RUNTIME_FAILED',
  generatedAt:new Date().toISOString(),metrics:{},notes:['Verification did not run for this report; no value below is affected.']};}
 return report;
}
module.exports={FLAG,ENGINE,LEDGER,enabled,verify,annotateIfEnabled,changeOf,decimal,encode,exactPercent,_resetThrottle:()=>throttle.clear()};
