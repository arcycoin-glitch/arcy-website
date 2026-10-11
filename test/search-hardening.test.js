'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const read=require('../search/server/lib/robinhood-holder-count');
const adapter=require('../search/server/lib/robinhood-adapter');
const ADDRESS='0x'+'a'.repeat(40);
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
 assert.equal(failed,null);assert.equal(requests,1);
 assert.equal(await read.fetchCount('not a contract',{fetcher:()=>{throw Error('Should not call')}}),null);
});


test('Chart endpoint separates GeckoTerminal service outages from absent price data',async()=>{
 const history=require('../search/server/lib/price-history');
 const handler=require('../search/server/api/chart');
 const original=history.load;
 const response=()=>({statusCode:200,headers:{},body:null,
  setHeader(k,v){this.headers[k]=v},status(v){this.statusCode=v;return this},
  json(body){this.body=body;return this}});
 const req={method:'GET',query:{chain:'robinhood',address:ADDRESS},headers:{},socket:{remoteAddress:'127.0.0.1'}};
 try{
  history.load=async()=>{throw Error('GeckoTerminal HTTP 429')};
  const down=response();await handler(req,down);
  assert.equal(down.statusCode,503);
  assert.equal(down.headers['Retry-After'],'60');
  assert.equal(down.headers['Cache-Control'],'no-store');
  assert.equal(down.body.error,'CHART_PROVIDER_TEMPORARILY_UNAVAILABLE');
  assert.equal(down.body.network,'robinhood');
  history.load=async()=>{throw Error('No exact-token source pool verified')};
  const noMarket=response();await handler(req,noMarket);
  assert.equal(noMarket.statusCode,200);
  assert.equal(noMarket.body.error,'CHART_SOURCE_NOT_VERIFIED');
 }finally{history.load=original}
});


test('Five research-card coverage statuses distinguish full 4/4 from partial and absent',()=>{
 const engine=require('../search/server/lib/data-engine');
 const cfg={id:'ethereum',chainId:1};
 const field=value=>({value,dataState:'DATA_FOUND',status:'SOURCE_REPORTED',
  chainId:1,network:'ethereum',source:'Exact-chain source',evidence:[{sourceUrl:'https://example.org/'}]});
 const source={fields:{totalSupply:field(1000000),circulatingSupply:field(950000),
  burnAddressBalance:field(1000),burnAddressPct:field(0.1)}};
 const good=engine.formatCard('supply',source,cfg);
 assert.equal(good.status,'SOURCE_BACKED');
 assert.equal(Object.values(good.fields).filter(x=>x.dataState==='DATA_FOUND').length,4);
 const partial=engine.formatCard('supply',{fields:{totalSupply:field(1000000)}},cfg);
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
 assert.ok(ok.body.capabilities.includes('chart'));
 assert.match(ok.body.note,/Liveness only/);
 const rejected=res();
 await route({method:'POST',query:{action:'health'}},rejected);
 assert.equal(rejected.statusCode,405);
});
