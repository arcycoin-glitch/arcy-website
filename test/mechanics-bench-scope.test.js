'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mechanics}=require('../scripts/mechanics-bench-run.cjs');
const scope=require('../search/server/lib/analysis-scope');
const coverage=require('../search/server/lib/mechanics-coverage');
const deep=require('../search/server/lib/mechanics-deep');
const keccak=require('../lib/keccak');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const TOKEN='0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b',OP='0x'+'22'.repeat(20),PROXY='0x'+'33'.repeat(20);
const word=x=>'0x'+BigInt(x).toString(16).padStart(64,'0'),addr=x=>'0x'+x.slice(2).padStart(64,'0');
const selector=x=>keccak(Buffer.from(x)).slice(0,10);
const E18=10n**18n;
function fixture(t){
 const log=[],original=global.fetch;
 let block='0x1234',supply=99000000n*E18,failSupply=false,reviewed=true;
 global.fetch=async(url,options)=>{
  const request=JSON.parse(options.body);log.push(request);
  const {method,params,id}=request;
  let result;
  if(method==='eth_chainId')result='0x1';
  else if(method==='eth_blockNumber')result=block;
  else if(method==='eth_getCode')result='0x600160005500';
  else if(method==='eth_getStorageAt')result=word(0);
  else if(method==='eth_call'){
   const data=params[0].data;
   if(data===selector('totalSupply()')&&failSupply)return new Response(JSON.stringify({jsonrpc:'2.0',id,error:{code:3,message:'execution reverted'}}));
   result=({[selector('totalSupply()')]:word(supply),[selector('decimals()')]:word(18),
    [selector('operator()')]:addr(OP),[selector('vecrvProxy()')]:addr(PROXY),[selector('maxSupply()')]:word(100000000n*E18)})[data]??word(0);
  }else throw Error('Unexpected RPC '+method);
  return new Response(JSON.stringify({jsonrpc:'2.0',id,result}),{headers:{'content-type':'application/json'}});
 };
 t.after(()=>{global.fetch=original;});
 const source={abi:[],digest:Object.entries(deep.PROFILES).find(([,p])=>p==='OPERATOR_SCHEDULED_CAPPED_MINT')[0],runtimeMatch:'exact_match',sourceProvider:'Fixture',sourceAssurance:'EXACT_DEPLOYED_BYTECODE_MATCH'};
 const req=path=>{
  if(path==='search/server/lib/security')return {inspect:async()=>({})};
  if(path==='search/server/lib/mechanics-coverage')return {enrich:options=>coverage.enrich({...options,sourceLoader:async()=>reviewed?source:{...source,digest:'a'.repeat(64)}})};
  return require('../'+path);
 };
 return {log,req,setReviewed:x=>{reviewed=x;},setBlock:x=>{block=x;},setSupply:x=>{supply=x;},failSupply:x=>{failSupply=x;},supplyReads:()=>log.filter(r=>r.method==='eth_call'&&r.params[0].data===selector('totalSupply()'))};
}

test('paired gate rejects the old CVX duplicate and accepts scoped replay with the same unchanged budgets',async t=>{
 const f=fixture(t),unscopedReq=p=>p==='search/server/lib/analysis-scope'?{run:operation=>operation()}:f.req(p);
 const run=async(req,reviewed)=>{f.setReviewed(reviewed);f.log.length=0;const result=await mechanics(req,'ethereum',TOKEN);return {result,rpc:f.log.length};};
 const oldBefore=await run(unscopedReq,false),oldAfter=await run(unscopedReq,true);
 const before=await run(f.req,false),after=await run(f.req,true);
 assert.equal(oldAfter.rpc-oldBefore.rpc,4,'old benchmark adds three new getters and a repeated supply getter');
 assert.equal(after.rpc-before.rpc,3,'new benchmark adds only operator, vecrvProxy and maxSupply');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcy-cvx-scope-'));
 const beforeFile=path.join(dir,'before.json'),afterFile=path.join(dir,'after.json');
 t.after(()=>{for(const file of [beforeFile,afterFile])if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(dir);});
 const fields=card=>Object.fromEntries(['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture','transferRestrictions'].map(k=>{
  const x=k==='transferRestrictions'?card.supplementary?.transferRestrictions:card.fields[k];
  return [k,{ok:x?.dataState==='DATA_FOUND',cls:'ON_CHAIN_VERIFIED',status:x?.status||'NOT_VERIFIED',value:x?.value||'',scope:''}];
 }));
 const artifact=(sample,mode,augReviewed)=>{
  const rows=Array.from({length:30},(_,i)=>({chain:'ethereum',address:i===0?TOKEN:'0x'+i.toString(16).padStart(40,'0'),group:'radar',block:sample.result.block,err:null,
   f:fields(sample.result.card),net:{rpc:i===0?sample.rpc:0,sourcify:0,replayMiss:0,augReviewed:i===0?augReviewed:0}}));
  return {mode,rows,net:{rpc:sample.rpc,sourcify:0,replayMiss:0,augReviewed}};
 };
 const gate=(b,a)=>{fs.writeFileSync(beforeFile,JSON.stringify(artifact(b,'replay',0)));fs.writeFileSync(afterFile,JSON.stringify(artifact(a,'augment',3)));return spawnSync(process.execPath,[path.join(__dirname,'../scripts/assert-mechanics-bench.cjs'),beforeFile,afterFile],{encoding:'utf8'});};
 const old=gate(oldBefore,oldAfter);assert.notEqual(old.status,0);assert.match(old.stderr,/New RPC usage for ethereum\|0x4e3fbd/);
 const fixed=gate(before,after);assert.equal(fixed.status,0,fixed.stdout+fixed.stderr);assert.match(fixed.stdout,/PAIRED_MECHANICS_GATE PASS/);
});

test('CVX benchmark reuses the identity pass totalSupply read while preserving every reviewed field',async t=>{
 const f=fixture(t);
 // Recreate the previous benchmark, which called the pipeline outside the
 // request scope supplied by multichain-service.report in Production.
 const unscopedReq=path=>path==='search/server/lib/analysis-scope'?{run:operation=>operation()}:f.req(path);
 const old=await mechanics(unscopedReq,'ethereum',TOKEN);
 assert.equal(f.supplyReads().length,2,'the old path reproduces the extra replay-hit RPC');
 f.log.length=0;
 const current=await mechanics(f.req,'ethereum',TOKEN);
 assert.equal(f.supplyReads().length,1,'the already pinned answer is reused despite the shorter deep-read timeout');
 for(const key of ['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture']){
  assert.equal(current.card.fields[key].value,old.card.fields[key].value);
  assert.equal(current.card.fields[key].status,old.card.fields[key].status);
 }
 assert.equal(current.card.fields.mintCapability.status,'VERIFIED_SOURCE_AND_STATE');
 assert.equal(current.card.fields.mintCapability.evidence[0].totalSupplyRaw,(99000000n*E18).toString());
 assert.equal(current.card.fields.mintCapability.evidence[0].block,'0x1234');
 assert.equal(current.card.fields.mintCapability.evidence[0].sourceDigest,Object.entries(deep.PROFILES).find(([,p])=>p==='OPERATOR_SCHEDULED_CAPPED_MINT')[0]);
 for(const r of f.log)if(['eth_call','eth_getCode','eth_getStorageAt'].includes(r.method))assert.equal(r.params.at(-1),'0x1234');
});

test('Mechanics benchmark scope cannot carry state or failed reads into the next sample',async t=>{
 const f=fixture(t);
 await mechanics(f.req,'ethereum',TOKEN);
 f.setBlock('0x1235');f.setSupply(100000000n*E18);
 const next=await mechanics(f.req,'ethereum',TOKEN);
 assert.equal(f.supplyReads().length,2,'a new sample reads supply again');
 assert.equal(next.card.fields.mintCapability.evidence[0].block,'0x1235');
 assert.equal(next.card.fields.mintCapability.evidence[0].totalSupplyRaw,(100000000n*E18).toString());
 f.failSupply(true);
 await assert.rejects(mechanics(f.req,'ethereum',TOKEN),/Ethereum RPC method failed/);
 f.failSupply(false);f.setSupply(99000000n*E18);
 const recovered=await mechanics(f.req,'ethereum',TOKEN);
 assert.equal(recovered.card.fields.mintCapability.evidence[0].totalSupplyRaw,(99000000n*E18).toString());
 assert.equal(f.supplyReads().length,4,'failure neither poisons the next sample nor reuses an old success');
});

test('shared benchmark cache separates chain, provider, block and call context',async()=>{
 let reads=0;
 const read=(network,endpoint,block,from)=>scope.read(network,endpoint,'eth_call',[{to:TOKEN,data:'0x18160ddd',...(from?{from}:{})},block],{},async()=>++reads);
 await scope.run(async()=>{
  assert.equal(await read('ethereum','https://rpc.example','0x1234'),1);
  assert.equal(await read('ethereum','https://rpc.example','0x1234'),1);
  assert.equal(await read('robinhood','https://rpc.example','0x1234'),2);
  assert.equal(await read('arc','https://rpc.example','0x1234'),3);
  assert.equal(await read('ethereum','https://other.example','0x1234'),4);
  assert.equal(await read('ethereum','https://rpc.example','0x1235'),5);
  assert.equal(await read('ethereum','https://rpc.example','0x1234',OP),6);
 });
 assert.equal(reads,6);
});
