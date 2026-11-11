'use strict';
// Read-only live probe for the V4 exit engine. It discovers provider-reported bytes32 PoolIds for known tokens,
// then proves PoolId -> Initialize PoolKey -> StateView -> official V4Quoter at one pinned block.
// No signing, transaction submission or state mutation.
const exit=require('../lib/liquidity-exit');
const dexs=require('../lib/radar-v2/dexscreener');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const TOKENS={
 arc:['0xf76b1d00bd3d63a37246b5f512074e864010e33d','0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'],
 robinhood:['0x39dbed3a2bd333467115de45665cc57f813c4571']
};
const notice=(title,data)=>console.log('::notice title='+title+'::'+JSON.stringify(data).slice(0,3800));
const pct=(a,p)=>a[Math.min(a.length-1,Math.ceil(a.length*p)-1)];
(async()=>{
 const out={generatedAt:new Date().toISOString(),networks:{},cost:{}};let hard=false;
 const lat=[],calls=[];
 for(const network of ['arc','robinhood']){
  const rows=[];
  for(const token of TOKENS[network]){
   try{
    const m=await dexs.tokens(network,[token],{}),pairs=(m.get(token)||[]).filter(p=>/^0x[0-9a-f]{64}$/i.test(p.pair));
    for(const p of pairs)rows.push({token,pair:p.pair,liquidityUsd:p.liquidityUsd,dexId:p.dexId});
   }catch(e){rows.push({token,error:e.code||e.message});}
   await sleep(400);
  }
  const unique=[...new Map(rows.filter(x=>x.pair).map(x=>[x.pair,x])).values()].sort((a,b)=>(b.liquidityUsd||0)-(a.liquidityUsd||0));
  const results=[];
  for(const candidate of unique.slice(0,3)){
   const row={...candidate};
   try{
    const first=await exit.analyze({network,pool:candidate.pair,tokenIn:candidate.token,deadlineMs:30000,timeoutMs:8000});
    lat.push(first.cost.ms);calls.push(first.cost.rpcCalls);
    await sleep(500);
    const again=await exit.analyze({network,pool:candidate.pair,tokenIn:candidate.token,pinnedBlock:first.block.number,deadlineMs:30000,timeoutMs:8000});
    const reproducible=again.block.hash===first.block.hash&&JSON.stringify(again.state)===JSON.stringify(first.state)&&JSON.stringify(again.quotes)===JSON.stringify(first.quotes);
    Object.assign(row,{ok:reproducible&&first.quotes.some(q=>q.state==='VERIFIED'),model:first.model,block:first.block.number,
     poolKey:{currency0:first.pool.currency0,currency1:first.pool.currency1,fee:first.pool.fee,tickSpacing:first.pool.tickSpacing,hooks:first.pool.hooks},
     evidenceClass:first.evidence.class,crossCheck:first.evidence.crossCheck.state,verifiedQuotes:first.quotes.filter(q=>q.state==='VERIFIED').length+'/'+first.quotes.length,
     fee:first.fee,rpcCalls:first.cost.rpcCalls,ms:first.cost.ms,reproducible});
   }catch(e){Object.assign(row,{ok:false,...exit.classifyFailure(e)});}
   results.push(row);notice('exit-v4-'+network+'-'+candidate.pair.slice(2,10),row);
   await sleep(600);
  }
  const verified=results.filter(x=>x.ok);
  out.networks[network]={candidates:unique.length,checked:results.length,verified:verified.length,results};
  // Arc is the release gate. Robinhood V4 is additive: V3 is already verified there, so lack of a discovered V4
  // candidate is not a hard failure; any discovered candidate that verifies is recorded.
  if(network==='arc'&&!verified.length)hard=true;
 }
 const sorted=[...lat].sort((a,b)=>a-b);
 out.cost={analyses:lat.length,p50Ms:sorted.length?pct(sorted,.5):null,p95Ms:sorted.length?pct(sorted,.95):null,maxMs:sorted.at(-1)??null,
  rpcCallsMin:calls.length?Math.min(...calls):null,rpcCallsMax:calls.length?Math.max(...calls):null};
 notice('exit-v4-cost',out.cost);
 console.log(JSON.stringify(out,null,2));
 if(hard){console.error('::error::Arc V4 release gate: no independently verified live V4 pool');process.exit(1);}
})().catch(e=>{console.error('::error::V4 probe crashed: '+String(e&&e.stack||e).slice(0,800));process.exit(1);});
