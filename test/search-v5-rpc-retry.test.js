'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),eth=require('../search/server/lib/eth');
const scope=require('../search/server/lib/analysis-scope');
const good=options=>Response.json({jsonrpc:'2.0',id:JSON.parse(options.body).id,result:'0x1'});
const PRIMARY='https://primary.rpc.test/',BACKUP='https://backup.rpc.test/';
// Provider configuration is explicit in every test. Default production
// behaviour is ONE provider: a fallback exists only when an operator sets
// ETH_RPC_FALLBACK_URL, so no third-party endpoint is silently activated.
async function withProviders(fallback,run){
 const saved={url:process.env.ETH_RPC_URL,fallback:process.env.ETH_RPC_FALLBACK_URL,fetch:global.fetch};
 process.env.ETH_RPC_URL=PRIMARY;
 if(fallback)process.env.ETH_RPC_FALLBACK_URL=BACKUP;else delete process.env.ETH_RPC_FALLBACK_URL;
 try{return await run()}
 finally{
  global.fetch=saved.fetch;
  if(saved.url===undefined)delete process.env.ETH_RPC_URL;else process.env.ETH_RPC_URL=saved.url;
  if(saved.fallback===undefined)delete process.env.ETH_RPC_FALLBACK_URL;else process.env.ETH_RPC_FALLBACK_URL=saved.fallback;
 }
}
test('no Ethereum fallback provider is activated unless explicitly configured',()=>{
 assert.deepEqual(eth.providers({ETH_RPC_URL:PRIMARY}),[PRIMARY]);
 assert.deepEqual(eth.providers({ETH_RPC_URL:PRIMARY,ETH_RPC_FALLBACK_URL:'disabled'}),[PRIMARY]);
 assert.deepEqual(eth.providers({ETH_RPC_URL:PRIMARY,ETH_RPC_FALLBACK_URL:PRIMARY}),[PRIMARY]);
 assert.deepEqual(eth.providers({ETH_RPC_URL:PRIMARY,ETH_RPC_FALLBACK_URL:BACKUP}),[PRIMARY,BACKUP]);
 assert.throws(()=>eth.providers({ETH_RPC_URL:PRIMARY,ETH_RPC_FALLBACK_URL:'http://insecure.example/'}));
});
test('transient Ethereum 429 recovers once without bypassing response identity checks',()=>withProviders(false,async()=>{
 let calls=0;
 global.fetch=async(_url,options)=>++calls===1?new Response(null,{status:429,headers:{'retry-after':'0'}}):good(options);
 assert.equal(await eth.rpc('eth_chainId',[],{timeoutMs:1000}),'0x1');assert.equal(calls,2);
}));
test('Retry-After beyond the remaining shared deadline fails closed immediately on a single provider',()=>withProviders(false,async()=>{
 let calls=0;global.fetch=async()=>{calls++;return new Response(null,{status:429,headers:{'retry-after':'60'}})};
 await assert.rejects(eth.rpc('eth_chainId',[],{timeoutMs:500}),{httpStatus:429});assert.equal(calls,1);
}));
test('Retry-After beyond the shared deadline never waits; a configured independent provider is tried once inside the same budget',()=>withProviders(true,async()=>{
 const urls=[];global.fetch=async url=>{urls.push(String(url));return new Response(null,{status:429,headers:{'retry-after':'60'}})};
 const start=Date.now();
 await assert.rejects(eth.rpc('eth_chainId',[],{timeoutMs:500}),{httpStatus:429});
 assert.deepEqual(urls,[PRIMARY,BACKUP]);
 assert.ok(Date.now()-start<500,'must not sleep for a Retry-After beyond the shared budget');
}));
test('malformed identity, invalid JSON and getter errors are not retried or failed over into apparent evidence',()=>withProviders(true,async()=>{
 for(const payload of ['invalid JSON',{jsonrpc:'2.0',id:-1,result:'0x1'},{jsonrpc:'2.0',error:{code:-32000,message:'execution reverted'}}]){
  let calls=0;global.fetch=async(_url,options)=>{calls++;return typeof payload==='string'?new Response(payload):Response.json({...payload,id:payload.id??JSON.parse(options.body).id})};
  await assert.rejects(eth.rpc('eth_call',[{to:'0x'+'1'.repeat(40),data:'0x1234'},'0x123'],{timeoutMs:1000}));assert.equal(calls,1);
 }
}));
test('an unavailable Ethereum provider is attempted at most twice per read',()=>withProviders(false,async()=>{
 let calls=0;global.fetch=async()=>{calls++;return new Response(null,{status:503})};
 await assert.rejects(eth.rpc('eth_chainId',[],{timeoutMs:1000}),{httpStatus:503});assert.equal(calls,2);
}));
test('with a configured fallback, each provider is attempted at most twice per read',()=>withProviders(true,async()=>{
 const urls=[];global.fetch=async url=>{urls.push(String(url));return new Response(null,{status:503})};
 await assert.rejects(eth.rpc('eth_chainId',[],{timeoutMs:2000}),{httpStatus:503});
 assert.deepEqual(urls,[PRIMARY,PRIMARY,BACKUP,BACKUP]);
}));
test('all providers share ONE total timeout budget instead of one budget each',()=>withProviders(true,async()=>{
 const urls=[];
 global.fetch=async(url,options)=>{urls.push(String(url));return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason||Error('aborted'))))};
 const start=Date.now();
 await assert.rejects(eth.rpc('eth_blockNumber',[],{timeoutMs:300}));
 const elapsed=Date.now()-start;
 assert.ok(elapsed<450,'two stalled providers must finish within one shared 300ms budget, took '+elapsed+'ms');
 assert.deepEqual(urls,[PRIMARY],'no budget remains for the second provider after the first consumed it');
}));
test('a configured fallback that answers with another chain ID cannot supply a value',()=>withProviders(true,async()=>{
 global.fetch=async(url,options)=>{
  if(String(url)===PRIMARY)return new Response(null,{status:503});
  const body=JSON.parse(options.body);
  return Response.json({jsonrpc:'2.0',id:body.id,result:body.method==='eth_chainId'?'0x89':'0xabc'});
 };
 await assert.rejects(eth.rpc('eth_blockNumber',[],{timeoutMs:2000}),{code:'CHAIN_ID_MISMATCH'});
}));
test('fallback success after a primary outage returns the verified secondary value',()=>withProviders(true,async()=>{
 global.fetch=async(url,options)=>{
  if(String(url)===PRIMARY)return new Response(null,{status:503});
  const body=JSON.parse(options.body);
  return Response.json({jsonrpc:'2.0',id:body.id,result:body.method==='eth_chainId'?'0x1':'0xabc'});
 };
 assert.equal(await eth.rpc('eth_blockNumber',[],{timeoutMs:2000}),'0xabc');
}));
test('reads inside one report stay on the pinned snapshot provider and never mix providers',()=>withProviders(true,async()=>{
 const urls=[];global.fetch=async url=>{urls.push(String(url));return new Response(null,{status:503})};
 await scope.run(async()=>{
  scope.pinProvider('ethereum',PRIMARY);
  await assert.rejects(eth.rpc('eth_blockNumber',[],{timeoutMs:2000}),{httpStatus:503});
  assert.throws(()=>scope.pinProvider('ethereum',BACKUP),/cannot mix/);
 });
 assert.deepEqual(urls,[PRIMARY,PRIMARY]);
}));
test('a full token snapshot fails over as a whole within one shared budget and pins the provider',()=>withProviders(true,async()=>{
 const token='0x'+'2'.repeat(40),word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
 const answers={'0x18160ddd':word(1000n),'0x313ce567':word(6n),'0x06fdde03':'0x','0x95d89b41':'0x'};
 global.fetch=async(url,options)=>{
  if(String(url)===PRIMARY)return new Response(null,{status:503});
  const b=JSON.parse(options.body),reply=result=>Response.json({jsonrpc:'2.0',id:b.id,result});
  if(b.method==='eth_chainId')return reply('0x1');
  if(b.method==='eth_blockNumber')return reply('0x10');
  if(b.method==='eth_getCode')return reply('0x6001');
  const data=b.params[0].data;return reply(answers[data]||word(0n));
 };
 await scope.run(async()=>{
  const t=await eth.inspect(token,{timeoutMs:3000});
  assert.equal(t.block,'0x10');assert.equal(t.totalSupplyRaw,'1000');
  assert.equal(scope.pinnedProvider('ethereum'),BACKUP);
 });
}));
