'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const radar=require('../lib/market-radar');
const networks=[['arc',5042],['ethereum',1],['robinhood',4663]];
const addr=i=>'0x'+i.toString(16).padStart(40,'0');
function mockBody(network,{count=14,duplicate=false}={}){
 const id=radar.IDS[network].id;
 const included=[],data=[];
 for(let i=0;i<count;i++){
  const a=addr(duplicate?Math.floor(i/2)+1:i+1);
  const tokenId=id+'_'+a;
  included.push({id:tokenId,type:'token',attributes:{address:a,name:'Token '+i,symbol:'T'+i}});
  data.push({id:id+'_'+addr(500+i),type:'pool',
   attributes:{address:addr(500+i),base_token_price_usd:'0.002',reserve_in_usd:'1500',
    volume_usd:{h24:String(100000-i*100)},price_change_percentage:{h24:'-3.2'}},
   relationships:{base_token:{data:{id:tokenId,type:'token'}}}});
 }
 return {data,included};
}
for(const [network,chainId] of networks){
 test(network+' Radar returns exactly 10 unique contract-bound results with rank and chain',()=>{
  const out=radar.ranked([mockBody(network,{count:20,duplicate:true}),mockBody(network)],network);
  assert.equal(out.tokens.length,10);
  assert.equal(new Set(out.tokens.map(x=>x.address)).size,10);
  assert(out.tokens.every(x=>x.network===network&&x.chainId===chainId));
  assert(out.tokens.every((x,i)=>x.rank===i+1));
  assert(out.tokens.every((x,i,a)=>i===0||a[i-1].volume24hUsd>=x.volume24hUsd));
  assert.equal(out.poolsInspected,34);
 });
}
test('Wrong-chain contract IDs, negative volumes and malformed pool addresses do not publish',()=>{
 const b=mockBody('arc',{count:3});
 b.included[0].id='eth_'+addr(1);
 b.data[1].attributes.volume_usd.h24='-10';
 b.data[2].attributes.address='bad';
 assert.equal(radar.ranked([b],'arc').tokens.length,0);
});
test('Mismatched claimed contract identity is excluded',()=>{
 const b=mockBody('ethereum',{count:1});
 b.included[0].attributes.address=addr(555);
 assert.equal(radar.ranked([b],'ethereum').tokens.length,0);
});
test('Never manufactures full-chain volume or adds same-token pool volume',()=>{
 const b=mockBody('robinhood',{count:2,duplicate:true});
 const result=radar.ranked([b],'robinhood');
 assert.equal(result.tokens.length,1);
 assert.equal(result.tokens[0].volume24hUsd,100000);
 assert.equal(result.poolsInspected,2);
});
test('Malformed provider data fails closed',()=>{
 assert.throws(()=>radar.ranked([{data:null,included:[]}],'arc'));
 assert.throws(()=>radar.takePage({data:[],included:null},'arc'));
});
test('Unconfigured provider key cannot be bypassed; unsupported networks rejected',async()=>{
 await assert.rejects(radar.load('bsc',{apiKey:'x',disableCache:true}),/INVALID_NETWORK/);
 await assert.rejects(radar.load('arc',{apiKey:'',disableCache:true}),/KEY_REQUIRED/);
});
test('Three chain endpoint paths, source identity and timestamp are stable',async()=>{
 for(const [network,chainId] of networks){
  const calls=[];
  const fetcher=async(url,opts)=>{
   calls.push({url,headers:opts.headers});
   return {ok:true,json:async()=>mockBody(network,{count:12})};
  };
  const response=await radar.load(network,{apiKey:'not-a-real-key',fetcher,disableCache:true,now:Date.UTC(2026,9,28),pageCount:1});
  assert.equal(response.network,network);assert.equal(response.chainId,chainId);
  assert.equal(response.tokens.length,10);assert.equal(response.pagesInspected,1);
  assert.equal(response.asOf,'2026-10-28T00:00:00.000Z');
  assert(calls[0].url.includes('/networks/'+radar.IDS[network].id+'/pools?sort=h24_volume_usd_desc'));
  assert.equal(calls[0].headers['x-cg-pro-api-key'],'not-a-real-key');
  assert(response.selection.includes('Not whole-chain'));
 }
});
test('API denies public data before license and never contacts provider',async()=>{
 const handler=require('../search/server/api/radar');
 let status=0,reply=null,headers={};
 const res={setHeader(k,v){headers[k]=v;return this},status(code){status=code;return this},
 json(v){reply=v;return this}};
 const previous={display:process.env.MARKET_RADAR_PUBLIC_DISPLAY_APPROVED,json:process.env.MARKET_RADAR_JSON_DELIVERY_APPROVED,key:process.env.COINGECKO_PRO_API_KEY};
 try{
  delete process.env.MARKET_RADAR_PUBLIC_DISPLAY_APPROVED;
  delete process.env.MARKET_RADAR_JSON_DELIVERY_APPROVED;
  delete process.env.COINGECKO_PRO_API_KEY;
  await handler({method:'GET',query:{chain:'arc'}},res);
  assert.equal(status,503);assert.equal(reply.error,'RADAR_NOT_CONFIGURED');
  assert.equal(headers['Cache-Control'],'no-store');
  await handler({method:'GET',query:{chain:'bsc'}},res);
  assert.equal(status,400);
 }finally{
  for(const [name,value] of Object.entries({MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:previous.display,
   MARKET_RADAR_JSON_DELIVERY_APPROVED:previous.json,COINGECKO_PRO_API_KEY:previous.key})){
    if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
 }
});
