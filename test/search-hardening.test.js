'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const read=require('../search/server/lib/robinhood-holder-count');
const adapter=require('../search/server/lib/robinhood-adapter');
const rhRpc=require('../search/server/lib/robinhood-rpc');
const holderRank=require('../search/server/lib/robinhood-holder-rank');
const ADDRESS='0x'+'a'.repeat(40);
test('Robinhood runtime identifies only exact EIP-1167 clones',()=>{
 const implementation='0x'+'b'.repeat(40);
 const code='0x363d3d373d3d3d363d73'+implementation.slice(2)+'5af43d82803e903d91602b57fd5bf3';
 assert.equal(rhRpc.minimalProxyImplementation(code),implementation);
 assert.equal(rhRpc.minimalProxyImplementation(code+'00'),null);
 assert.equal(rhRpc.minimalProxyImplementation('0x60006000'),null);
 assert.equal(rhRpc.minimalProxyImplementation('0x363d3d373d3d3d363d73'+'0'.repeat(40)+'5af43d82803e903d91602b57fd5bf3'),null);
 assert.equal(rhRpc.containsOpcode('0x60f4',0xf4),false);
 assert.equal(rhRpc.containsOpcode('0x60006000f4',0xf4),true);
});
test('Robinhood mechanics rechecks actual runtime instead of trusting opcode hints',async()=>{
 const original=global.fetch,block='0x1234';
 let actualCode='0x600160005500';
 global.fetch=async(_url,options)=>{if(!options?.body)return new Response('{}',{status:404});const body=JSON.parse(options.body);const result=body.method==='eth_getCode'?actualCode:'0x'+'0'.repeat(64);return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));};
 try{
  for(const detected of [false,true]){
   actualCode=detected?'0x60006000f400':'0x600160005500';
   const card=await adapter.mechanics({address:ADDRESS,base:{address:ADDRESS,block,runtimeDelegatecallDetected:detected}});
   const field=card.fields.contractArchitecture;
   if(detected){assert.equal(field.dataState,'NOT_VERIFIED');assert.equal(field.value,null);}
   else{assert.equal(field.dataState,'DATA_FOUND');assert.equal(field.status,'ON_CHAIN');assert.match(field.value,/NON-PROXY/);assert.equal(field.evidence[0].block,block);}
  }
 }finally{global.fetch=original}
});
test('Robinhood mechanics adds architecture only after pinned implementation bytecode exists',async()=>{
 const original=global.fetch,implementation='0x'+'b'.repeat(40),block='0x1234';
 global.fetch=async(url,options)=>{
  if(!options?.body)return new Response('{}',{status:404});
  const body=JSON.parse(options.body);
  const result=body.method==='eth_getCode'&&body.params[0]===implementation?'0x60016000':
   body.method==='eth_getCode'&&body.params[0]===ADDRESS?'0x363d3d373d3d3d363d73'+implementation.slice(2)+'5af43d82803e903d91602b57fd5bf3':
   body.method==='eth_call'?'0x'+'0'.repeat(64):'0x'+'0'.repeat(64);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
 };
 try{
  const card=await adapter.mechanics({address:ADDRESS,base:{address:ADDRESS,block,proxyImplementation:implementation}});
  const field=card.fields.contractArchitecture;
  assert.equal(field.dataState,'DATA_FOUND');
  assert.equal(field.status,'ON_CHAIN');
  assert.match(field.value,/EIP-1167 minimal proxy/);
  assert.equal(field.evidence[0].block,block);
  assert.equal(field.evidence[0].implementation,implementation);
 }finally{global.fetch=original}
});
test('Robinhood ranked holders publish only when Blockscout top 20 match pinned RPC balances',async()=>{
 const rows=Array.from({length:20},(_,i)=>({address:{hash:'0x'+(i+1).toString(16).padStart(40,'0')},value:String(100-i)}));
 const block='0x1234',calls=[];
 const good=await holderRank.fetchRank(ADDRESS,{block,totalSupplyRaw:'10000',
  fetcher:async url=>{assert.equal(url,'https://robinhoodchain.blockscout.com/api/v2/tokens/'+ADDRESS+'/holders');return new Response(JSON.stringify({items:rows}))},
  rpcCall:async(method,params)=>{assert.equal(method,'eth_call');assert.equal(params[1],block);calls.push(params[0].data);return '0x'+BigInt(100-((parseInt(params[0].data.slice(-40),16))-1)).toString(16).padStart(64,'0')}
 });
 assert.equal(calls.length,20);assert.equal(good.largestWalletPct.value,1);
 assert.equal(good.top10Pct.value,9.55);assert.equal(good.top20Pct.value,18.1);
 assert.equal(good.top20Pct.evidence[0].chainId,4663);
 const mismatch=await holderRank.fetchRank(ADDRESS,{block,totalSupplyRaw:'1000',
  fetcher:async()=>new Response(JSON.stringify({items:rows})),rpcCall:async()=> '0x'+'0'.repeat(64)});
 assert.equal(mismatch.reasonCode,'BLOCKSCOUT_RANK_NO_POSITIVE_PINNED_BALANCES');
 assert.equal(holderRank.rows({items:[rows[1],rows[0]]}),null);
});
test('Robinhood Blockscout holder count has bounded exact contract validation',()=>{
 for(const value of [{token_holders_count:42},{token_holders_count:'42'},{holders_count:42}])
  assert.equal(read.parseCount(value),42);
 for(const value of [{holders_count:0},{holders_count:'0'},{holders_count:-10},{holders_count:'0x2a'},
  {holders_count:'999999999999999999999'},null,{}])
  assert.equal(read.parseCount(value),null);
});
test('Count from public Robinhood Blockscout is source-scoped, not pinned block',async()=>{
 const result=await read.fetchCount(ADDRESS,{key:'',now:Date.parse('2026-10-11T12:00:00Z'),
  fetcher:async url=>{
   assert.equal(url,'https://robinhoodchain.blockscout.com/api/v2/tokens/'+ADDRESS+'/counters');
   return new Response(JSON.stringify({token_holders_count:'1234'}));
  }
 });
 assert.equal(result.value,1234);assert.equal(result.network,'robinhood');
 assert.equal(result.chainId,4663);assert.match(result.evidence[0].scope,/No complete pinned wallet ranking/);
 assert.equal(result.evidence[0].checkedAt,'2026-10-11T12:00:00.000Z');
});
test('PRO fallback uses a secret only on server; never puts it in evidence or error',async()=>{
 const key='proapi_EXAMPLE_SAFE_TESTING_KEY',seen=[];
 const result=await read.fetchCount(ADDRESS,{key,fetcher:async url=>{
  seen.push(url);
  if(seen.length===1)return new Response('',{status:403});
  return new Response(JSON.stringify({token_holders_count:3456}));
 }});
 assert.equal(seen.length,2);
 assert.equal(new URL(seen[1]).searchParams.get('apikey'),key);
 assert.equal(result.value,3456);
 assert.equal(result.source,'Blockscout PRO Robinhood');
 assert.equal(JSON.stringify(result).includes(key),false);
 assert.equal(result.evidence[0].sourceUrl,'https://api.blockscout.com/4663/api/v2/tokens/'+ADDRESS+'/counters');
});
test('Invalid credential and failed providers never leak details or invent holder count',async()=>{
 let requests=0;
 const failed=await read.fetchCount(ADDRESS,{key:'nonsense',fetcher:async()=>{
  requests++;return new Response('blocked',{status:403});
 }});
 assert.equal(failed,null);assert.equal(requests,2); // Public counters and token metadata both failed; no data fabricated.
 assert.equal(await read.fetchCount('not a contract',{fetcher:()=>{throw Error('Should not call')}}),null);
});


test('Chart endpoint returns a rights-pending state and never calls a market provider',async()=>{
 const handler=require('../search/server/api/chart');
 const original=global.fetch;let requests=0;global.fetch=async()=>{requests++;throw Error('disabled provider called')};
 const response=()=>({statusCode:200,headers:{},body:null,
  setHeader(k,v){this.headers[k]=v},status(v){this.statusCode=v;return this},
  json(body){this.body=body;return this}});
 const req={method:'GET',query:{chain:'robinhood',address:ADDRESS},headers:{},socket:{remoteAddress:'127.0.0.1'}};
 try{
  const pending=response();await handler(req,pending);
  assert.equal(pending.statusCode,503);
  assert.equal(pending.body.error,'CHART_SOURCE_PENDING');
  assert.equal(pending.body.network,'robinhood');
  assert.equal(requests,0);
 }finally{global.fetch=original}
});


test('Five research-card coverage statuses distinguish full 4/4 from partial and absent',()=>{
 const engine=require('../search/server/lib/data-engine');
 const cfg={id:'ethereum',chainId:1};
 const field=value=>({value,dataState:'DATA_FOUND',status:'SOURCE_REPORTED',
  chainId:1,network:'ethereum',source:'Exact-chain source',evidence:[{sourceUrl:'https://example.org/'}]});
 const source={fields:{totalSupply:field(1000000),circulatingSupply:field('750000'),
  burnAddressBalance:field('25000'),nextUnlock:field('2099-01-01T00:00:00Z')}};
 const good=engine.formatCard('supply',source,cfg);
 assert.equal(good.status,'SOURCE_BACKED');
 assert.equal(Object.values(good.fields).filter(x=>x.dataState==='DATA_FOUND').length,4);
 assert.equal(good.context.totalSupply.value,1000000);
 assert.equal(Object.keys(good.fields).length,4);
 const partial=engine.formatCard('supply',{fields:{burnAddressBalance:field('25000')}},cfg);
 assert.equal(partial.status,'PARTIAL_EVIDENCE');
 assert.equal(Object.values(partial.fields).filter(x=>x.dataState==='DATA_FOUND').length,1);
 const empty=engine.formatCard('supply',{fields:{}},cfg);
 assert.equal(empty.status,'NOT_VERIFIED');
 assert.equal(Object.values(empty.fields).filter(x=>x.dataState==='DATA_FOUND').length,0);
});


test('Small USD prices are readable and evidence keeps unrounded precision',()=>{
 const format=require('../search/format');
 assert.equal(format.display(2.735e-5,'priceUsd'),'\u00240.00002735');
 assert.equal(format.full(2.735e-5,'priceUsd'),'\u00240.00002735');
 assert.equal(format.display(1.315e-5,'priceUsd'),'\u00240.00001315');
 assert.equal(format.display(0.4935,'priceUsd'),'\u00240.4935');
 assert.equal(format.display(0.00032632,'priceUsd'),'\u00240.0003263');
 assert.equal(format.display(0.00032144,'priceUsd'),'\u00240.0003214');
 assert.equal(format.display(0.00032632,'valuation'),'\u00240.0003');
 assert.equal(format.full(0.00032632,'priceUsd'),'\u00240.00032632');
 assert.equal(format.display(151600000,'valuation'),'\u0024151.6M');
 assert.equal(format.display(151600000,'valuation','MARKET_CAP'),'Market Cap \u0024151.6M');
 assert.equal(format.display(0,'priceUsd'),'\u00240');
});

test('Search health describes all three deployed networks without claiming upstream availability',async()=>{
 const route=require('../api/search/index');
 const res=()=>({statusCode:200,headers:{},
  setHeader(key,value){this.headers[key]=value;return this},
  status(code){this.statusCode=code;return this},
  json(payload){this.body=payload;return this}});
 const ok=res();
 await route({method:'GET',query:{action:'health'}},ok);
 assert.equal(ok.statusCode,200);
 assert.equal(ok.body.ok,true);
 assert.equal(ok.body.readOnly,true);
 assert.deepEqual(ok.body.networks,['arc','ethereum','robinhood']);
 assert.deepEqual(ok.body.chainIds,[5042,1,4663]);
 assert.equal(ok.body.expectedCards,5);
 assert.equal(ok.body.expectedMetrics,20);
 assert.ok(ok.body.capabilities.includes('chart-ui'));
 assert.ok(ok.body.disabledProviders.includes('GeckoTerminal raw OHLCV API'));
 assert.ok(!ok.body.disabledProviders.includes('DEX Screener API'));
 assert.ok(ok.body.marketSources.some(x=>x.includes('DEX Screener')));
 assert.ok(ok.body.marketSources.some(x=>x.includes('GoPlus Security')));
 assert.equal(ok.body.marketDataState,'CONTRACT_SCOPED_SOURCE_REPORTED');
 assert.equal(ok.body.chartDataState,'OFFICIAL_PROVIDER_IFRAME_ONLY');
 assert.match(ok.body.note,/Liveness only/);
 const rejected=res();
 await route({method:'POST',query:{action:'health'}},rejected);
 assert.equal(rejected.statusCode,405);
});

