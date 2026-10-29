'use strict';
// Issue #95 — incremental indexer + signed snapshot path (Railway), fail-closed API reads.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const onchain=require('../lib/market-radar-onchain');
const indexer=require('../lib/market-radar-indexer');
const storage=require('../lib/market-radar-storage');
const snapshot=require('../lib/market-radar-snapshot');
const {makeChain,usdcPool,tokenMeta}=require('./radar-helpers');

const keys=()=>{const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');return {priv:privateKey.export({type:'pkcs8',format:'pem'}),pub:publicKey.export({type:'spki',format:'pem'})};};
function withStore(fn){
 return async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-'));const k=keys(),saved={...process.env};
  Object.assign(process.env,{ARC_RADAR_DIR:dir,ARC_RADAR_SIGNING_KEY:k.priv,ARC_RADAR_PUBLIC_KEY:k.pub,ARC_RADAR_MIN_INTERVAL_MS:'0'});
  try{await fn({dir,keys:k});}
  finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);fs.rmSync(dir,{recursive:true,force:true});}
 };
}
const counting=(inner)=>{const log={ranges:[],logCalls:0};
 const f=async(url,init)=>{const req=JSON.parse(init.body);
  if(req.method==='eth_getLogs'&&String(req.params[0].topics?.[0]).toLowerCase()===onchain.SWAP_TOPIC){log.logCalls++;log.ranges.push([Number(BigInt(req.params[0].fromBlock)),Number(BigInt(req.params[0].toBlock))]);}
  return inner(url,init);};
 return {f,log};};
const pools=()=>Array.from({length:6},(_,k)=>usdcPool(k+1,(7-k)*1000,{block0:999000-k*500}));

test('indexer bootstraps the full 24h window, publishes a verifiable snapshot equal to a direct scan',withStore(async()=>{
 const chain=makeChain('ethereum',{pools:pools(),tokens:tokenMeta(6),head:1000000});
 const r=await indexer.run('ethereum',{fetcher:chain,budgetMs:60000});
 assert.equal(r.status,'published');assert.ok(r.windowSeconds>=86400);
 const snap=await snapshot.load('ethereum',{store:storage,now:Date.now()});
 assert.equal(snap.servedFrom,'signed-snapshot');assert.equal(snap.tokens.length,6);
 const direct=await onchain.inspect('ethereum',{fetcher:chain});
 assert.deepEqual(snap.tokens.map(t=>[t.address,t.rank]),direct.tokens.map(t=>[t.address,t.rank]));
 snap.tokens.forEach((t,i)=>{assert.ok(Math.abs(t.volume24hUsd-direct.tokens[i].volume24hUsd)<0.001);assert.equal(t.swaps24h,direct.tokens[i].swaps24h);});
 const state=await storage.readState('ethereum');
 for(let i=1;i<state.segments.length;i++)assert.equal(state.segments[i].from,state.segments[i-1].to+1);
}));

test('second run is incremental: only new blocks are fetched',withStore(async()=>{
 const first=makeChain('ethereum',{pools:pools(),tokens:tokenMeta(6),head:1000000});
 await indexer.run('ethereum',{fetcher:first,budgetMs:60000});
 const more=pools();more.push(usdcPool(7,50000,{block0:1000050}));
 const c=counting(makeChain('ethereum',{pools:more,tokens:tokenMeta(7),head:1000100}));
 const r=await indexer.run('ethereum',{fetcher:c.f,budgetMs:60000});
 assert.equal(r.status,'published');
 const scanned=c.log.ranges.reduce((n,[a,b])=>n+(b-a+1),0);
 assert.ok(scanned<=140,'rescanned '+scanned+' blocks');
 assert.ok(Math.min(...c.log.ranges.map(x=>x[0]))>=1000000-12,'must not rescan old blocks');
 const snap=await snapshot.load('ethereum',{store:storage,now:Date.now()});
 assert.equal(snap.tokens[0].address,'0x'+(7).toString(16).padStart(40,'0'));
}));

test('no snapshot is published while the window is not covered (bootstrapping)',withStore(async()=>{
 const chain=makeChain('ethereum',{pools:pools(),tokens:tokenMeta(6)});
 const r=await indexer.run('ethereum',{fetcher:chain,budgetMs:1});
 assert.ok(['catching_up','bootstrapping'].includes(r.status));
 assert.equal(await storage.envelopeOf('ethereum'),null);
 await assert.rejects(snapshot.load('ethereum',{store:storage}),e=>e.code==='RADAR_SNAPSHOT_MISSING'||e.code==='RADAR_SNAPSHOT_UNVERIFIED');
}));

test('coverage() rejects gaps and uncovered windows',()=>{
 const seg=(from,to,fromTs,toTs)=>({from,to,fromTs,toTs});
 assert.equal(indexer.coverage([],1000).ok,false);
 assert.equal(indexer.coverage([seg(0,9,100000,100300),seg(11,20,100300,100600)],200000).reason,'gap between segments');
 assert.equal(indexer.coverage([seg(0,9,150000,150300)],200000).reason,'window not yet covered');
 assert.equal(indexer.coverage([seg(0,9,100000,100300)],200000).ok,true);
});

test('wrong chain id aborts the indexer and records a failure audit',withStore(async()=>{
 const chain=makeChain('ethereum',{pools:pools(),tokens:tokenMeta(6),chainId:5});
 await assert.rejects(indexer.run('ethereum',{fetcher:chain}),e=>e.code==='RADAR_RPC_CHAIN_MISMATCH');
 const audit=await storage.readAudit('ethereum');
 assert.equal(audit.lastFailure.code,'RADAR_RPC_CHAIN_MISMATCH');
 assert.equal(await storage.envelopeOf('ethereum'),null);
}));

const goodSnap=(over={})=>{const headTs=Math.floor(Date.now()/1000)-30;
 return {ok:true,network:'arc',chainId:5042,tokens:[{address:'0x'+'a'.repeat(40),symbol:'AAA',volume24hUsd:10}],
  snapshot:{version:1,network:'arc',chainId:5042,headTimestamp:headTs,windowSeconds:86500},...over};};
const sign=(k,payload)=>({payload:JSON.stringify(payload),signature:crypto.sign(null,Buffer.from(JSON.stringify(payload)),k.priv).toString('base64')});

test('snapshot reader is fail-closed: signature, tamper, stale, chain, window, rows',withStore(async({keys:k})=>{
 const ok=await snapshot.load('arc',{store:{envelopeOf:async()=>sign(k,goodSnap())},key:k.pub});
 assert.equal(ok.tokens.length,1);
 const code=async(env,key=k.pub)=>{try{await snapshot.load('arc',{store:{envelopeOf:async()=>env},key});return 'OK';}catch(e){return e.code;}};
 const env=sign(k,goodSnap());
 assert.equal(await code({...env,payload:env.payload.replace('AAA','BBB')}),'RADAR_SNAPSHOT_UNVERIFIED');
 assert.equal(await code({payload:env.payload}),'RADAR_SNAPSHOT_UNVERIFIED');
 assert.equal(await code(env,keys().pub),'RADAR_SNAPSHOT_UNVERIFIED');
 assert.equal(await code(sign(k,goodSnap({snapshot:{...goodSnap().snapshot,headTimestamp:Math.floor(Date.now()/1000)-7200}}))),'RADAR_SNAPSHOT_STALE');
 assert.equal(await code(sign(k,goodSnap({chainId:1}))),'RADAR_SNAPSHOT_CHAIN_MISMATCH');
 assert.equal(await code(sign(k,goodSnap({snapshot:{...goodSnap().snapshot,windowSeconds:3600}}))),'RADAR_SNAPSHOT_WINDOW_SHORT');
 assert.equal(await code(sign(k,goodSnap({tokens:[{address:'0x'+'a'.repeat(40),symbol:'A',volume24hUsd:0}]}))),'RADAR_SNAPSHOT_INVALID');
 assert.equal(await code(sign(k,goodSnap({tokens:Array.from({length:11},(_,i)=>({address:'0x'+i.toString(16).padStart(40,'0'),symbol:'A',volume24hUsd:1}))}))),'RADAR_SNAPSHOT_INVALID');
 await assert.rejects(snapshot.load('arc',{store:{envelopeOf:async()=>env},key:null}),e=>e.code==='RADAR_SNAPSHOT_UNVERIFIED');
}));

test('API serves a stale snapshot as 503 RADAR_SNAPSHOT_STALE (never old rankings) and a fresh one as 200',withStore(async({keys:k})=>{
 const handler=require('../search/server/api/radar');
 const call=async(env,snap)=>{
  const saved=global.fetch;process.env.MARKET_RADAR_ONCHAIN_ENABLED='true';process.env.MARKET_RADAR_SOURCE='snapshot';
  process.env.ARC_RADAR_PUBLISHED_URL='https://worker.example';process.env.VERCEL_ENV='production';
  global.fetch=async()=>({ok:true,status:200,json:async()=>sign(k,snap)});
  const res={headers:{},setHeader(a,b){this.headers[a]=b;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
  try{await handler({method:'GET',query:{chain:'arc'}},res);}finally{global.fetch=saved;delete process.env.MARKET_RADAR_SOURCE;}
  return res;};
 const fresh=await call({},goodSnap());
 assert.equal(fresh.code,200);assert.equal(fresh.body.servedFrom,'signed-snapshot');assert.equal(fresh.body.diagnostics,undefined);
 const stale=await call({},goodSnap({snapshot:{...goodSnap().snapshot,headTimestamp:Math.floor(Date.now()/1000)-9000}}));
 assert.equal(stale.code,503);assert.equal(stale.body.reasonCode,'RADAR_SNAPSHOT_STALE');assert.equal(stale.body.tokens,undefined);
}));

test('pools unknown to PositionManager resolve through the verified Initialize registry and publish',withStore(async()=>{
 process.env.RADAR_INIT_FROM_ETHEREUM='990000';
 const ps=pools().map((p,i)=>({...p,initBlock:995000+i}));
 const brokenKeys=new Set(ps.map(p=>'x'));
 const chain=makeChain('ethereum',{pools:ps,tokens:tokenMeta(6),brokenKeys:new Set()});
 // PositionManager knows none of them
 const noPm=async(url,init)=>{const r=JSON.parse(init.body);if(r.method==='eth_call'&&r.params[0].data.startsWith(onchain.SEL.poolKeys))return {ok:true,json:async()=>({id:r.id,result:'0x'})};return chain(url,init);};
 const r=await indexer.run('ethereum',{fetcher:noPm,budgetMs:60000});
 assert.equal(r.status,'published');assert.equal(r.registry.complete,true);assert.equal(r.registry.keys,6);
 const snap=await snapshot.load('ethereum',{store:storage,now:Date.now()});
 assert.equal(snap.tokens.length,6);assert.equal(snap.coverage.keySources.registry,6);assert.equal(snap.coverage.swapsResolvedShare,1);
 void brokenKeys;
}));

test('without any pool-key source the indexer refuses to publish a thin ranking',withStore(async()=>{
 process.env.RADAR_INIT_FROM_ETHEREUM='999990';
 const chain=makeChain('ethereum',{pools:pools(),tokens:tokenMeta(6)});
 const noPm=async(url,init)=>{const r=JSON.parse(init.body);if(r.method==='eth_call'&&r.params[0].data.startsWith(onchain.SEL.poolKeys))return {ok:true,json:async()=>({id:r.id,result:'0x'})};return chain(url,init);};
 const r=await indexer.run('ethereum',{fetcher:noPm,budgetMs:60000});
 assert.equal(r.status,'registry_backfilling');assert.equal(await storage.envelopeOf('ethereum'),null);
}));

test('published snapshot carries source/freshness/coverage proofs and the pacer state is persisted',withStore(async({keys:k})=>{
 process.env.RADAR_INIT_FROM_ETHEREUM='999000';
 const ps=pools().map((p,i)=>({...p,initBlock:999100+i}));
 const chain=makeChain('ethereum',{pools:ps,tokens:tokenMeta(6)});
 const r=await indexer.run('ethereum',{fetcher:chain,budgetMs:60000});
 assert.equal(r.status,'published');
 const snap=await snapshot.load('ethereum',{store:storage,now:Date.now()});
 const i=snap.snapshot.integrity;
 assert.equal(i.segmentsContiguous,true);assert.ok(i.segmentsFrom<=i.segmentsTo);assert.equal(i.rpcChainId,1);
 assert.match(i.sourceContract,/^0x[0-9a-f]{40}$/);assert.equal(i.registry.complete,true);assert.match(i.publicKeyFingerprint||'',/^[0-9a-f]{16}$/);
 assert.ok(snap.snapshot.headTime&&snap.window.seconds>=86400&&snap.coverage.swapsResolvedShare>=0.85);
 const state=await storage.readState('ethereum');assert.equal(typeof state.paceMs,'number');
 void k;
}));

test('holder worker protection: the Radar loop is inert unless explicitly enabled and never throws into the worker',()=>{
 const http=require('../lib/market-radar-http');
 const saved=process.env.ARC_RADAR_INDEXER_ENABLED;delete process.env.ARC_RADAR_INDEXER_ENABLED;
 try{assert.equal(http.startLoop(),null);assert.equal(http.matches({url:'/pulse/networks/latest'}),false);assert.equal(http.matches({url:'/snapshots/0x1.json'}),false);assert.equal(http.matches({url:'/radar/status'}),true);}
 finally{if(saved!==undefined)process.env.ARC_RADAR_INDEXER_ENABLED=saved;}
});
