'use strict';
// Read-only live probe for the V3 exit model (lib/liquidity-exit-v3.js) and the dispatcher (lib/liquidity-exit.js).
// Public RPC endpoints only, no credentials; nothing is written, signed or sent. It proves, on the real chain:
//   1. reviewed Uniswap V3 pools verify: factory.getPool identity, pinned block, second-provider agreement, and the
//      off-chain tick replay equals QuoterV2 (amount out AND post-swap price) for small and tick-crossing sizes;
//   2. reproducibility: a second run at the SAME recorded block returns identical state and quotes;
//   3. refusals: a V2 pool given to the V3 engine, Arc/Robinhood, and sizes beyond the bounded depth budget;
//   4. cost: RPC calls and latency per analysis;
//   5. measurement only: identity facts of the unreviewed Robinhood V3-style factories (nothing is registered).
const router=require('../lib/liquidity-exit'),v3=require('../lib/liquidity-exit-v3'),v2=require('../lib/liquidity-exit-v2');
const {rpcUrl}=require('../search/server/lib/chains');
const notice=(title,data)=>console.log('::notice title='+title+'::'+JSON.stringify(data).slice(0,3800));
const WETH='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',USDC='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',E18=10n**18n;
const COHORT=[
 {name:'UniV3 USDC-WETH 0.05 sell WETH ladder',pool:'0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',tokenIn:WETH,required:true},
 {name:'UniV3 USDC-WETH 0.05 sell USDC ladder',pool:'0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',tokenIn:USDC,required:true},
 {name:'UniV3 USDC-WETH 0.05 sell 300 and 1500 WETH',pool:'0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',tokenIn:WETH,amountsIn:[(300n*E18).toString(),(1500n*E18).toString()],required:false},
 {name:'UniV3 USDC-WETH 0.30 sell WETH ladder',pool:'0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8',tokenIn:WETH,required:false},
 {name:'UniV3 WBTC-WETH 0.30 sell WETH ladder',pool:'0xcbcdf9626bc03e24f779434178a73a0b4bad62ed',tokenIn:WETH,required:false},
 {name:'UniV3 PEPE-WETH 0.30 sell PEPE ladder',pool:'0x11950d141ecb863f01007add7d1a342041227b58',tokenIn:'0x6982508145454ce325ddbe47a25d4ec3d2311933',required:false},
 {name:'UniV3 USDC-USDT 0.01 sell USDC ladder',pool:'0x3416cf6c708da44db2624d63ea0aaef7113527c6',tokenIn:USDC,required:false},
 {name:'UniV2 USDC-WETH via dispatcher',pool:'0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc',tokenIn:WETH,required:true}
];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pct=(sorted,p)=>sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)];
async function raw(url,method,params){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000)});
 const body=await r.json();if(body.error)throw Error(String(body.error.message||'rpc error').slice(0,80));return body.result;
}
(async()=>{
 const out={generatedAt:new Date().toISOString(),verified:[],refusals:[],candidates:{}};let hardFailure=false;const latencies=[],calls=[];
 for(const item of COHORT){
  const entry={name:item.name};
  const args={network:'ethereum',pool:item.pool,tokenIn:item.tokenIn,amountsIn:item.amountsIn,deadlineMs:30000,timeoutMs:8000};
  try{
   const first=await router.analyze(args);
   latencies.push(first.cost.ms);calls.push(first.cost.rpcCalls);
   await sleep(700);
   const again=await router.analyze({...args,pinnedBlock:first.block.number});
   const stateOf=r=>JSON.stringify(r.state||r.reserves);
   const reproducible=again.block.hash===first.block.hash&&stateOf(again)===stateOf(first)&&JSON.stringify(again.quotes)===JSON.stringify(first.quotes);
   Object.assign(entry,{ok:reproducible,model:first.model,protocol:first.pool.protocol,feeBps:first.pool.feeBps,block:first.block.number,blockHash:first.block.hash.slice(0,18),
    evidenceClass:first.evidence.class,crossCheck:first.evidence.crossCheck.state,crossCheckReason:first.evidence.crossCheck.reasonCode,
    state:first.state?{tick:first.state.tick,L:first.state.activeLiquidity,words:first.state.bitmapWordsRead,ticks:first.state.ticksRead}:undefined,
    quotes:first.quotes.map(q=>({in:q.amountIn,out:q.amountOut,impactPpm:q.priceImpactPpm,totalPpm:q.totalVsMidPpm,crossed:q.initializedTicksCrossed,
     quoterCrossed:q.quoterTicksCrossed,match:q.quoterMatch??q.routerMatch})),
    reproducible,rpcCalls:first.cost.rpcCalls,ms:first.cost.ms});
  }catch(e){
   const f=router.classifyFailure(e);
   // A bounded-depth refusal is a correct fail-closed answer, not a defect; a model mismatch always is.
   Object.assign(entry,{ok:f.reasonCode==='V3_DEPTH_BUDGET_EXCEEDED'&&!item.required,refused:true,...f});
   if(f.state==='CONFLICTING_EVIDENCE')hardFailure=true;
  }
  if(!entry.ok&&item.required)hardFailure=true;
  out.verified.push(entry);notice('exit-v3-'+item.name.replace(/[^A-Za-z0-9]+/g,'-'),entry);
  await sleep(900);
 }
 const refusal=async(name,run,expect)=>{
  let result;
  try{await run();result={name,ok:false,reasonCode:'UNEXPECTED_QUOTE'};}
  catch(e){const f=router.classifyFailure(e);result={name,ok:expect.includes(f.reasonCode),...f};}
  if(!result.ok&&result.state!=='PROVIDER_UNAVAILABLE')hardFailure=true;
  out.refusals.push(result);await sleep(700);
 };
 await refusal('V2 pool given to the V3 engine',()=>v3.analyze({network:'ethereum',pool:COHORT[7].pool,tokenIn:WETH,deadlineMs:20000,timeoutMs:8000}),['NOT_V3_COMPATIBLE_POOL']);
 await refusal('V3 pool given to the V2 engine',()=>v2.analyze({network:'ethereum',pool:COHORT[0].pool,tokenIn:WETH,deadlineMs:20000,timeoutMs:8000}),['NOT_V2_COMPATIBLE_POOL']);
 await refusal('size beyond bounded depth (5,000,000 WETH)',()=>router.analyze({network:'ethereum',pool:COHORT[0].pool,tokenIn:WETH,amountsIn:[(5000000n*E18).toString()],deadlineMs:30000,timeoutMs:8000}),['V3_DEPTH_BUDGET_EXCEEDED','V3_INSUFFICIENT_LIQUIDITY']);
 await refusal('Robinhood: no reviewed protocol',()=>router.analyze({network:'robinhood',pool:'0x10cc6bd38112cac182db90b6a71d8bb5939526ba',tokenIn:'0x39dbed3a2bd333467115de45665cc57f813c4571'}),['NO_REVIEWED_PROTOCOL']);
 await refusal('Arc: no reviewed protocol',()=>router.analyze({network:'arc',pool:COHORT[0].pool,tokenIn:WETH}),['NO_REVIEWED_PROTOCOL']);
 notice('exit-v3-refusals',out.refusals);
 const sorted=[...latencies].sort((a,b)=>a-b);
 out.cost={analyses:latencies.length,p50Ms:sorted.length?pct(sorted,0.5):null,p95Ms:sorted.length?pct(sorted,0.95):null,maxMs:sorted.at(-1)??null,
  rpcCallsMin:calls.length?Math.min(...calls):null,rpcCallsMax:calls.length?Math.max(...calls):null};
 notice('exit-v3-cost',out.cost);

 // Measurement only (Robinhood): do the provider-listed V3-style pools resolve through the factory they name?
 // This is evidence for a later owner review of those factories; it does not make them reviewed.
 const S=v3.SELECTORS,pad=a=>a.slice(2).toLowerCase().padStart(64,'0'),url=rpcUrl('robinhood');
 for(const pool of ['0x10cc6bd38112cac182db90b6a71d8bb5939526ba','0xf2a0be59ab76b96f957bd5e5b967f2b75e8db269']){
  const row={};
  try{
   const call=(to,data)=>raw(url,'eth_call',[{to,data},'latest']);
   row.factory='0x'+(await call(pool,S.factory)).slice(-40);
   const t0='0x'+(await call(pool,S.token0)).slice(-40),t1='0x'+(await call(pool,S.token1)).slice(-40);
   row.fee=Number(BigInt(await call(pool,S.fee)));
   try{row.tickSpacing=Number(BigInt.asIntN(24,BigInt(await call(pool,S.tickSpacing))));}catch(e){row.tickSpacing='ERR '+e.message;}
   try{row.slot0Words=((await call(pool,S.slot0)).length-2)/64;}catch(e){row.slot0Words='ERR '+e.message;}
   try{row.factoryGetPoolMatches=('0x'+(await call(row.factory,S.getPool+pad(t0)+pad(t1)+row.fee.toString(16).padStart(64,'0'))).slice(-40))===pool;}catch(e){row.factoryGetPoolMatches='ERR '+e.message;}
   try{row.factoryCodeBytes=((await raw(url,'eth_getCode',[row.factory,'latest'])).length-2)/2;}catch{}
  }catch(e){row.error=String(e.message).slice(0,100);}
  out.candidates[pool]=row;await sleep(500);
 }
 notice('exit-v3-robinhood-candidates',out.candidates);
 console.log(JSON.stringify(out,null,1));
 if(hardFailure){console.error('::error::Liquidity & Exit V3 live probe failed a required check');process.exit(1);}
})().catch(e=>{console.error('::error::probe crashed: '+String(e&&e.message).slice(0,200));process.exit(1);});
