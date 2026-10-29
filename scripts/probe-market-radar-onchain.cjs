#!/usr/bin/env node
'use strict';
// Live measurement of the first-party onchain Market Radar (issue #89).
// Usage: node scripts/probe-market-radar-onchain.cjs [arc|ethereum|robinhood ...]
//        node scripts/probe-market-radar-onchain.cjs --json > radar-live.json
// Needs outbound HTTPS to each chain RPC (ETH_RPC_URL / ARC_RPC_URL / ROBINHOOD_RPC_URL
// override the public defaults). Read-only; nothing is written or published.
const radar=require('../lib/market-radar-onchain');
const args=process.argv.slice(2),json=args.includes('--json');
const networks=args.filter(a=>!a.startsWith('--'));
const targets=networks.length?networks:['arc','ethereum','robinhood'];
const FIELDS=['symbol','name','address','priceUsd','volume24hUsd','liquidityUsd','change24hPct','logo','pool','dex','provider','asOf'];
(async()=>{
 const report={};
 for(const network of targets){
  const started=Date.now();
  try{
   const out=await radar.inspect(network);
   const fields=Object.fromEntries(FIELDS.map(f=>[f,out.tokens.filter(t=>t[f]!==null&&t[f]!==undefined&&t[f]!=='').length]));
   report[network]={ok:true,ms:Date.now()-started,tokens:out.tokens.length,window:out.window,coverage:out.coverage,diagnostics:out._diagnostics,referencePrices:out.referencePrices,anchors:out.anchors,fieldCompleteness:fields,top:out.tokens.map(t=>({rank:t.rank,symbol:t.symbol,address:t.address,volume24hUsd:t.volume24hUsd,priceUsd:t.priceUsd,change24hPct:t.change24hPct,pool:t.pool}))};
  }catch(error){report[network]={ok:false,ms:Date.now()-started,reasonCode:error.code||'RADAR_SOURCE_UNAVAILABLE',detail:error.detail||radar.sanitize(error.message,200),diagnostics:error.diagnostics||null};}
 }
 console.log(JSON.stringify(report,null,json?0:2));
 process.exitCode=Object.values(report).some(r=>r.ok)?0:1;
})();
