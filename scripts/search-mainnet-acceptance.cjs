'use strict';
const service=require('../search/server/lib/multichain-service');
const checks=[
 {network:'arc',address:'0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b',ticker:'ARCY'},
 {network:'ethereum',address:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',ticker:'USDC'},
 {network:'robinhood',address:'0xb8dbf92f9741c9ac1c32115e78581f23509916fd',ticker:'APLD'}
];
async function check({network,address,ticker}){
 const start=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
 try{
  const result=await Promise.race([service.report({network,address}),new Promise((_,reject)=>{
   controller.signal.addEventListener('abort',()=>reject(Error('90s source deadline')),{once:true});
  })]);
  if(result.ok!==true||result.address!==address.toLowerCase()||result.network!==network||
   result.cardCount!==5||!result.token?.symbol)throw Error('Contract identity/report mismatch');
  const counts=Object.fromEntries(Object.entries(result.cards).map(([card,obj])=>{
   const list=Object.values(obj.fields);
   if(list.length!==4)throw Error('Incorrect field count in '+card);
   return [card,{known:list.filter(x=>x.dataState==='DATA_FOUND').length,total:list.length}]
  }));
  const total=Object.values(counts).reduce((n,x)=>n+x.known,0);
  return {ticker,network,ok:true,sourceBacked:total,fields:20,cards:counts,elapsedMs:Date.now()-start};
 }catch(e){
  return {ticker,network,ok:false,reason:String(e.message||e).slice(0,170),elapsedMs:Date.now()-start}
 }finally{clearTimeout(timer)}
}
(async()=>{
 const r=[];
 // Sequential to respect public provider limits.
 for(const item of checks){const row=await check(item);r.push(row);console.log(JSON.stringify(row));}
 console.log('Original-repo imported Search mainnet reports: '+r.filter(x=>x.ok).length+'/3');
 if(r.some(x=>!x.ok))process.exitCode=1;
})().catch(e=>{console.error(String(e));process.exitCode=1});
