'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const discover=require('../search/server/lib/discover');

const addr='0x'+'a'.repeat(40);
function response(items,status=200){return new Response(JSON.stringify({items}),{status,headers:{'content-type':'application/json'}})}

test('explorer discovery validates chain token records and discards all untrusted artwork and identity claims',async()=>{
 let requested;
 const items=[
  {type:'token',address_hash:addr,name:'ArcTools',symbol:'ARCT',token_type:'ERC-20',icon_url:'https://evil.test/logo.png',is_smart_contract_verified:true,exchange_rate:'1000',circulating_market_cap:'999999'},
  {type:'token',address:'0x'+'b'.repeat(40),name:'ArcTools NFT',symbol:'ARCT',token_type:'ERC-721'},
  {type:'token',address:'0x'+'c'.repeat(40),name:'Unrelated',symbol:'OTHER',token_type:'ERC-20'},
  {type:'address',address:'0x'+'d'.repeat(40),name:'ArcTools',token_type:'ERC-20'}
 ];
 const result=await discover.searchExplorer('arc','ArcTools',{fetchImpl:async(url)=>{requested=new URL(url);return response(items)}});
 assert.equal(requested.origin,'https://explorer.arc.io');
 assert.equal(requested.pathname,'/api/v2/search');
 assert.equal(requested.searchParams.get('q'),'ArcTools');
 assert.equal(result.length,1);
 assert.deepEqual(result[0],{address:addr,network:'arc',chainId:5042,name:'ArcTools',symbol:'ARCT',
  source:'Blockscout explorer index',sourceUrl:'https://explorer.arc.io/token/'+addr,
  identityVerified:false,registryMatched:false,logoUrl:null});
});

test('ethereum and Robinhood discovery stay scoped to each configured explorer and token standard',async()=>{
 const ethereum=await discover.searchExplorer('ethereum','WETH',{fetchImpl:async(url)=>{
  assert.equal(new URL(url).origin,'https://eth.blockscout.com');
  return response([{type:'token',address:addr,name:'Wrapped Ether',symbol:'WETH',token_type:'ERC-20'}]);
 }});
 assert.equal(ethereum[0].network,'ethereum');
 assert.equal(ethereum[0].chainId,1);
 const rh=await discover.searchExplorer('robinhood','APLD',{fetchImpl:async(url)=>{
  assert.equal(new URL(url).origin,'https://robinhoodchain.blockscout.com');
  return response([{type:'token',address:addr,name:'Applied Digital',symbol:'APLD',token_type:'ERC-20'},
   {type:'token',address:'0x'+'b'.repeat(40),name:'APLD NFT',symbol:'APLD',token_type:'ERC-721'}]);
 }});
 assert.equal(rh.length,1);
 assert.equal(rh[0].network,'robinhood');
 assert.equal(rh[0].chainId,4663);
});

test('explorer discovery fails closed on malformed or unavailable provider responses',async()=>{
 await assert.rejects(discover.searchExplorer('arc','ArcTools',{fetchImpl:async()=>response({},200)}),/response invalid/);
 await assert.rejects(discover.searchExplorer('arc','ArcTools',{fetchImpl:async()=>response({},503)}),/unavailable/);
 await assert.rejects(discover.searchExplorer('arc','x',{fetchImpl:async()=>response([])}),/Invalid discovery query/);
});

test('Blockscout candidates never gain official status from explorer verification flags',async()=>{
 const original=global.fetch;
 global.fetch=async()=>response([{type:'token',address:'0x'+'f'.repeat(40),name:'Fake Floki',symbol:'FLOKI',token_type:'ERC-20',is_smart_contract_verified:true}]);
 try{
  const service=require('../search/server/lib/multichain-service');
  const result=await service.discover({network:'ethereum',query:'FLOKI'});
  const fake=result.matches.find(item=>item.address==='0x'+'f'.repeat(40));
  assert.ok(fake);
  assert.equal(fake.identity.status,'NOT_VERIFIED');
  assert.equal(fake.identityVerified,false);
  assert.equal(fake.logoUrl,null);
 }finally{global.fetch=original}
});
