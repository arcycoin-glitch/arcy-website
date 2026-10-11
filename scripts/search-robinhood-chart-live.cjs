'use strict';
// Does not generate chart data. Verifies the publicly published Robinhood
// GeckoTerminal pool, retrieves its exact base token and historical pool closes.
const {load}=require('../search/server/lib/price-history');
const {readJson}=require('../search/server/lib/http');
const pool='0x768c65690ad3082305ac63625bf2272ee9efa14e';
const endpoint='https://api.geckoterminal.com/api/v2/networks/robinhood/pools/'+pool;
async function main(){
 const res=await fetch(endpoint,{headers:{accept:'application/json;version=20230203'},
  signal:AbortSignal.timeout(8500)});
 if(!res.ok)throw Error('Robinhood GeckoTerminal pool HTTP '+res.status);
 const body=await readJson(res,512*1024);
 const relationships=body?.data?.relationships||{};
 const base=relationships.base_token?.data?.id||'';
 const quote=relationships.quote_token?.data?.id||'';
 if(!/^robinhood_0x[0-9a-f]{40}$/i.test(base)||!/^robinhood_0x[0-9a-f]{40}$/i.test(quote))
  throw Error('Unmatched Robinhood pool tokens');
 const token=base.slice('robinhood_'.length).toLowerCase();
 const history=await load('robinhood',token,{disableCache:true});
 if(history.network!=='robinhood'||history.chainId!==4663||history.address!==token||
  history.points.length<3||history.source!=='GeckoTerminal'||
  !history.sourceUrl.startsWith('https://www.geckoterminal.com/robinhood/pools/'))
  throw Error('Historical Robinhood chart identity mismatch');
 console.log(JSON.stringify({status:'PASS',network:'robinhood',token,pointCount:history.points.length,
  pool:history.poolAddress,sourceUrl:history.sourceUrl,
  firstCandle:new Date(history.points[0].time*1000).toISOString().slice(0,10),
  lastCandle:new Date(history.points.at(-1).time*1000).toISOString().slice(0,10)}));
}
main().catch(e=>{console.error('ROBINHOOD_CHART_SOURCE_BLOCKED '+String(e.message||e));process.exitCode=1});
