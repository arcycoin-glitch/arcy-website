'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const f=require('../lib/verification/freshness');
const NOW=Date.parse('2026-11-12T12:00:00.000Z'),S=1000,MIN=60*S,H=60*MIN;
const iso=ms=>new Date(ms).toISOString();
const sec=ms=>Math.floor(ms/1000);

test('every policy is documented, has a known basis and distinct limits per data class',()=>{
 const ids=Object.keys(f.POLICIES);
 for(const id of ['onchain-state','contract-mechanics','holder-snapshot','market-price','market-liquidity','market-volume','market-change','market-derived','unlock-event'])assert.ok(ids.includes(id),id);
 for(const p of Object.values(f.POLICIES)){assert.ok(['BLOCK_TIMESTAMP','SOURCE_TIMESTAMP','EVENT_TIME'].includes(p.basis));assert.ok(p.note.length>40);}
 // Not one TTL for everything.
 const limits=new Set(Object.values(f.POLICIES).map(p=>p.maxAgeMs??p.maxReviewAgeMs));
 assert.ok(limits.size>=5);
 assert.throws(()=>f.assess({policy:'nope',now:NOW}),/FRESHNESS_UNKNOWN_POLICY/);
 assert.throws(()=>f.assess({policy:'market-price'}),/FRESHNESS_CLOCK_REQUIRED/);
});

test('on-chain state: fresh and stale are decided by the pinned block timestamp, not by retrieval',()=>{
 const fresh=f.assess({policy:'onchain-state',now:NOW,retrievedAt:iso(NOW),block:{number:'100',timestamp:sec(NOW-2*MIN)},head:{number:'101',timestamp:sec(NOW-MIN)}});
 assert.equal(fresh.state,'FRESH');assert.equal(fresh.ageMs,2*MIN);assert.equal(fresh.blockLag,1);
 // Retrieved just now, but the block is old: stale.
 const stale=f.assess({policy:'onchain-state',now:NOW,retrievedAt:iso(NOW),block:{number:'100',timestamp:sec(NOW-16*MIN)}});
 assert.equal(stale.state,'STALE');assert.equal(stale.reasonCode,'BLOCK_OLDER_THAN_POLICY');
 // Hex block numbers / timestamps are accepted.
 assert.equal(f.assess({policy:'onchain-state',now:NOW,block:{number:'0x64',timestamp:'0x'+sec(NOW).toString(16)}}).state,'FRESH');
 // Same age, different policy: mechanics tolerate more than supply.
 assert.equal(f.assess({policy:'contract-mechanics',now:NOW,block:{number:'1',timestamp:sec(NOW-16*MIN)}}).state,'FRESH');
 assert.equal(f.assess({policy:'holder-snapshot',now:NOW,block:{number:'1',timestamp:sec(NOW-25*H)}}).state,'STALE');
});

test('block anchors: missing timestamp is unknown age; ahead-of-head and broken ordering are inconsistent',()=>{
 assert.deepEqual([f.assess({policy:'onchain-state',now:NOW,block:{number:'5'}}).state,f.assess({policy:'onchain-state',now:NOW,block:{number:'5'}}).reasonCode],['SOURCE_AGE_UNKNOWN','BLOCK_TIMESTAMP_UNAVAILABLE']);
 assert.equal(f.assess({policy:'onchain-state',now:NOW,block:null}).reasonCode,'BLOCK_ANCHOR_MISSING');
 assert.equal(f.assess({policy:'onchain-state',now:NOW,block:{number:'abc'}}).state,'INVALID_TIMESTAMP');
 const ahead=f.assess({policy:'onchain-state',now:NOW,block:{number:'200',timestamp:sec(NOW)},head:{number:'150',timestamp:sec(NOW)}});
 assert.equal(ahead.state,'BLOCK_INCONSISTENT');assert.equal(ahead.reasonCode,'BLOCK_AHEAD_OF_HEAD');
 const order=f.assess({policy:'onchain-state',now:NOW,block:{number:'100',timestamp:sec(NOW-MIN)},head:{number:'101',timestamp:sec(NOW-5*MIN)}});
 assert.equal(order.reasonCode,'BLOCK_TIME_ORDER_BROKEN');
 assert.equal(f.assess({policy:'onchain-state',now:NOW,block:{number:'1',timestamp:sec(NOW+5*MIN)}}).state,'FUTURE_TIMESTAMP');
 assert.equal(f.assess({policy:'onchain-state',now:NOW,block:{number:'1',timestamp:1000}}).reasonCode,'BLOCK_TIMESTAMP_BEFORE_EPOCH');
});

test('market data: a recent HTTP response without a provider timestamp is SOURCE_AGE_UNKNOWN, never FRESH',()=>{
 const unknown=f.assess({policy:'market-price',now:NOW,retrievedAt:iso(NOW-10*S),observedAt:null});
 assert.equal(unknown.state,'SOURCE_AGE_UNKNOWN');assert.equal(unknown.reasonCode,'PROVIDER_TIMESTAMP_UNAVAILABLE');assert.equal(unknown.retrievalAgeMs,10*S);
 assert.equal(f.permitsTrust(unknown),false);
 const fresh=f.assess({policy:'market-price',now:NOW,retrievedAt:iso(NOW-10*S),observedAt:iso(NOW-60*S)});
 assert.equal(fresh.state,'FRESH');assert.equal(f.permitsTrust(fresh),true);
 assert.equal(f.assess({policy:'market-price',now:NOW,retrievedAt:iso(NOW-10*S),observedAt:iso(NOW-6*MIN)}).reasonCode,'SOURCE_OLDER_THAN_POLICY');
 // An old cached response is stale even when the provider gave no timestamp.
 assert.equal(f.assess({policy:'market-price',now:NOW,retrievedAt:iso(NOW-3*MIN)}).reasonCode,'RETRIEVAL_OLDER_THAN_POLICY');
 // Volume tolerates more source age than price.
 assert.equal(f.assess({policy:'market-volume',now:NOW,retrievedAt:iso(NOW),observedAt:iso(NOW-30*MIN)}).state,'FRESH');
 assert.equal(f.assess({policy:'market-price',now:NOW}).state,'NOT_OBSERVED');
});

test('timestamps: malformed, zone-less, future and impossibly ordered inputs are rejected explicitly',()=>{
 assert.equal(f.assess({policy:'market-price',now:NOW,retrievedAt:'yesterday'}).reasonCode,'MALFORMED_RETRIEVEDAT');
 assert.equal(f.assess({policy:'market-price',now:NOW,retrievedAt:'2026-11-12T11:59:00'}).state,'INVALID_TIMESTAMP'); // no zone
 assert.equal(f.assess({policy:'market-price',now:NOW,retrievedAt:iso(NOW),observedAt:iso(NOW+5*MIN)}).state,'FUTURE_TIMESTAMP');
 // Inside the documented clock skew: accepted.
 assert.equal(f.assess({policy:'market-price',now:NOW,retrievedAt:iso(NOW+30*S),observedAt:iso(NOW+20*S)}).state,'FRESH');
 // Exactly at the skew boundary is not "future"; it is still impossible ordering versus the retrieval time.
 assert.equal(f.assess({policy:'market-price',now:NOW,retrievedAt:iso(NOW-60*S),observedAt:iso(NOW+60*S)}).reasonCode,'OBSERVED_AFTER_RETRIEVAL');
 assert.equal(f.assess({policy:'market-price',now:NOW,retrievedAt:iso(NOW-60*S),observedAt:iso(NOW+3*MIN)}).state,'FUTURE_TIMESTAMP');
 assert.equal(f.assess({policy:'market-price',now:NOW,retrievedAt:iso(NOW-90*S),observedAt:iso(NOW-10*S)}).reasonCode,'OBSERVED_AFTER_RETRIEVAL');
 assert.equal(f.assess({policy:'market-price',now:NOW,retrievedAt:'1999-01-01T00:00:00.000Z'}).reasonCode,'RETRIEVEDAT_BEFORE_EPOCH');
 assert.equal(f.assess({policy:'market-price',now:NOW,retrievedAt:NaN}).state,'INVALID_TIMESTAMP');
});

test('unlock events: past events are HISTORICAL, future events are bounded by their source review age',()=>{
 const past=f.assess({policy:'unlock-event',now:NOW,eventAt:iso(NOW-3*24*H)});
 assert.equal(past.state,'HISTORICAL');assert.equal(f.permitsTrust(past),false);
 assert.equal(f.assess({policy:'unlock-event',now:NOW,eventAt:iso(NOW+24*H)}).reasonCode,'SOURCE_REVIEW_TIME_MISSING');
 assert.equal(f.assess({policy:'unlock-event',now:NOW,eventAt:iso(NOW+24*H),reviewedAt:iso(NOW-2*24*H)}).state,'FRESH');
 assert.equal(f.assess({policy:'unlock-event',now:NOW,eventAt:iso(NOW+24*H),reviewedAt:iso(NOW-8*24*H)}).reasonCode,'SOURCE_REVIEW_TOO_OLD');
 assert.equal(f.assess({policy:'unlock-event',now:NOW}).state,'NOT_OBSERVED');
});

test('weakest() lets a derived value be only as fresh as its worst input',()=>{
 const a=f.assess({policy:'onchain-state',now:NOW,block:{number:'1',timestamp:sec(NOW)}});
 const b=f.assess({policy:'market-price',now:NOW,retrievedAt:iso(NOW)});
 assert.equal(f.weakest([a,b]).state,'SOURCE_AGE_UNKNOWN');
 const c=f.assess({policy:'market-price',now:NOW,retrievedAt:iso(NOW),observedAt:iso(NOW+10*MIN)});
 assert.equal(f.weakest([a,b,c]).state,'FUTURE_TIMESTAMP');
 assert.equal(f.weakest([]),null);
});
