'use strict';
// #262: an address without bytecode on the selected chain (wrong chain, EOA, not deployed) is a deterministic answer.
// It must not be reported as a retryable provider outage (previously HTTP 502 CHAIN_SCAN_UNAVAILABLE).
const test=require('node:test'),assert=require('node:assert/strict');
const ADDR='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
function rpcFetch(code){
 return async(url,o)=>{const b=JSON.parse(o.body);const result=b.method==='eth_chainId'?'0x1':b.method==='eth_blockNumber'?'0x10':b.method==='eth_getCode'?code:'0x';
  return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result}),{status:200,headers:{'content-type':'application/json'}});};
}
test('Ethereum inspect: empty bytecode -> NO_CONTRACT_CODE; malformed bytecode stays a generic failure',async()=>{
 const eth=require('../search/server/lib/eth'),orig=global.fetch;
 try{
  global.fetch=rpcFetch('0x');
  await assert.rejects(eth.inspect(ADDR),e=>e.code==='NO_CONTRACT_CODE');
  global.fetch=rpcFetch('0xzz');
  await assert.rejects(eth.inspect(ADDR),e=>e.code!=='NO_CONTRACT_CODE');
 }finally{global.fetch=orig;}
});
test('report API: NO_CONTRACT_CODE -> 404 explicit; any other failure keeps the 502 CHAIN_SCAN_UNAVAILABLE contract',async()=>{
 const service=require('../search/server/lib/multichain-service'),orig=service.report;
 const handler=require('../search/server/api/report');
 const call=async()=>{const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
  await handler({method:'GET',query:{address:ADDR,chain:'ethereum'},headers:{},socket:{remoteAddress:'203.0.113.'+Math.floor(Math.random()*200)}},res);return res;};
 try{
  service.report=async()=>{throw Object.assign(Error('No contract deployed at this address'),{code:'NO_CONTRACT_CODE'});};
  const a=await call();assert.equal(a.code,404);assert.equal(a.body.error,'NO_CONTRACT_CODE');assert.equal(a.body.ok,false);assert.equal(a.body.chainId,1);
  service.report=async()=>{throw Error('RPC down');};
  const b=await call();assert.equal(b.code,502);assert.equal(b.body.error,'CHAIN_SCAN_UNAVAILABLE');
 }finally{service.report=orig;}
});

test('progress API: terminal NDJSON error preserves exact-chain 404 identity and 502 provider reason after streaming starts',async()=>{
 const service=require('../search/server/lib/multichain-service'),original=service.report;
 const handler=require('../search/server/api/progress');
 let counter=0;
 const invoke=async(code)=>{
  const lines=[];
  const res={headers:{},statusCode:200,writableEnded:false,
   setHeader(key,value){this.headers[key]=value;},
   once(){},
   flushHeaders(){this.flushed=true;},
   write(line){lines.push(JSON.parse(line));},
   end(){this.writableEnded=true;},
   status(status){this.statusCode=status;return this;},
   json(body){this.payload=body;return body;}
  };
  service.report=async({network,address,onProgress})=>{
   assert.equal(network,'ethereum');assert.equal(address,ADDR);
   onProgress({phase:'identity',report:{network,address,chainId:1}});
   if(code==='NO_CONTRACT_CODE')throw Object.assign(Error('No code'),{code});
   throw Error('Simulated RPC outage');
  };
  await handler({
   method:'GET',
   query:{address:ADDR,chain:'ethereum'},
   headers:{},
   socket:{remoteAddress:'203.0.113.'+(210+(counter++))}
  },res);
  assert.equal(res.statusCode,200,'headers were already flushed for NDJSON');
  assert.equal(res.flushed,true);
  assert.ok(res.headers['Content-Type'].startsWith('application/x-ndjson'));
  assert.equal(res.writableEnded,true);
  assert.equal(lines[0].phase,'identity');
  assert.equal(lines[1].phase,'error');
  assert.equal(lines.length,2);
  assert.equal(lines[1].network,'ethereum');
  assert.equal(lines[1].chainId,1);
  assert.equal(lines[1].address,ADDR);
  return lines[1];
 };
 try{
  const missing=await invoke('NO_CONTRACT_CODE');
  assert.equal(missing.error,'NO_CONTRACT_CODE');
  assert.match(missing.reason,/No contract bytecode/);
  const unavailable=await invoke('RPC_UNAVAILABLE');
  assert.equal(unavailable.error,'CHAIN_SCAN_UNAVAILABLE');
  assert.match(unavailable.reason,/required contract evidence/);
 }finally{service.report=original;}
});
