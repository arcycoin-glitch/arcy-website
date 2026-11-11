'use strict';
// Read-only live probe for Liquidity & Exit V2 (lib/liquidity-exit-v2.js). Public RPC endpoints only, no credentials,
// nothing is written, signed or sent. It proves, on the real chain:
//   1. reviewed pools verify: factory registry, pinned block, second-provider agreement, router-equal quotes;
//   2. the result is reproducible: a second run at the SAME recorded block returns identical reserves and quotes,
//      and an independent re-derivation of the formula in this script (Uniswap's 997/1000 form) gives the same output;
//   3. negative controls fail closed (a V3 pool, an address without code, a token that is not in the pool);
//   4. cost: RPC calls and latency per analysis;
//   5. measurement only: which factories the provider-listed Arc / Robinhood pools report (candidates for a later
//      review; nothing is added to the reviewed registry by this script).
const exit=require('../lib/liquidity-exit-v2');
const {rpcUrl}=require('../search/server/lib/chains');
const notice=(title,data)=>console.log('::notice title='+title+'::'+JSON.stringify(data).slice(0,3800));
const WETH='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',USDC='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const COHORT=[
 {name:'UniswapV2 USDC/WETH sell WETH',pool:'0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc',tokenIn:WETH,protocol:'uniswap-v2',required:true},
 {name:'UniswapV2 USDC/WETH sell USDC',pool:'0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc',tokenIn:USDC,protocol:'uniswap-v2',required:true},
 {name:'UniswapV2 PEPE/WETH sell PEPE',pool:'0xa43fe16908251ee70ef74718545e4fe6c5ccec9f',tokenIn:'0x6982508145454ce325ddbe47a25d4ec3d2311933',protocol:'uniswap-v2',required:false},
 {name:'SushiSwapV2 SUSHI/WETH sell SUSHI',pool:'0x795065dcc9f64b5614c407a6efdc400da6221fb0',tokenIn:'0x6b3595068778dd592e39a122f4f5a5cf09c90fe2',protocol:'sushiswap-v2',required:false}
];
const NEGATIVE=[
 {name:'UniswapV3 USDC/WETH 0.05% pool',pool:'0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',tokenIn:WETH,expect:['NOT_V2_COMPATIBLE_POOL']},
 {name:'address without code',pool:'0x000000000000000000000000000000000000dead',tokenIn:WETH,expect:['POOL_HAS_NO_CODE']},
 {name:'token not in the pool',pool:'0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc',tokenIn:'0x6982508145454ce325ddbe47a25d4ec3d2311933',expect:['TOKEN_NOT_IN_POOL']}
];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pct=(sorted,p)=>sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)];
// Independent re-derivation: the UniswapV2Library form (amountIn*997*reserveOut)/(reserveIn*1000+amountIn*997).
const library=(amountIn,reserveIn,reserveOut)=>(amountIn*997n*reserveOut)/(reserveIn*1000n+amountIn*997n);
async function raw(url,method,params){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000)});
 const body=await r.json();if(body.error)throw Error(String(body.error.message||'rpc error').slice(0,80));return body.result;
}
(async()=>{
 const out={generatedAt:new Date().toISOString(),verified:[],negative:[],candidates:{}};let hardFailure=false;const latencies=[],calls=[];
 for(const item of COHORT){
  const entry={name:item.name};
  try{
   const first=await exit.analyze({network:'ethereum',pool:item.pool,tokenIn:item.tokenIn,deadlineMs:20000,timeoutMs:8000});
   latencies.push(first.cost.ms);calls.push(first.cost.rpcCalls);
   const [rIn,rOut]=item.tokenIn===first.pool.token0?[BigInt(first.reserves.reserve0),BigInt(first.reserves.reserve1)]:[BigInt(first.reserves.reserve1),BigInt(first.reserves.reserve0)];
   const rederived=first.quotes.every(q=>library(BigInt(q.amountIn),rIn,rOut).toString()===q.amountOut);
   await sleep(600);
   const again=await exit.analyze({network:'ethereum',pool:item.pool,tokenIn:item.tokenIn,pinnedBlock:first.block.number,deadlineMs:20000,timeoutMs:8000});
   latencies.push(again.cost.ms);calls.push(again.cost.rpcCalls);
   const reproducible=again.block.hash===first.block.hash&&JSON.stringify(again.reserves)===JSON.stringify(first.reserves)&&JSON.stringify(again.quotes)===JSON.stringify(first.quotes);
   Object.assign(entry,{ok:true,protocol:first.pool.protocol,block:first.block.number,blockHash:first.block.hash,headAgeSeconds:first.block.ageSeconds,
    evidenceClass:first.evidence.class,crossCheck:first.evidence.crossCheck.state,crossCheckReason:first.evidence.crossCheck.reasonCode,
    reserve0:first.reserves.reserve0,reserve1:first.reserves.reserve1,lastUpdateAgeSeconds:first.reserves.lastUpdateAgeSeconds,
    surplus:[first.reserves.unsyncedSurplus0,first.reserves.unsyncedSurplus1],
    quotes:first.quotes.map(q=>({share:q.shareOfReserveInPpm,in:q.amountIn,out:q.amountOut,impactPpm:q.priceImpactPpm,totalPpm:q.totalVsMidPpm,router:q.routerMatch})),
    rederived,reproducible,rpcCalls:first.cost.rpcCalls,ms:first.cost.ms});
   if(first.pool.protocol!==item.protocol||!rederived||!reproducible)entry.ok=false;
  }catch(e){Object.assign(entry,{ok:false,...exit.classifyFailure(e)});}
  if(!entry.ok&&item.required)hardFailure=true;
  out.verified.push(entry);notice('exit-v2-'+item.name.replace(/[^A-Za-z0-9]+/g,'-'),entry);
  await sleep(800);
 }
 for(const item of NEGATIVE){
  let result;
  try{await exit.analyze({network:'ethereum',pool:item.pool,tokenIn:item.tokenIn,deadlineMs:20000,timeoutMs:8000});result={name:item.name,ok:false,reasonCode:'UNEXPECTED_QUOTE'};}
  catch(e){const f=exit.classifyFailure(e);result={name:item.name,ok:item.expect.includes(f.reasonCode),...f};}
  // A provider outage is not a wrong answer; only an actual quote or a wrong refusal reason is a hard failure.
  if(!result.ok&&result.state!=='PROVIDER_UNAVAILABLE')hardFailure=true;
  out.negative.push(result);await sleep(800);
 }
 notice('exit-v2-negative-controls',out.negative);
 for(const network of ['arc','robinhood']){
  try{await exit.analyze({network,pool:COHORT[0].pool,tokenIn:WETH});hardFailure=true;}
  catch(e){const f=exit.classifyFailure(e);out[network+'Refusal']=f;if(f.reasonCode!=='NO_REVIEWED_V2_PROTOCOL')hardFailure=true;}
 }
 const sorted=[...latencies].sort((a,b)=>a-b);
 out.cost={analyses:latencies.length,p50Ms:sorted.length?pct(sorted,0.5):null,p95Ms:sorted.length?pct(sorted,0.95):null,maxMs:sorted.at(-1)??null,
  rpcCallsMin:calls.length?Math.min(...calls):null,rpcCallsMax:calls.length?Math.max(...calls):null};
 notice('exit-v2-cost',out.cost);

 // Measurement only: factories behind provider-listed pools on Arc and Robinhood (not trusted, not registered).
 const TARGETS={arc:{slug:'arc',token:'0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'},robinhood:{slug:'robinhood',token:'0x39dbed3a2bd333467115de45665cc57f813c4571'}};
 for(const [network,target] of Object.entries(TARGETS)){
  const rows=[];
  try{
   const r=await fetch('https://api.dexscreener.com/token-pairs/v1/'+target.slug+'/'+target.token,{signal:AbortSignal.timeout(12000)});
   const pairs=r.ok?await r.json():[];
   for(const p of (Array.isArray(pairs)?pairs:[]).slice(0,6)){
    const row={dex:String(p.dexId||'').slice(0,30),labels:(p.labels||[]).slice(0,3),pair:String(p.pairAddress||'').slice(0,66)};
    if(/^0x[0-9a-f]{40}$/i.test(row.pair)){
     try{row.factory='0x'+(await raw(rpcUrl(network),'eth_call',[{to:row.pair,data:exit.SELECTORS.factory},'latest'])).slice(-40);}catch(e){row.factory='ERR '+e.message;}
     try{row.getReserves=(await raw(rpcUrl(network),'eth_call',[{to:row.pair,data:exit.SELECTORS.getReserves},'latest'])).length===194;}catch{row.getReserves=false;}
     await sleep(400);
    }else row.note='not a 20-byte pool address (V4 pool id)';
    rows.push(row);
   }
   out.candidates[network]={http:r.status,pairs:rows};
  }catch(e){out.candidates[network]={error:String(e.message).slice(0,100)};}
  notice('exit-v2-candidates-'+network,out.candidates[network]);
 }
 console.log(JSON.stringify(out,null,1));
 if(hardFailure){console.error('::error::Liquidity & Exit V2 live probe failed a required check');process.exit(1);}
})().catch(e=>{console.error('::error::probe crashed: '+String(e&&e.message).slice(0,200));process.exit(1);});
