'use strict';
// Read-only evidence probe (CI): (1) DEX Screener vs GeckoTerminal agreement per sample token via the production market-cross module,
// (2) A/X explorer holder-count availability for Arc tokens that have no signed holder snapshot. Output = GitHub annotations.
process.env.SEARCH_MARKET_CROSSCHECK_APPROVED='true';
const mc=require('../search/server/lib/market-cross'),count=require('../search/server/lib/arc-holder-count');
const SAMPLE=[['ethereum','USDC','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],['ethereum','UNI','0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'],['ethereum','ONDO','0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3'],
 ['robinhood','PONS','0x39dbed3a2bd333467115de45665cc57f813c4571'],['arc','ARCY','0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'],['arc','POLL','0xf76b1d00bd3d63a37246b5f512074e864010e33d']];
const AX=[['omni','0x3a829bc2343bd3c9d9a81d4a18c7f72bebf66777'],['ASTOCK','0x4c9b47dbd5933aa4574b2c27f82419e4dbbd0222'],['KAIRO','0x3ead4e80e9e5bc0e01682d7ee74c4881b040d3ea'],['ARCLIGHT','0xa3de1dda14e4b3ce2eee2f8c1e49315effc15be2']];
(async()=>{
 let agree=0,total=0;
 for(const [net,sym,addr] of SAMPLE){
  try{const f=await mc.inspect(net,addr);
   const row=['liquidityUsd','volume24h','priceUsd'].map(k=>{const x=f[k];total++;const s=x?.crossCheck?.state||(x?.dataState==='DATA_FOUND'?'NO_CROSSCHECK':'MISSING');if(s==='AGREE')agree++;return `${k}:${s}${x?.crossCheck?.relativeDifference!==undefined?'('+x.crossCheck.relativeDifference+')':''}${x?.crossCheck?.reasonCode?'['+x.crossCheck.reasonCode+']':''}`;});
   console.log(`::notice::crosscheck ${net} ${sym} ${row.join(' ')}`);
  }catch(e){console.log(`::warning::crosscheck ${net} ${sym} failed ${String(e.message).slice(0,80)}`);}
  await new Promise(r=>setTimeout(r,2500));
 }
 console.log(`::notice::crosscheck summary AGREE ${agree}/${total} fields`);
 for(const [sym,addr] of AX){
  try{const r=await count.fetchCount(addr);console.log(`::notice::arc holder-count ${sym}: ${r?`${r.value} (${r.source})`:'unavailable'}`);}catch(e){console.log(`::warning::arc holder-count ${sym} failed`);}
 }
})();
