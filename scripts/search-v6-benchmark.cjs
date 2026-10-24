'use strict';
// Reproducible same-permission V5/V6 application-pipeline comparison. Latency
// here is service delivery, not a substitute for actual browser DOM timing.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),label=process.argv[2];
if(!['before','after'].includes(label))throw Error('Expected before or after');
const source=label==='before'?path.resolve(root,'../arcy-search-v6-baseline'):root;
const service=require(path.join(source,'search/server/lib/multichain-service'));
const samples=[],calls=[],realFetch=fetch;
const labelFor=url=>{const host=new URL(url).hostname;return host.includes('sourcify')?'source':host.includes('dexscreener')?'dex':host.includes('geckoterminal')?'market':host.includes('blockscout')||host.includes('explorer')||host.includes('arcscan')?'explorer':host.includes('robinhood')?'robinhood':host.includes('arc.io')?'arc_rpc':host.includes('publicnode')?'ethereum_rpc':'other'};
global.fetch=async(...args)=>{const start=performance.now();let row={provider:labelFor(String(args[0]))};try{const r=await realFetch(...args);Object.assign(row,{status:r.status,ms:Math.round(performance.now()-start)});return r}catch(e){Object.assign(row,{status:0,error:/Timeout|Abort/.test(e.name)?'timeout':'transport',ms:Math.round(performance.now()-start)});throw e}finally{calls.push(row)}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 for(let round=0;round<3;round++)for(const[network,symbol,address]of require('../test/fixtures/search-v5-contracts.json')){
  const start=performance.now(),events=[],row={round,network,symbol,address};
  try{row.report=await service.report({network,address,onProgress:e=>events.push({phase:e.phase,ms:Math.round(performance.now()-start),available:Object.values(e.report?.cards?.[e.phase]?.fields||{}).filter(f=>f.dataState==='DATA_FOUND').length})});row.ok=true}catch(e){row.ok=false;row.error='REPORT_FAILED'}
  row.fullMs=Math.round(performance.now()-start);row.firstUsefulMs=events.find(e=>e.phase==='identity')?.ms;row.marketMs=events.find(e=>['liquidity','activity'].includes(e.phase)&&e.available)?.ms;row.events=events;samples.push(row);
  let diagnostics=null;try{diagnostics=require(path.join(source,'search/server/lib/diagnostics')).snapshot()}catch{}
  fs.writeFileSync(path.join(root,'artifacts/v6-'+label+'.json'),JSON.stringify({profile:{vercel:process.env.VERCEL,dex:process.env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED==='true',goPlus:process.env.GOPLUS_PUBLIC_DISPLAY_APPROVED==='true'},providerTimingBasis:'fetch response headers; body verification remains in full report timing',samples,calls,diagnostics},null,2));
  console.log(label,round,network,symbol,row.ok,row.firstUsefulMs,row.fullMs);
  await sleep(Math.max(1500,6000-(performance.now()-start)));
 }
})().catch(e=>{console.error(e.name);process.exitCode=1});
