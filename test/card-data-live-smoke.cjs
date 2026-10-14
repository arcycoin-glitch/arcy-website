'use strict';
// Read-only diagnostic: upstream RPC or Blockscout outages do not imply zero.
const {rpc}=require('../search/server/lib/eth');
const oracle=require('../search/server/lib/oracle-market');
const probes=[
 ['UNI','0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'],
 ['CRV','0xd533a949740bb3306d119cc777fa900ba034cd52']
];
(async()=>{
 let block;
 try{block=await rpc('eth_blockNumber',[],{timeoutMs:7000});}
 catch(e){console.log(JSON.stringify({kind:'Ethereum pinned oracle probe',state:'SOURCE_UNAVAILABLE',reason:String(e.message).slice(0,100)}));return;}
 for(const [symbol,token] of probes){
  try{
   const result=await oracle.inspect(token,block,{now:Date.now()});
   const price=result?.priceUsd;
   console.log(JSON.stringify({kind:'Ethereum pinned oracle probe',token:symbol,block,
    dataState:price?.dataState||'NOT_VERIFIED',value:price?.dataState==='DATA_FOUND'?price.value:null,
    source:price?.source||null,reasonCode:price?.reasonCode||null,
    feed:price?.evidence?.[0]?.feed||null}));
  }catch(e){console.log(JSON.stringify({kind:'Ethereum pinned oracle probe',token:symbol,
   state:'SOURCE_API_FAILED',reason:String(e.message).slice(0,100)}));}
 }
})();
