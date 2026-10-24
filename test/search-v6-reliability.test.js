'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReader}=require('../search/server/lib/source-request');
const diagnostics=require('../search/server/lib/diagnostics');
test('V6 cached evidence is revalidated for every consumer',async()=>{
 const reader=createReader();let calls=0;const fetcher=async()=>{calls++;return Response.json({kind:'A'})};
 await reader.json('https://example.org/a',{fetcher,validate:x=>x.kind==='A'});
 await assert.rejects(reader.json('https://example.org/a',{fetcher,validate:x=>x.kind==='B'}),{code:'SOURCE_SCHEMA_INVALID'});assert.equal(calls,1);
});
test('V6 coalesced evidence cannot bypass a second consumer validator',async()=>{
 const reader=createReader();let finish;const fetcher=()=>new Promise(r=>finish=()=>r(Response.json({kind:'A'})));
 const first=reader.json('https://example.org/a',{fetcher,validate:x=>x.kind==='A'});
 const second=reader.json('https://example.org/a',{fetcher,validate:x=>x.kind==='B'});finish();await first;await assert.rejects(second,{code:'SOURCE_SCHEMA_INVALID'});
});
test('V6 transient breaker bounds repeated outages and recovers without stale promotion',async()=>{
 let now=1000,calls=0;const reader=createReader({now:()=>now}),fetcher=async()=>{calls++;return new Response(null,{status:503})};
 for(let i=0;i<3;i++)await assert.rejects(reader.json('https://example.org/a',{fetcher}),{httpStatus:503});
 await assert.rejects(reader.json('https://example.org/a',{fetcher}),{code:'SOURCE_CIRCUIT_OPEN'});assert.equal(calls,3);
 now+=30001;assert.deepEqual(await reader.json('https://example.org/a',{fetcher:async()=>Response.json({ok:true})}),{ok:true});
});
test('V6 forbidden source never retries into an apparent value',async()=>{
 let calls=0;const reader=createReader();await assert.rejects(reader.json('https://example.org/a',{fetcher:async()=>{calls++;return new Response(null,{status:403})}}),{httpStatus:403});assert.equal(calls,1);
});
test('V6 HTTP-date Retry-After pauses the exact provider, not an unrelated source',async()=>{
 let now=Date.parse('2026-10-19T00:00:00Z');const reader=createReader({now:()=>now});
 await assert.rejects(reader.json('https://example.org/a',{fetcher:async()=>new Response(null,{status:429,headers:{'retry-after':new Date(now+60000).toUTCString()}})}));
 await assert.rejects(reader.json('https://example.org/b'),{code:'SOURCE_RATE_LIMIT'});
 assert.deepEqual(await reader.json('https://other.example/a',{fetcher:async()=>Response.json({ok:true})}),{ok:true});
});
test('V6 source concurrency overload fails closed and capacity is released',async()=>{
 const reader=createReader(),finish=[];const fetcher=()=>new Promise(r=>finish.push(()=>r(Response.json({ok:true}))));
 const pending=Array.from({length:8},(_,i)=>reader.json('https://example.org/'+i,{fetcher}));
 await assert.rejects(reader.json('https://example.org/9',{fetcher}),{code:'SOURCE_CAPACITY_LIMIT'});finish.forEach(f=>f());await Promise.all(pending);
 assert.deepEqual(await reader.json('https://example.org/10',{fetcher:async()=>Response.json({ok:true})}),{ok:true});
});
test('V6 schema failures are not cached or counted as live successful evidence',async()=>{
 const reader=createReader();await assert.rejects(reader.json('https://example.org/a',{fetcher:async()=>Response.json({bad:true}),validate:()=>false}),{code:'SOURCE_SCHEMA_INVALID'});
 assert.deepEqual(await reader.json('https://example.org/a',{fetcher:async()=>Response.json({ok:true})}),{ok:true});
});
test('V6 diagnostics reject high-cardinality and sensitive labels',()=>{
 diagnostics.record('source','https://secret.example/key','ok');diagnostics.record('rpc','ethereum','ok',25);diagnostics.record('report','ethereum','ok',30,18);
 const data=diagnostics.snapshot();assert.ok(data.entries.some(r=>r.kind==='rpc'&&r.network==='ethereum'));assert.doesNotMatch(JSON.stringify(data),/secret|example|https|0x/);assert.ok(data.entries.length<=3*8*12);
});
test('V6 holder metadata rejects forged burn roles and unsorted shares',()=>{
 const {formatCard}=require('../search/server/lib/data-engine'),cfg={id:'ethereum',chainId:1};
 const field={value:10,dataState:'DATA_FOUND',chainId:1,network:'ethereum',source:'Fixture',evidence:[{block:'0x123'}]};
 const fields={largestWalletPct:field},row={address:'0x'+'a'.repeat(40),rank:1,sharePct:10,role:'BURN_ADDRESS',block:'0x123'};
 assert.equal(formatCard('holders',{fields,holderCandidates:[row]},cfg).holderCandidates,undefined);
 assert.equal(formatCard('holders',{fields,holderCandidates:[{...row,role:'UNKNOWN'},{...row,role:'UNKNOWN',rank:2,address:'0x'+'b'.repeat(40),sharePct:20}]},cfg).holderCandidates,undefined);
});
test('V6 practical notes preserve unverified authority, exit and burn distinctions',()=>{
 const {notes}=require('../search/server/lib/research-notes');assert.match(notes('supply',{}).join(' '),/do not establish an official buyback/);assert.match(notes('liquidity',{}).join(' '),/do not guarantee exit/);
 assert.match(notes('mechanics',{contractArchitecture:{dataState:'DATA_FOUND'}}).join(' '),/does not by itself prove who can upgrade/);
});
test('V6 evidence boundary rejects another contract or current block but preserves historical evidence',()=>{
 const {formatCard}=require('../search/server/lib/data-engine'),cfg={id:'ethereum',chainId:1},address='0x'+'a'.repeat(40),other='0x'+'b'.repeat(40),context={address,block:'0x100'};
 const f={value:10,dataState:'DATA_FOUND',chainId:1,network:'ethereum',source:'Fixture',status:'ON_CHAIN',evidence:[{address:other,block:'0x100'}]};
 assert.equal(formatCard('supply',{fields:{totalSupply:f}},cfg,context).fields.totalSupply.reasonCode,'SOURCE_CONTRACT_MISMATCH');
 f.evidence=[{address,block:'0x99'}];assert.equal(formatCard('supply',{fields:{totalSupply:f}},cfg,context).fields.totalSupply.reasonCode,'SOURCE_BLOCK_MISMATCH');
 f.status='HISTORICAL_ONCHAIN_VERIFIED';assert.equal(formatCard('supply',{fields:{totalSupply:f}},cfg,context).fields.totalSupply.value,10);
});
test('V6 public field failures never echo secret-bearing upstream exception messages',()=>{
 const f=require('../search/server/lib/evidence').error(Error('https://provider.example?api_key=SECRET'),'Provider');assert.doesNotMatch(JSON.stringify(f),/SECRET|api_key|https/);assert.equal(f.details,'unavailable');
});
test('V6 stricter size limit is enforced even on a previously cached source response',async()=>{
 const reader=createReader(),fetcher=async()=>Response.json({text:'a'.repeat(100)});await reader.json('https://example.org/a',{fetcher});await assert.rejects(reader.json('https://example.org/a',{fetcher,maxBytes:20}),{code:'SOURCE_SCHEMA_INVALID'});
});
test('V6 strict provider deadline does not join an unrelated longer pending deadline',async()=>{
 const reader=createReader(),done=[];let calls=0;const fetcher=()=>new Promise(r=>{calls++;done.push(()=>r(Response.json({ok:true})))});
 const a=reader.json('https://example.org/a',{fetcher,timeoutMs:2000}),b=reader.json('https://example.org/a',{fetcher,timeoutMs:1000});assert.equal(calls,2);done.forEach(f=>f());await Promise.all([a,b]);
});
test('V6 health exposes bounded diagnostics while refusing to claim worker liveness',()=>{
 let body;const res={setHeader(){},status(){return res},json(x){body=x;return x}};
 require('../search/server/api/health')({method:'GET'},res);assert.equal(body.holderWorker.state,'UNKNOWN');assert.ok(body.capabilities.includes('progress'));assert.ok(Array.isArray(body.operationalDiagnostics.entries));assert.doesNotMatch(JSON.stringify(body.operationalDiagnostics),/api_key|Authorization|Bearer|0x[0-9a-f]{40}/i);
});
for(const network of ['arc','robinhood'])test('V6 '+network+' RPC preserves HTTP failure category without disclosing provider URL',async()=>{
 const old=global.fetch;try{for(const status of [403,429]){
  global.fetch=async()=>new Response(null,{status});
  await assert.rejects(require('../search/server/lib/'+network+'-rpc').requestAt('https://private.example/SECRET','eth_chainId',[]),e=>e.httpStatus===status&&diagnostics.category(e)===(status===403?'forbidden':'rate_limit')&&!e.message.includes('SECRET'));
 }}finally{global.fetch=old}
});
