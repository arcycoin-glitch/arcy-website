'use strict';
// #360: the Arc legacy DEX Screener volume carries the fallback's on-chain crossCheck only when it is the same observation (<=0.5%).
const test=require('node:test'),assert=require('node:assert/strict');
const legacy=require('../search/server/lib/arc-legacy-evidence'),market=require('../search/server/lib/arc-market');
const A='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
const ds=v=>({value:v,status:'MARKET_API_VERIFIED',dataState:'DATA_FOUND',source:'DexScreener',evidence:[{url:'https://api.dexscreener.com/x'}]});
async function run(shownVol,fbVol){
 const oldC=legacy.callOriginal,oldI=market.inspect;
 legacy.callOriginal=async()=>({fields:{liquidityUsd:ds(1000),volume24h:ds(shownVol),pairCount:ds(1),lpStatus:{...ds('x'),value:'x'}}});
 market.inspect=async()=>({volume24h:{...ds(fbVol),source:'DEX Screener',crossCheck:{state:'AGREE',providers:['DEX Screener','Arc RPC pool state']}}});
 try{return await require('../search/server/lib/arc-adapter').activity({address:A,base:{address:A}},'liquidity');}
 finally{legacy.callOriginal=oldC;market.inspect=oldI;}
}
test('ARC-VB-1 same DEX Screener observation -> on-chain crossCheck bridged; different value -> not bridged',async()=>{
 let c=await run(5000,5010);const f=c.fields?c.fields.volume24h:c.volume24h;
 assert.equal(f.crossCheck?.state,'AGREE');assert.match(f.crossCheck.bridge,/exact-pool/);
 c=await run(5000,6000);const g=c.fields?c.fields.volume24h:c.volume24h;assert.equal(g.crossCheck,undefined);
});
