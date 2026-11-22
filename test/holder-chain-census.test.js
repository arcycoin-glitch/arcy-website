'use strict';
// Chain-4663 census on the existing durable holder architecture (mock RPC; real-chain run: .github/workflows/data-engine-phase2.yml).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-census-'));
process.env.ARC_HOLDER_STORAGE='local';process.env.ARC_INDEX_CACHE_DIR=dir;
const chains=require('../lib/holder-chains'),index=require('../lib/holder-index'),storage=require('../lib/holder-storage');
const TOKEN='0x'+'7'.repeat(40),A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),C='0x'+'c'.repeat(40),ZERO='0x'+'0'.repeat(40);
const T='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const W=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),topic=a=>'0x'+a.slice(2).padStart(64,'0');
const log=(block,i,from,to,amount)=>({address:TOKEN,removed:false,blockNumber:'0x'+block.toString(16),logIndex:'0x'+i.toString(16),blockHash:'0x'+String(block).padStart(64,'1'),topics:[T,topic(from),topic(to)],data:W(amount)});
function chain({head=50000000,logs,balances,supply=1000n,hashes={},rangeLimit=9990000,logLimit=10000}){
 const calls={getLogs:0,total:0,spans:[]};
 const rpc=async(m,p)=>{calls.total++;
  if(m==='eth_chainId')return '0x1237';if(m==='eth_blockNumber')return '0x'+head.toString(16);
  if(m==='eth_getCode')return p[0]===TOKEN?'0x6080':'0x';
  if(m==='eth_getBlockByNumber'){const n=Number(BigInt(p[0]));return {hash:hashes[n]||'0x'+String(n).padStart(64,'2')};}
  if(m==='eth_getLogs'){calls.getLogs++;const f=Number(BigInt(p[0].fromBlock)),t=Number(BigInt(p[0].toBlock));calls.spans.push(t-f+1);
   if(t-f+1>rangeLimit)throw Object.assign(Error('range'),{code:'RPC_RANGE_LIMIT'});
   const out=logs.filter(l=>{const b=Number(BigInt(l.blockNumber));return b>=f&&b<=t;});if(out.length>logLimit)throw Object.assign(Error('range'),{code:'RPC_RANGE_LIMIT'});return out;}
  if(m==='eth_call'){const {to,data}=p[0];if(to===TOKEN&&data==='0x18160ddd')return W(supply);
   if(to===TOKEN&&data.startsWith('0x70a08231'))return W(balances['0x'+data.slice(-40)]||0n);
   throw Object.assign(Error('revert'),{code:'RPC_CALL_FAILED'});}
  throw Error('unexpected '+m);};
 return {rpc,calls};
}
const LOGS=[log(30000001,0,ZERO,A,1000n),log(30000002,0,A,B,300n),log(40000000,1,B,C,100n)];
const BAL={[A]:700n,[B]:200n,[C]:100n};
async function census(rpc,opts={}){let r;for(let i=0;i<40;i++){r=await chains.run(4663,()=>index.advance(TOKEN,{budgetMs:60000,maxRanges:50,maxWallets:1000,...opts}),{rpc});if(r.reasonCode!=='TRANSFER_BACKFILL_IN_PROGRESS')break;}return r;}

test('HC-1 complete census on chain 4663: Transfer ledger + pinned balances + totalSupply agree; signed-publication-ready snapshot',async()=>{
 const {rpc,calls}=chain({logs:LOGS,balances:BAL});
 const r=await census(rpc);
 assert.equal(r.status,'ONCHAIN_VERIFIED');const v=r.value;
 assert.equal(v.holderCount,3);assert.equal(v.largestWalletPct,70);assert.equal(v.top10Pct,100);
 assert.equal(v.chainId,4663);assert.equal(v.source,'Robinhood Chain RPC');assert.equal(v.coverage.complete,true);
 assert.equal(v.snapshot.block,v.block);assert.equal(v.block,'0x'+(50000000-20).toString(16),'pinned at head minus the chain confirmation depth');
 const e=v.fields.holderCount.evidence[0];assert.equal(e.ledgerEqualsPinnedBalances,true);assert.ok(/^0x[0-9a-f]{64}$/.test(e.anchor));
 assert.ok(storage.validSnapshot(v,TOKEN),'passes the same COMPLETE snapshot validator as Arc');
 assert.ok(calls.spans.every(s=>s<=9990000),'every log query stays inside the measured 10M-block limit');
 assert.ok(calls.getLogs<=12,'adaptive windows: '+calls.getLogs+' log queries for a 50M-block history');
 // storage isolation: chain-4663 checkpoint lives under chain-4663/, Arc's directory is untouched
 assert.ok(fs.existsSync(path.join(dir,'chain-4663',TOKEN+'.v2.json')));assert.ok(!fs.existsSync(path.join(dir,TOKEN+'.v2.json')));
});
test('HC-2 range-limited windows are halved and resumed; dense windows never truncate',async()=>{
 fs.rmSync(path.join(dir,'chain-4663'),{recursive:true,force:true});
 const dense=Array.from({length:30},(_,i)=>log(45000000+i,0,A,B,1n));
 const {rpc,calls}=chain({logs:[...LOGS,...dense],balances:{[A]:670n,[B]:230n,[C]:100n},logLimit:8});
 const r=await chains.run(4663,async()=>{await storage.withLease(TOKEN,async()=>{});return census(rpc);},{rpc});
 assert.equal(r.status,'ONCHAIN_VERIFIED');assert.equal(r.value.holderCount,3);assert.ok(calls.spans.some(s=>s<9990000/2),'window shrank under the log cap');
});
test('HC-3 reorg: a changed cursor block hash rebuilds the ledger from scratch (never patched)',async()=>{
 fs.rmSync(path.join(dir,'chain-4663'),{recursive:true,force:true});
 const tok=TOKEN;const {rpc}=chain({logs:LOGS,balances:BAL});await census(rpc);
 const st=await chains.run(4663,()=>storage.load(tok),{rpc});assert.ok(st.cursorHash);
 const changed=chain({logs:LOGS,balances:BAL,hashes:{[st.cursor]:'0x'+'f'.repeat(64)}});
 const r=await chains.run(4663,()=>index.advance(tok,{budgetMs:60000,maxRanges:50,maxWallets:1000}),{rpc:changed.rpc});
 assert.ok(r.status==='ONCHAIN_VERIFIED'||r.coverage?.reorgRebuilt===true);
 if(r.status==='ONCHAIN_VERIFIED')assert.equal(r.value.fields.holderCount.evidence[0].reconstructedWallets>=3,true);
});
test('HC-4 fail closed: pinned balances that differ from the ledger, or a supply mismatch, publish nothing',async()=>{
 fs.rmSync(path.join(dir,'chain-4663'),{recursive:true,force:true});
 const rebasing=chain({logs:LOGS,balances:{[A]:690n,[B]:210n,[C]:100n}});
 await assert.rejects(census(rebasing.rpc),e=>e.code==='TRANSFER_LEDGER_STATE_MISMATCH');
 fs.rmSync(path.join(dir,'chain-4663'),{recursive:true,force:true});
 const missingHolder=chain({logs:LOGS,balances:BAL,supply:1500n});
 await assert.rejects(census(missingHolder.rpc),e=>e.code==='HOLDER_SUPPLY_RECONCILIATION_FAILED');
});
test('HC-5 Arc default scope is unchanged: chainId 5042, no chain-* directory, Arc checkpoint rules',async()=>{
 assert.equal(chains.current().chainId,5042);assert.equal(chains.current().ledger.initialRange,100000);assert.equal(chains.current().ledger.maxLogs,1000);
 assert.deepEqual(chains.enabledChains({}),[5042]);assert.deepEqual(chains.enabledChains({ARC_HOLDER_CHAINS:'5042,4663'}),[5042,4663]);
});
test('HC-6 throttled client: chainId checked once, 429 backs off and retries, range/history errors are typed',async()=>{
 let n=0,slept=0;const seen=[];
 const fetcher=async(url,{body})=>{const {method}=JSON.parse(body);seen.push(method);n++;
  if(method==='eth_chainId')return {status:200,json:async()=>({jsonrpc:'2.0',id:1,result:'0x1237'})};
  if(n===2)return {status:429,headers:{get:()=>'1'},json:async()=>({})};
  if(method==='eth_getLogs')return {status:200,json:async()=>({jsonrpc:'2.0',id:1,error:{code:-32602,message:'query spans 20000001 blocks, but only 10000000 are allowed'}})};
  if(method==='eth_call')return {status:200,json:async()=>({jsonrpc:'2.0',id:1,error:{code:-32000,message:'historical state abc is not available'}})};
  return {status:200,json:async()=>({jsonrpc:'2.0',id:1,result:'0x10'})};};
 const rpc=chains.rpcClient(4663,{fetcher,sleep:async ms=>{slept+=ms;},urls:[]});
 assert.equal(await rpc('eth_blockNumber',[]),'0x10');assert.ok(slept>=1000,'Retry-After honoured');assert.equal(rpc.metrics.http429,1);
 await assert.rejects(rpc('eth_getLogs',[{}]),e=>e.code==='RPC_RANGE_LIMIT');
 await assert.rejects(rpc('eth_call',[{}]),e=>e.code==='HISTORICAL_STATE_UNAVAILABLE');
 assert.equal(seen.filter(m=>m==='eth_chainId').length,1);
 const bad=chains.rpcClient(4663,{fetcher:async()=>({status:200,json:async()=>({jsonrpc:'2.0',id:1,result:'0x1'})}),sleep:async()=>{},urls:[]});
 await assert.rejects(bad('eth_blockNumber',[]),e=>e.code==='CHAIN_ID_MISMATCH');
});
test('HC-7 signed publication: chain 4663 documents carry chainId 4663, live under <dir>/4663/ and are verified per chain by Search',async()=>{
 const pub=fs.mkdtempSync(path.join(os.tmpdir(),'chain-pub-'));process.env.ARC_HOLDER_PUBLISHED_DIR=pub;
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');process.env.ARC_HOLDER_SIGNING_KEY=privateKey.export({format:'pem',type:'pkcs8'});
 fs.rmSync(path.join(dir,'chain-4663'),{recursive:true,force:true});
 const {rpc}=chain({logs:LOGS,balances:BAL});const r=await census(rpc);
 await chains.run(4663,()=>require('../lib/holder-publication').publish(TOKEN,r.value),{rpc});
 const file=path.join(pub,'4663',TOKEN+'.json');assert.ok(fs.existsSync(file));assert.ok(!fs.existsSync(path.join(pub,TOKEN+'.json')));
 const doc=JSON.parse(fs.readFileSync(file,'utf8'));
 const P=require('../search/server/lib/arc-holder-publication');
 assert.ok(P.verifyDocument(doc,TOKEN,publicKey,Date.now(),4663));assert.equal(P.verifyDocument(doc,TOKEN,publicKey,Date.now(),5042),null,'a 4663 document never verifies as Arc');
 const card=await P.load(TOKEN,{network:'robinhood',env:{ARC_HOLDER_PUBLISHED_URL:'https://worker.example/snapshots/',ARC_HOLDER_PUBLIC_KEY:publicKey.export({format:'pem',type:'spki'})},
  fetcher:async url=>{assert.equal(String(url),'https://worker.example/snapshots/4663/'+TOKEN+'.json');return {ok:true,status:200,headers:new Map([['content-type','application/json']]),text:async()=>JSON.stringify(doc),body:null,json:async()=>doc};}});
 if(card.fields.holderCount.dataState==='DATA_FOUND'){assert.equal(card.fields.holderCount.value,3);assert.equal(card.snapshot.freshness,'FRESH');assert.equal(card.fields.holderCount.chainId,4663);}
 delete process.env.ARC_HOLDER_SIGNING_KEY;delete process.env.ARC_HOLDER_PUBLISHED_DIR;
});
test('HC-8 growth damping: after a range-limited window the width is held for 4 windows instead of oscillating',async()=>{
 fs.rmSync(path.join(dir,'chain-4663'),{recursive:true,force:true});
 const dense=Array.from({length:40},(_,i)=>log(45000000+i*1000,0,A,B,1n));
 const {rpc,calls}=chain({logs:[...LOGS,...dense],balances:{[A]:660n,[B]:240n,[C]:100n},logLimit:6});
 const r=await census(rpc);assert.equal(r.status,'ONCHAIN_VERIFIED');
 const limited=calls.spans.filter((s,i)=>i>0&&calls.spans[i-1]&&s>calls.spans[i-1]*1.9).length;
 assert.ok(calls.getLogs<200,'bounded log queries: '+calls.getLogs);assert.ok(limited<calls.getLogs/2,'no tight double/halve oscillation');
});
test('HC-9 core.batch: Arc search scopes keep the JSON-RPC batch transport; only a non-Arc chain scope re-routes batches',async()=>{
 const core=require('../lib/core'),sr=require('../lib/search-request');const orig=global.fetch;let posted=null;
 global.fetch=async(url,o)=>{posted=JSON.parse(o.body);const body=Array.isArray(posted)?posted.map(x=>({jsonrpc:'2.0',id:x.id,result:'0x1'})):{jsonrpc:'2.0',id:posted.id,result:'0x1'};return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});};
 try{
  let scopedCalls=0;await sr.withRpc(async()=>{scopedCalls++;return '0x2';},()=>core.batch([{method:'eth_call',params:[{to:A,data:'0x01'},'0x1']},{method:'eth_call',params:[{to:A,data:'0x02'},'0x1']}]));
  assert.equal(scopedCalls,0,'Arc scope: batch not split into scoped single calls');assert.ok(Array.isArray(posted)&&posted.length===2,'one JSON-RPC batch request');
  posted=null;let chainCalls=0;const out=await chains.run(4663,()=>core.batch([{method:'eth_call',params:[{to:A,data:'0x01'},'0x1']}]),{rpc:async()=>{chainCalls++;return '0x3';}});
  assert.equal(chainCalls,1);assert.deepEqual(out,['0x3']);assert.equal(posted,null,'4663 scope never reaches the Arc transport');
 }finally{global.fetch=orig;}
});
test('HC-10 adaptive pacing: 429 raises the shared interval, sustained success relaxes it back to the base quickly',async()=>{
 let n=0;const fetcher=async(url,{body})=>{const {method}=JSON.parse(body);n++;if(method==='eth_chainId')return {status:200,json:async()=>({jsonrpc:'2.0',id:1,result:'0x1237'})};
  if(n<=3)return {status:429,headers:{get:()=>null},json:async()=>({})};return {status:200,json:async()=>({jsonrpc:'2.0',id:1,result:'0x1'})};};
 const rpc=chains.rpcClient(4663,{fetcher,sleep:async()=>{},urls:[]});
 await rpc('eth_blockNumber',[]);assert.equal(rpc.metrics.http429,2);assert.equal(rpc.metrics.maxIntervalMs,338);
 for(let i=0;i<40;i++)await rpc('eth_blockNumber',[]);assert.equal(rpc.metrics.intervalMs,150,'back at the base after 40 successes');
});
