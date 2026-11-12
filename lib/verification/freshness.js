'use strict';
// Stale Detection Engine: metric-level freshness for ARCY verification.
//
// Freshness is a property of ONE current observation. It is never computed from a ledger's lastTrusted record,
// and an HTTP 200 response says nothing about how old the underlying data is.
//
// Ages are measured against the best available clock for the data class:
//   BLOCK_TIMESTAMP   chain state: age of the pinned block (block header timestamp), not of the HTTP response
//   SOURCE_TIMESTAMP  provider data: the provider's own observation/publication time. When a provider supplies none,
//                     the result is SOURCE_AGE_UNKNOWN — a recent retrieval is reported, but it is NOT called fresh
//   EVENT_TIME        scheduled/historical events: a past event is HISTORICAL (a fact about the past, never "current");
//                     a future event is only as current as the source review that listed it
//
// States (machine-readable):
//   FRESH                age is known and within the policy
//   STALE                age is known and exceeds the policy (or the retrieval itself is too old)
//   SOURCE_AGE_UNKNOWN   no trustworthy source/block time; the value may be recent but its age cannot be shown
//   HISTORICAL           a past event: correct as history, not a current reading
//   FUTURE_TIMESTAMP     a timestamp lies beyond now + allowed clock skew
//   INVALID_TIMESTAMP    a timestamp is malformed, before the policy's epoch, or ordered impossibly
//   BLOCK_INCONSISTENT   the block anchor contradicts the observed head (ahead of head, time order broken)
//   NOT_OBSERVED         there is no current observation at all
const SCHEMA_VERSION=1;
const STATES=Object.freeze({FRESH:'FRESH',STALE:'STALE',SOURCE_AGE_UNKNOWN:'SOURCE_AGE_UNKNOWN',HISTORICAL:'HISTORICAL',
 FUTURE_TIMESTAMP:'FUTURE_TIMESTAMP',INVALID_TIMESTAMP:'INVALID_TIMESTAMP',BLOCK_INCONSISTENT:'BLOCK_INCONSISTENT',NOT_OBSERVED:'NOT_OBSERVED'});
const MIN=60*1000,HOUR=60*MIN,DAY=24*HOUR;
// Earliest plausible timestamp for any supported network (Ethereum genesis, 2015-07-30). Anything earlier is invalid.
const EPOCH_MS=Date.parse('2015-07-30T00:00:00.000Z');
const CLOCK_SKEW_MS=60*1000;

// Documented policies. Each limit is a product decision about how old a value may be and still be presented as
// current for that data class; docs/VERIFICATION_RUNTIME.md explains each one.
const POLICIES=Object.freeze({
 'onchain-state':Object.freeze({id:'onchain-state',dataClass:'ONCHAIN_STATE',basis:'BLOCK_TIMESTAMP',maxAgeMs:15*MIN,
  note:'Supply, burn-address custody, owner() and implementation slot read at the analysis block. A report built on a block older than 15 minutes is not current chain state.'}),
 'contract-mechanics':Object.freeze({id:'contract-mechanics',dataClass:'CONTRACT_MECHANICS',basis:'BLOCK_TIMESTAMP',maxAgeMs:6*HOUR,
  note:'Capabilities derived from bytecode/source and role reads. Code changes only through upgrades or role changes, so a 6-hour-old anchored analysis is still current; an unanchored one has unknown age.'}),
 'holder-snapshot':Object.freeze({id:'holder-snapshot',dataClass:'HOLDER_STATISTICS',basis:'BLOCK_TIMESTAMP',maxAgeMs:24*HOUR,
  note:'Holder enumeration is rebuilt by the durable worker; 24 hours matches the existing evidence-class limit. The age is that of the pinned block, not of the snapshot file.'}),
 'market-price':Object.freeze({id:'market-price',dataClass:'MARKET_PRICE',basis:'SOURCE_TIMESTAMP',maxAgeMs:5*MIN,retrievalMaxAgeMs:2*MIN,
  note:'Spot price moves continuously. A provider-timestamped price older than 5 minutes is stale; a response retrieved more than 2 minutes ago is stale even when the provider gives no timestamp.'}),
 'market-change':Object.freeze({id:'market-change',dataClass:'MARKET_PRICE',basis:'SOURCE_TIMESTAMP',maxAgeMs:5*MIN,retrievalMaxAgeMs:2*MIN,
  note:'A 24-hour change is a function of the current price and inherits the price policy.'}),
 'market-liquidity':Object.freeze({id:'market-liquidity',dataClass:'MARKET_LIQUIDITY',basis:'SOURCE_TIMESTAMP',maxAgeMs:15*MIN,retrievalMaxAgeMs:5*MIN,
  note:'Pool reserves change per swap; aggregated USD liquidity older than 15 minutes is stale.'}),
 'market-volume':Object.freeze({id:'market-volume',dataClass:'MARKET_VOLUME',basis:'SOURCE_TIMESTAMP',maxAgeMs:60*MIN,retrievalMaxAgeMs:15*MIN,
  note:'A rolling 24-hour window moves slowly at the edges; one hour of source age is tolerated.'}),
 'market-derived':Object.freeze({id:'market-derived',dataClass:'MARKET_DERIVED',basis:'SOURCE_TIMESTAMP',maxAgeMs:5*MIN,retrievalMaxAgeMs:2*MIN,
  note:'Market cap / FDV / turnover inherit the strictest policy of their market inputs (price).'}),
 'unlock-event':Object.freeze({id:'unlock-event',dataClass:'UNLOCK_EVENT',basis:'EVENT_TIME',maxReviewAgeMs:7*DAY,
  note:'A past unlock is HISTORICAL. A future unlock is only as current as the source review that listed it (7 days).'})
});

const fail=code=>Object.assign(Error(code),{code});
function policy(id){
 if(typeof id!=='string'||!Object.hasOwn(POLICIES,id))throw fail('FRESHNESS_UNKNOWN_POLICY');
 return POLICIES[id];
}
// Accepts an ISO-8601 string with an explicit zone, or epoch milliseconds. Returns {ms} or {invalid:true}.
function time(value){
 if(value===null||value===undefined)return null;
 let ms;
 if(typeof value==='number')ms=value;
 else if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))ms=Date.parse(value);
 else return {invalid:true};
 if(!Number.isFinite(ms))return {invalid:true};
 return {ms};
}
function blockAnchor(block){
 if(block===null||block===undefined)return null;
 const number=typeof block.number==='string'&&/^(0|[1-9][0-9]*)$/.test(block.number)?BigInt(block.number):
  typeof block.number==='string'&&/^0x[0-9a-f]+$/i.test(block.number)?BigInt(block.number):
  Number.isSafeInteger(block.number)&&block.number>=0?BigInt(block.number):null;
 // Block timestamps are seconds on every supported chain; milliseconds are accepted only from callers that already converted.
 const t=block.timestampMs!==undefined?time(block.timestampMs):Number.isSafeInteger(block.timestamp)?time(block.timestamp*1000):
  typeof block.timestamp==='string'&&/^0x[0-9a-f]+$/i.test(block.timestamp)?time(Number(BigInt(block.timestamp))*1000):null;
 return {number,time:t};
}
function result(p,state,reasonCode,extra={}){
 return {schemaVersion:SCHEMA_VERSION,policy:p.id,dataClass:p.dataClass,basis:p.basis,state,reasonCode,
  ageMs:null,maxAgeMs:p.maxAgeMs??null,checkedAt:null,...extra};
}
// assess({policy, now, observedAt, retrievedAt, block, head, eventAt, reviewedAt})
//   observedAt   provider's own observation/publication time (null when the provider gives none)
//   retrievedAt  when ARCY received the response
//   block        {number, timestamp|timestampMs} anchor of the value
//   head         {number, timestamp|timestampMs} chain head observed during the same check (optional)
//   eventAt / reviewedAt   for EVENT_TIME policies
function assess(input={}){
 const p=policy(input.policy);
 if(!Number.isFinite(input.now))throw fail('FRESHNESS_CLOCK_REQUIRED');
 const now=input.now,checkedAt=new Date(now).toISOString(),done=(state,reasonCode,extra)=>({...result(p,state,reasonCode,extra),checkedAt});
 const observed=time(input.observedAt),retrieved=time(input.retrievedAt);
 for(const [name,t] of [['observedAt',observed],['retrievedAt',retrieved]]){
  if(t?.invalid)return done(STATES.INVALID_TIMESTAMP,'MALFORMED_'+name.toUpperCase());
  if(t&&t.ms<EPOCH_MS)return done(STATES.INVALID_TIMESTAMP,name.toUpperCase()+'_BEFORE_EPOCH');
  if(t&&t.ms>now+CLOCK_SKEW_MS)return done(STATES.FUTURE_TIMESTAMP,name.toUpperCase()+'_IN_FUTURE',{skewMs:t.ms-now});
 }
 // A provider cannot have observed a value after ARCY already received it.
 if(observed&&retrieved&&observed.ms>retrieved.ms+CLOCK_SKEW_MS)return done(STATES.INVALID_TIMESTAMP,'OBSERVED_AFTER_RETRIEVAL');

 if(p.basis==='EVENT_TIME'){
  const event=time(input.eventAt),review=time(input.reviewedAt);
  if(!event)return done(STATES.NOT_OBSERVED,'EVENT_TIME_MISSING');
  if(event.invalid||event.ms<EPOCH_MS)return done(STATES.INVALID_TIMESTAMP,'MALFORMED_EVENT_TIME');
  if(event.ms<=now)return done(STATES.HISTORICAL,'EVENT_IN_PAST',{ageMs:now-event.ms,eventAt:new Date(event.ms).toISOString()});
  if(!review)return done(STATES.SOURCE_AGE_UNKNOWN,'SOURCE_REVIEW_TIME_MISSING',{eventAt:new Date(event.ms).toISOString()});
  if(review.invalid)return done(STATES.INVALID_TIMESTAMP,'MALFORMED_REVIEW_TIME');
  if(review.ms>now+CLOCK_SKEW_MS)return done(STATES.FUTURE_TIMESTAMP,'REVIEW_TIME_IN_FUTURE');
  const age=now-review.ms;
  return age>p.maxReviewAgeMs?done(STATES.STALE,'SOURCE_REVIEW_TOO_OLD',{ageMs:age,maxAgeMs:p.maxReviewAgeMs}):
   done(STATES.FRESH,null,{ageMs:age,maxAgeMs:p.maxReviewAgeMs,eventAt:new Date(event.ms).toISOString()});
 }

 if(p.basis==='BLOCK_TIMESTAMP'){
  const block=blockAnchor(input.block),head=blockAnchor(input.head);
  if(!block||block.number===null)return done(input.block?STATES.INVALID_TIMESTAMP:STATES.SOURCE_AGE_UNKNOWN,input.block?'MALFORMED_BLOCK_ANCHOR':'BLOCK_ANCHOR_MISSING');
  if(block.time?.invalid)return done(STATES.INVALID_TIMESTAMP,'MALFORMED_BLOCK_TIMESTAMP');
  if(head&&head.number!==null){
   if(block.number>head.number)return done(STATES.BLOCK_INCONSISTENT,'BLOCK_AHEAD_OF_HEAD',{blockLag:Number(block.number-head.number)});
   if(block.time&&head.time&&!head.time.invalid&&block.number<head.number&&block.time.ms>head.time.ms)return done(STATES.BLOCK_INCONSISTENT,'BLOCK_TIME_ORDER_BROKEN');
  }
  if(!block.time)return done(STATES.SOURCE_AGE_UNKNOWN,'BLOCK_TIMESTAMP_UNAVAILABLE',{blockLag:head&&head.number!==null?Number(head.number-block.number):null});
  if(block.time.ms<EPOCH_MS)return done(STATES.INVALID_TIMESTAMP,'BLOCK_TIMESTAMP_BEFORE_EPOCH');
  if(block.time.ms>now+CLOCK_SKEW_MS)return done(STATES.FUTURE_TIMESTAMP,'BLOCK_TIMESTAMP_IN_FUTURE',{skewMs:block.time.ms-now});
  const age=Math.max(0,now-block.time.ms),extra={ageMs:age,blockTime:new Date(block.time.ms).toISOString(),blockLag:head&&head.number!==null?Number(head.number-block.number):null};
  return age>p.maxAgeMs?done(STATES.STALE,'BLOCK_OLDER_THAN_POLICY',extra):done(STATES.FRESH,null,extra);
 }

 // SOURCE_TIMESTAMP
 const retrievalAge=retrieved?Math.max(0,now-retrieved.ms):null;
 if(retrieved&&p.retrievalMaxAgeMs!==undefined&&retrievalAge>p.retrievalMaxAgeMs)
  return done(STATES.STALE,'RETRIEVAL_OLDER_THAN_POLICY',{ageMs:observed?Math.max(0,now-observed.ms):null,retrievalAgeMs:retrievalAge,retrievalMaxAgeMs:p.retrievalMaxAgeMs});
 if(!observed){
  if(!retrieved)return done(STATES.NOT_OBSERVED,'NO_OBSERVATION_TIME');
  // Retrieval is recent, but the provider did not say how old its data is. That is not freshness.
  return done(STATES.SOURCE_AGE_UNKNOWN,'PROVIDER_TIMESTAMP_UNAVAILABLE',{retrievalAgeMs:retrievalAge,retrievalMaxAgeMs:p.retrievalMaxAgeMs??null});
 }
 const age=Math.max(0,now-observed.ms);
 return age>p.maxAgeMs?done(STATES.STALE,'SOURCE_OLDER_THAN_POLICY',{ageMs:age,retrievalAgeMs:retrievalAge}):
  done(STATES.FRESH,null,{ageMs:age,retrievalAgeMs:retrievalAge});
}
// Combining inputs (derived metrics): the result is only as fresh as its weakest input.
const RANK=[STATES.FRESH,STATES.HISTORICAL,STATES.SOURCE_AGE_UNKNOWN,STATES.STALE,STATES.NOT_OBSERVED,STATES.BLOCK_INCONSISTENT,STATES.FUTURE_TIMESTAMP,STATES.INVALID_TIMESTAMP];
function weakest(list){
 const rows=list.filter(Boolean);
 if(!rows.length)return null;
 return rows.reduce((a,b)=>RANK.indexOf(b.state)>RANK.indexOf(a.state)?b:a);
}
// Only FRESH may contribute to a trusted (VERIFIED) evidence state.
const permitsTrust=f=>f?.state===STATES.FRESH;
module.exports={SCHEMA_VERSION,STATES,POLICIES,CLOCK_SKEW_MS,EPOCH_MS,policy,assess,weakest,permitsTrust};
