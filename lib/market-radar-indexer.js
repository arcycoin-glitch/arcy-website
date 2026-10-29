'use strict';
// Incremental Market Radar indexer (runs on the Railway worker, NOT in a Vercel function).
//
// Each run reads only NEW confirmed blocks since the last run, stores per-pool aggregates in
// ~5-minute block segments, drops segments older than 24h, and publishes a signed snapshot
// ONLY when the retained segments prove continuous coverage of the whole 24h window.
// While bootstrapping (window not yet covered) nothing is published.
const onchain=require('./market-radar-onchain');
const storage=require('./market-radar-storage');
const {CHAINS,LIMITS,scanRange,buildResult,makeRpc,block,blocksPerSecond,firstBlockAtOrAfter,anchorsFor,chainlink,sanitize}=onchain;
const WINDOW=86400,SEGMENT_SECONDS=300,STATE_VERSION=1;
const hex=n=>'0x'+n.toString(16);
const bi=v=>BigInt(v);
const packSwap=s=>({id:s.id,blockNumber:s.blockNumber,logIndex:s.logIndex,tx:s.tx,amount0:String(s.amount0),amount1:String(s.amount1),sqrtPriceX96:String(s.sqrtPriceX96)});
const unpackSwap=s=>({...s,amount0:bi(s.amount0),amount1:bi(s.amount1),sqrtPriceX96:bi(s.sqrtPriceX96)});
const packPool=p=>({id:p.id,swaps:p.swaps,abs0:String(p.abs0),abs1:String(p.abs1),first:packSwap(p.first),last:packSwap(p.last)});
const unpackPool=p=>({id:p.id,swaps:p.swaps,abs0:bi(p.abs0),abs1:bi(p.abs1),first:unpackSwap(p.first),last:unpackSwap(p.last)});
const before=(a,b)=>a.blockNumber<b.blockNumber||(a.blockNumber===b.blockNumber&&a.logIndex<b.logIndex);
function mergeSegments(segments){
 const out=new Map();let swaps=0;
 for(const seg of segments)for(const raw of seg.pools){
  const p=unpackPool(raw);swaps+=p.swaps;
  const cur=out.get(p.id);
  if(!cur){out.set(p.id,p);continue;}
  cur.swaps+=p.swaps;cur.abs0+=p.abs0;cur.abs1+=p.abs1;
  if(before(p.first,cur.first))cur.first=p.first;
  if(before(cur.last,p.last))cur.last=p.last;
 }
 return {pools:out,swaps};
}
// Pure continuity proof used by publish and by tests.
function coverage(segments,headTs){
 if(!segments.length)return {ok:false,reason:'no segments'};
 for(let i=1;i<segments.length;i++)if(segments[i].from!==segments[i-1].to+1)return {ok:false,reason:'gap between segments',at:segments[i].from};
 const first=segments[0];
 if(first.fromTs>headTs-WINDOW)return {ok:false,reason:'window not yet covered',missingSeconds:first.fromTs-(headTs-WINDOW)};
 return {ok:true,fromTs:first.fromTs,seconds:headTs-first.fromTs};
}
async function step(network,{fetcher=fetch,env=process.env,now=Date.now(),budgetMs=50000,store=storage,ethRpc}={}){
 const cfg=CHAINS[network];if(!cfg)throw Object.assign(Error('RADAR_INVALID_NETWORK'),{code:'RADAR_INVALID_NETWORK'});
 const t0=Date.now(),deadline=t0+budgetMs,rpc=makeRpc(network,{fetcher,env}),nowSec=Math.floor(now/1000);
 const chainId=Number(BigInt(await rpc.call('eth_chainId',[])));
 if(chainId!==cfg.chainId)throw Object.assign(new Error('RADAR_RPC_CHAIN_MISMATCH'),{code:'RADAR_RPC_CHAIN_MISMATCH',detail:{expected:cfg.chainId,got:chainId}});
 const latest=await block(rpc,'latest');
 if(latest.timestamp>nowSec+300||nowSec-latest.timestamp>900)throw Object.assign(new Error('RADAR_RPC_HEAD_STALE'),{code:'RADAR_RPC_HEAD_STALE'});
 const head=latest.number>cfg.confirmations+10?await block(rpc,latest.number-cfg.confirmations):latest;
 let state=await store.readState(network);
 if(!state||state.version!==STATE_VERSION||state.chainId!==cfg.chainId||state.poolManager!==cfg.poolManager||state.nextBlock>head.number+1)
  state={version:STATE_VERSION,chainId:cfg.chainId,poolManager:cfg.poolManager,nextBlock:null,segments:[],createdAt:new Date(now).toISOString()};
 const bps=await blocksPerSecond(rpc,head).catch(()=>null);
 const segBlocks=Math.max(1,Math.ceil(SEGMENT_SECONDS*(bps||1)));
 let startTs=null;
 if(state.nextBlock===null){
  const start=await firstBlockAtOrAfter(rpc,head,head.timestamp-WINDOW-SEGMENT_SECONDS,{bps});
  state.nextBlock=start.number;state.startTs=start.timestamp;
 }
 const stats={scanned:0,segments:0,calls:0};
 while(state.nextBlock<=head.number&&Date.now()<deadline){
  const from=state.nextBlock,to=Math.min(head.number,from+segBlocks-1);
  const prev=state.segments.at(-1);
  const fromTs=prev?prev.toTs:state.startTs;
  let scan;
  try{scan=await scanRange(rpc,cfg,from,to,{deadline});}
  catch(e){if(e.code==='RADAR_ONCHAIN_SCAN_INCOMPLETE'&&Date.now()>=deadline)break;throw e;}
  const toTs=to===head.number?head.timestamp:(await block(rpc,to)).timestamp;
  state.segments.push({from,to,fromTs,toTs,swaps:scan.swaps,pools:[...scan.pools.values()].map(packPool)});
  state.nextBlock=to+1;stats.scanned+=to-from+1;stats.segments++;stats.calls+=scan.stats.calls;
  if(stats.segments%20===0)await store.writeState(network,state);
 }
 // Drop segments the window no longer needs (keep the one that still anchors the 24h start).
 while(state.segments.length>1&&state.segments[1].fromTs<=head.timestamp-WINDOW)state.segments.shift();
 state.updatedAt=new Date(now).toISOString();state.headBlock=head.number;
 await store.writeState(network,state);
 const caughtUp=state.nextBlock>head.number,cov=coverage(state.segments,head.timestamp);
 const progress={network,headBlock:head.number,nextBlock:state.nextBlock,blocksBehind:Math.max(0,head.number-state.nextBlock+1),segments:state.segments.length,
  run:{...stats,elapsedMs:Date.now()-t0,rpcCalls:rpc.calls},coverage:cov};
 if(!caughtUp)return {status:'catching_up',...progress};
 if(!cov.ok)return {status:'bootstrapping',...progress};
 // Same reference/anchor evidence as the live scan.
 const tag=hex(head.number),eth=network==='ethereum'?rpc:(ethRpc||makeRpc('ethereum',{fetcher,env}));
 const [anchors,refETH,refUSDC]=await Promise.all([anchorsFor(rpc,network,tag),chainlink(eth,'ETH',nowSec).catch(()=>null),chainlink(eth,'USDC',nowSec).catch(()=>null)]);
 const refPrices={};if(refETH)refPrices.ETH=refETH;if(refUSDC)refPrices.USDC=refUSDC;
 if(!anchors.some(a=>refPrices[a.ref]))throw Object.assign(new Error('RADAR_REFERENCE_PRICE_UNAVAILABLE'),{code:'RADAR_REFERENCE_PRICE_UNAVAILABLE'});
 const merged=mergeSegments(state.segments);
 const startBlock={number:state.segments[0].from,timestamp:state.segments[0].fromTs};
 const body=await buildResult(network,rpc,{agg:merged.pools,swapCount:merged.swaps,start:startBlock,head,anchors,refPrices,tag,
  deadline:Date.now()+30000,logCalls:stats.calls,source:{windowSeconds:cov.seconds}});
 const snapshot={...body,snapshot:{version:1,network,chainId:cfg.chainId,generatedAt:new Date(now).toISOString(),headBlock:head.number,
  headTimestamp:head.timestamp,headTime:new Date(head.timestamp*1000).toISOString(),windowSeconds:cov.seconds,segments:state.segments.length,indexer:'incremental'}};
 await store.publish(network,snapshot);
 return {status:'published',...progress,tokens:body.tokens.length,windowSeconds:cov.seconds};
}
async function run(network,opts={}){
 const store=opts.store||storage,started=new Date().toISOString();
 try{
  const r=await step(network,opts);
  const audit=(await store.readAudit(network))||{};
  await store.writeAudit(network,{...audit,lastRun:{at:started,status:r.status,headBlock:r.headBlock,blocksBehind:r.blocksBehind,tokens:r.tokens??null,elapsedMs:r.run.elapsedMs,rpcCalls:r.run.rpcCalls},
   ...(r.status==='published'?{lastSuccessful:{at:started,headBlock:r.headBlock,tokens:r.tokens,windowSeconds:r.windowSeconds}}:{})});
  return r;
 }catch(error){
  const audit=(await store.readAudit(network).catch(()=>null))||{};
  const failure={at:started,code:error.code||'RADAR_INDEXER_FAILED',reason:sanitize(error.detail?.reason||error.message,120)};
  await store.writeAudit(network,{...audit,lastFailure:failure}).catch(()=>{});
  throw error;
 }
}
module.exports={step,run,coverage,mergeSegments,WINDOW,SEGMENT_SECONDS,packPool,unpackPool};
