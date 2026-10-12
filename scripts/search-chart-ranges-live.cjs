'use strict';
// On a real, highly liquid Ethereum WETH pool, verify all four GeckoTerminal
// resolutions. Never substitute user-visible generated candles.
const {load,RANGES}=require('../search/server/lib/price-history');
const ADDRESS='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 const results=[];
 for(const range of ['30D','1W','1D','4H']){
  try{
   // Exercise the same two-minute per-contract/pool cache that the actual
   // Search API uses. Disabling it multiplied upstream pool lookups and made
   // false-negative HTTP 429 runs likely on shared CI egress.
   const output=await load('ethereum',ADDRESS,{range});
   if(output.network!=='ethereum'||output.chainId!==1||output.range!==range||
    output.interval!==RANGES[range].interval||output.address!==ADDRESS||
    output.source!=='GeckoTerminal'||output.points.length<3||
    output.points.length>RANGES[range].limit||
    !output.points.every(p=>p.close>0&&Number.isFinite(p.close)))throw Error('Exact-token range integrity mismatch');
   const row={range,status:'PASS',interval:output.interval,points:output.points.length,
    first:new Date(output.points[0].time*1000).toISOString(),
    last:new Date(output.points.at(-1).time*1000).toISOString(),
    pool:output.poolAddress};
   results.push(row);
   console.log(JSON.stringify(row));
  }catch(e){
   results.push({range,status:'SOURCE_UNAVAILABLE',reason:String(e.message||e).slice(0,140)});
   console.log(JSON.stringify(results.at(-1)));
  }
  await pause(1200);
 }
 const passed=results.filter(x=>x.status==='PASS').length;
 console.log('Live contract-matched GeckoTerminal timeframes: '+passed+'/4');
 if(passed!==4)process.exitCode=1;
}
main().catch(e=>{console.error(String(e));process.exitCode=1});
