'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),age=require('../search/server/lib/block-age'),ec=require('../search/server/lib/evidence-class');
const NOW=Date.parse('2026-10-30T18:30:00Z');
const mk=()=>({network:'arc',block:'0x1b4b8c4',cards:{holders:{fields:{holderCount:{value:37,status:'SIGNED_ONCHAIN_SNAPSHOT',dataState:'DATA_FOUND',snapshot:{block:'0x17bf136',completedAt:'2026-10-29T22:09:36.801Z',freshness:'LAST_VERIFIED'}}}}}});
test('snapshot completion age and pinned-block age are reported separately; 22-day-old pin is STALE even though it completed 20 h ago',async()=>{
 age._reset();let calls=0;const rpc=async(m,p)=>{calls++;assert.equal(m,'eth_getBlockByNumber');assert.equal(p[0],'0x17bf136');return {timestamp:'0x'+Math.floor(Date.parse('2026-10-08T12:21:00Z')/1000).toString(16)};};
 const r=mk();await age.enrich(r,{rpc,now:NOW});ec.annotate(r,{now:NOW});
 const f=r.cards.holders.fields.holderCount;
 assert.equal(f.snapshot.completionAgeSeconds,Math.floor((NOW-Date.parse('2026-10-29T22:09:36.801Z'))/1000));
 assert.ok(f.snapshot.blockAgeSeconds>21*86400&&f.snapshot.blockAgeSeconds<23*86400);
 assert.equal(f.snapshot.blockAgeBasis,'RPC block timestamp of the pinned block');assert.equal(typeof f.snapshot.blockLag,'number');
 assert.equal(f.evidenceClass,'STALE');assert.equal(f.provenance.underlyingClass,'ON_CHAIN_VERIFIED');
 await age.enrich(mk(),{rpc,now:NOW});assert.equal(calls,1,'block timestamps are immutable and cached');
});
test('unreadable block timestamp never produces an estimated age',async()=>{
 age._reset();const r=mk();await age.enrich(r,{rpc:async()=>{throw Error('down');},now:NOW});
 const s=r.cards.holders.fields.holderCount.snapshot;assert.equal(s.blockAgeSeconds,null);assert.match(s.blockAgeBasis,/^UNKNOWN/);
 ec.annotate(r,{now:NOW});assert.equal(r.cards.holders.fields.holderCount.evidenceClass,'ON_CHAIN_VERIFIED','no age -> no staleness claim, but basis says unknown');
});
test('timeout is bounded',async()=>{age._reset();const t=Date.now();const r=mk();await age.enrich(r,{rpc:()=>new Promise(()=>{}),timeoutMs:50,now:NOW});assert.ok(Date.now()-t<500);assert.equal(r.cards.holders.fields.holderCount.snapshot.blockAgeSeconds,null);});
test('/api/holders payload carries block age next to completion age',async()=>{
 age._reset();const v={block:'0x17bf136',snapshot:{block:'0x17bf136',completedAt:'2026-10-29T22:09:36.801Z',freshness:'LAST_VERIFIED',ageSeconds:73149},fields:{holderCount:{value:37,snapshot:{block:'0x17bf136',completedAt:'2026-10-29T22:09:36.801Z'}}}};
 await age.enrichHolderValue(v,{rpc:async()=>({timestamp:'0x'+Math.floor(Date.parse('2026-10-08T12:21:00Z')/1000).toString(16)}),now:NOW});
 assert.equal(v.snapshot.ageSeconds,73149,'existing field untouched');assert.ok(v.snapshot.blockAgeSeconds>21*86400);assert.equal(v.snapshot.blockAgeBasis,'RPC block timestamp of the pinned block');
});

test('/api/holders is cache-only: no RPC, age filled once the Search path resolved the block',async()=>{
 age._reset();const v=()=>({block:'0x17bf136',snapshot:{block:'0x17bf136',completedAt:'2026-10-29T22:09:36.801Z'},fields:{holderCount:{value:37,snapshot:{block:'0x17bf136',completedAt:'2026-10-29T22:09:36.801Z'}}}});
 const a1=v();await age.enrichHolderValue(a1,{cacheOnly:true,now:NOW});assert.equal(a1.snapshot.blockAgeSeconds,null);assert.match(a1.snapshot.blockAgeBasis,/never makes RPC calls/);
 await age.blockTimeMs('arc','0x17bf136',{rpc:async()=>({timestamp:'0x'+Math.floor(Date.parse('2026-10-08T12:21:00Z')/1000).toString(16)})});
 const a2=v();await age.enrichHolderValue(a2,{cacheOnly:true,now:NOW});assert.ok(a2.snapshot.blockAgeSeconds>21*86400);
});
