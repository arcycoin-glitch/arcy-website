'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const runtime=require('../search/server/lib/runtime-evidence');
const token='0x'+'a'.repeat(40),impl='0x'+'b'.repeat(40),beacon='0x'+'c'.repeat(40),admin='0x'+'d'.repeat(40),block='0x123';
const word=a=>'0x'+a.slice(2).padStart(64,'0');
test('non-delegating runtime supplies chain-scoped architecture evidence only, never mint/tax/owner absence',async()=>{
 for(const network of ['arc','ethereum','robinhood']){
  const result=await runtime.inspect({network,address:token,block,rpc:async(method,p)=>{assert.equal(method,'eth_getCode');assert.deepEqual(p,[token,block]);return '0x60006000f3';}});
  assert.match(result.contractArchitecture.value,/NON-PROXY/);assert.equal(result.contractArchitecture.network,network);
  assert.equal(result.ownerAdmin,undefined);assert.equal(result.mintCapability,undefined);assert.equal(result.tradingTaxes,undefined);
 }
});
test('exact minimal clone validates its implementation bytecode at the same pinned block',async()=>{
 const out=await runtime.inspect({network:'robinhood',address:token,block,rpc:async(m,p)=>{
  assert.equal(m,'eth_getCode');assert.equal(p[1],block);return p[0]===token?'0x363d3d373d3d3d363d73'+impl.slice(2)+'5af43d82803e903d91602b57fd5bf3':'0x60006000f3';
 }});
 assert.equal(out.contractArchitecture.value,'EIP-1167 minimal proxy');assert.equal(out.contractArchitecture.chainId,4663);
 assert.equal(out.contractArchitecture.evidence[0].implementation,impl);
});
test('legacy implementation, beacon target and stored proxy admin require canonical addresses and deployed targets',async()=>{
 for(const kind of ['legacy','beacon']){
  const out=await runtime.inspect({network:'ethereum',address:token,block,rpc:async(m,p)=>{
   assert.equal(p.at(-1),block);
   if(m==='eth_getCode')return p[0]===token?'0x365af400':'0x60006000f3';
   if(m==='eth_getStorageAt')return p[1]===runtime.ADMIN?word(admin):p[1]===runtime.LEGACY&&kind==='legacy'?word(impl):p[1]===runtime.BEACON&&kind==='beacon'?word(beacon):word('0x'+'0'.repeat(40));
   if(m==='eth_call'){assert.equal(p[0].to,beacon);return word(impl);}throw Error('unexpected');
  }});
  assert.equal(out.contractArchitecture.dataState,'DATA_FOUND');assert.match(out.ownerAdmin.value,new RegExp(admin));
 }
});
test('unreadable, truncated, delegated, EOF and absent runtime never become NON-PROXY by default',async()=>{
 for(const code of ['0x','0x60','0xef0001','0x365af400','0x73'+'f'.repeat(64)]){
  const out=await runtime.inspect({network:'arc',address:token,block,rpc:async m=>m==='eth_getCode'?code:word('0x'+'0'.repeat(40))});
  assert.equal(out.contractArchitecture,undefined);
 }
 await assert.rejects(runtime.inspect({network:'arc',address:token,block:'latest',rpc:async()=>{throw Error('no call');}}));
});
test('architecture evidence never invents a target when slot points to self or EOA',async()=>{
 const out=await runtime.inspect({network:'arc',address:token,block,needAdmin:false,rpc:async(m,p)=>m==='eth_getCode'?(p[0]===token?'0x365af400':'0x'):word(p[1]===runtime.LEGACY?token:impl)});
 assert.equal(out.contractArchitecture,undefined);
});
test('small holder set uses the entire reconciled population for top-N, not invented missing wallets',()=>{
 const h=require('../search/server/lib/holders'),a=['0x'+'1'.repeat(40),'0x'+'2'.repeat(40)];
 const result=h.calculate(a,[60n,40n],100n,2,block,token);
 assert.equal(result.fields.holderCount.value,2);assert.equal(result.fields.largestWalletPct.value,60);
 assert.equal(result.fields.top10Pct.value,100);assert.equal(result.fields.top20Pct.value,100);
 for(const bad of [[60n,39n],[60n,0n]])assert.equal(h.calculate(a,bad,100n,2,block,token).fields.top10Pct.value,null);
});
test('ranked RPC failure preserves the independently source-reported holder count',async()=>{
 const h=require('../search/server/lib/holders'),eth=require('../search/server/lib/eth'),fetch=global.fetch;
 global.fetch=async url=>new Response(JSON.stringify(String(url).endsWith('/counters')?{token_holders_count:2}:{items:[{address:'0x'+'1'.repeat(40)},{address:'0x'+'2'.repeat(40)}],next_page_params:null}));
 // h captured rpc by destructuring; the global transport failure affects those calls too.
 const prior=global.fetch;global.fetch=async(url,o)=>o?.method==='POST'?Promise.reject(Error('RPC down')):prior(url,o);
 try{const result=await h.inspect(token,block,'100');assert.equal(result.fields.holderCount.value,2);assert.equal(result.fields.holderCount.status,'SOURCE_REPORTED');assert.equal(result.fields.top10Pct.value,null);}finally{global.fetch=fetch;}
});
test('owner words with nonzero high padding are rejected on every Search network',()=>{
 const bad='0x'+'f'.repeat(24)+'b'.repeat(40);
 for(const decode of [require('../search/server/lib/control').addrWord,require('../search/server/lib/arc-adapter').addressWord,require('../search/server/lib/robinhood-adapter').addressOf])assert.equal(decode(bad),null);
});
test('source requests coalesce, bound cache and return isolated values; failures do not become data',async()=>{
 const {createReader}=require('../search/server/lib/source-request');let now=0,calls=0;
 const reader=createReader({ttlMs:10,now:()=>now}),fetcher=async()=>{calls++;return new Response(JSON.stringify({items:[1]}));};
 const options={fetcher,validate:b=>Array.isArray(b.items)};
 const [a,b]=await Promise.all([reader.json('https://source.example/item',options),reader.json('https://source.example/item',options)]);assert.equal(calls,1);a.items[0]=99;assert.deepEqual(b.items,[1]);
 now=11;await assert.rejects(reader.json('https://source.example/item',{fetcher:async()=>new Response('',{status:503})}));
 await reader.json('https://source.example/item',options);assert.equal(calls,2);
});
test('429 cooldown honors a bounded Retry-After without aggressive retries or false successful data',async()=>{
 const {createReader}=require('../search/server/lib/source-request');let now=0,calls=0;
 const reader=createReader({now:()=>now}),fetcher=async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'2'}});};
 await assert.rejects(reader.json('https://limited.example/one',{fetcher}));
 await assert.rejects(reader.json('https://limited.example/two',{fetcher}),{code:'SOURCE_RATE_LIMIT'});assert.equal(calls,1);
 now=2100;await assert.rejects(reader.json('https://limited.example/two',{fetcher}));assert.equal(calls,2);
});
test('wrong-contract registry artwork never inherits the official token picture',()=>{
 const assets=require('../search/server/lib/robinhood-assets');
 const rows=assets.parseAssets({assets:[{tokenSymbol:'X',tokenName:'Issuer token',deployments:[{chainId:4663,contractAddress:token}],logoUrl:'https://cdn.robinhood.com/ncw_assets/logos/'+impl+'.png'}]});
 assert.equal(rows[0].logoUrl,null);
});
test('timeout covers a stalled response body, clears in-flight work and permits recovery',async()=>{
 const {createReader}=require('../search/server/lib/source-request'),reader=createReader();
 await assert.rejects(reader.json('https://slow.example/data',{timeoutMs:10,fetcher:async(_url,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(Error('Body timeout')),{once:true});}}))}));
 const recovered=await reader.json('https://slow.example/data',{fetcher:async()=>new Response('{"recovered":true}')});assert.equal(recovered.recovered,true);
});
test('malformed successful HTTP response cannot enter a successful source cache',async()=>{
 const {createReader}=require('../search/server/lib/source-request'),reader=createReader(),validate=b=>Array.isArray(b.items);
 await assert.rejects(reader.json('https://schema.example/data',{validate,fetcher:async()=>new Response('{"error":"unavailable"}')}));
 const recovered=await reader.json('https://schema.example/data',{validate,fetcher:async()=>new Response('{"items":[]}')});assert.deepEqual(recovered.items,[]);
});
test('four additional artwork mappings require exact network plus full issuer contract',async()=>{
 const logos=require('../search/server/lib/search-logo'),identity=require('../search/server/lib/token-identity');
 for(const [network,address,icon]of [['arc','0x76a443768a5e3b8d1aed0105fc250877841deb40','link'],['robinhood','0x492641f648a4986844848e0befe66d14817bce34','link'],['ethereum','0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9','aave'],['ethereum','0xc944e90c64b2c07662a292be6244bdf05cda44a7','grt']]){
  assert.equal(logos.localLogo(network,address),'/search/assets/token-icons/'+icon+'.svg');assert.equal(identity.verified(network,address).status,'OFFICIAL_CONTRACT_MATCHED');
  assert.equal(logos.localLogo(network,token),null);assert.equal(identity.verified(network,token),null);
 }
});
