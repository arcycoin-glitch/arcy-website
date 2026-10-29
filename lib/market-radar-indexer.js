'use strict';
// Incremental Market Radar indexer (runs on the Railway worker, NOT in a Vercel function).
//
// Each run reads only NEW confirmed blocks since the last run, stores per-pool aggregates in
// ~5-minute block segments, drops segments older than 24h, and publishes a signed snapshot
// ONLY when the retained segments prove continuous coverage of the whole 24h window.
// While bootstrapping (window not yet covered) nothing is published.
const onchain=require('./market-radar-onchain');
const storage=require('./market-radar-storage');
const {CHAINS,LIMITS,INIT_TOPIC,parseInit,verifyKey,scanRange,buildResult,makeRpc,block,blocksPerSecond,firstBlockAtOrAfter,anchorsFor,chainlink,sanitize,emptyStats}=onchain;
// Low-RPC defaults: paced requests (shared adaptive pacer), 2 parallel log scans, patient 429 handling.
const tuning=env=>({minIntervalMs:Number(env.ARC_RADAR_MIN_INTERVAL_MS)>=0&&env.ARC_RADAR_MIN_INTERVAL_MS!==undefined?Number(env.ARC_RADAR_MIN_INTERVAL_MS):150,
 concurrency:Math.max(1,Math.min(4,Number(env.ARC_RADAR_CONCURRENCY)||2)),rateTries:40});
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
// ---- pool-key registry: every Initialize event, verified by keccak256(poolKey)==poolId ----------------
// Scanned newest-first (backward from the head) so the pools that matter for a 24h ranking resolve first,
// and forward each run to stay current. Progress is persisted; nothing here is ever "assumed".
const REG_VERSION=1,REG_PIECE=250000;
const initFrom=(network,cfg,env)=>{const v=Number(env['RADAR_INIT_FROM_'+network.toUpperCase()]);return Number.isSafeInteger(v)&&v>=0?v:cfg.initFromBlock;};
function loadRegistry(raw,cfg){
 if(!raw||raw.version!==REG_VERSION||raw.chainId!==cfg.chainId||raw.poolManager!==cfg.poolManager)return {low:null,high:null,keys:new Map()};
 return {low:raw.low,high:raw.high,keys:new Map(Object.entries(raw.keys||{}).map(([id,k])=>[id,{currency0:k[0],currency1:k[1],fee:k[2],tickSpacing:k[3],hooks:k[4]}]))};
}
const dumpRegistry=(cfg,r,fromBlock)=>({version:REG_VERSION,chainId:cfg.chainId,poolManager:cfg.poolManager,fromBlock,low:r.low,high:r.high,
 keys:Object.fromEntries([...r.keys].map(([id,k])=>[id,[k.currency0,k.currency1,k.fee,k.tickSpacing,k.hooks]]))});
async function advanceRegistry(network,rpc,cfg,head,{store,deadline,learn,env,maxCalls,tune=tuning(env)}){
 const fromBlock=initFrom(network,cfg,env),reg=loadRegistry(await store.readKeys(network),cfg);
 const sink=i=>{const k={currency0:i.currency0,currency1:i.currency1,fee:i.fee,tickSpacing:i.tickSpacing,hooks:i.hooks};if(!reg.keys.has(i.id)&&verifyKey(i.id,k))reg.keys.set(i.id,k);};
 const piece=async(a,b)=>{await scanRange(rpc,cfg,a,b,{deadline,learn,maxCalls,concurrency:tune.concurrency,rateTries:tune.rateTries,stats:emptyStats(),filter:{address:cfg.poolManager,topics:[INIT_TOPIC]},parse:(log,f,t)=>parseInit(log,cfg,f,t),sink});};
 let error=null;
 try{
  if(reg.high===null){reg.high=head.number;reg.low=head.number+1;}
  // forward to the head (always, usually tiny)
  while(reg.high<head.number&&Date.now()<deadline){const a=reg.high+1,b=Math.min(head.number,a+REG_PIECE-1);await piece(a,b);reg.high=b;await store.writeKeys(network,dumpRegistry(cfg,reg,fromBlock));}
  // backward toward the first block that can contain an Initialize event
  while(reg.low>fromBlock&&Date.now()<deadline){const b=reg.low-1,a=Math.max(fromBlock,b-REG_PIECE+1);await piece(a,b);reg.low=a;await store.writeKeys(network,dumpRegistry(cfg,reg,fromBlock));}
 }catch(e){error=e;}
 await store.writeKeys(network,dumpRegistry(cfg,reg,fromBlock));
 const complete=reg.low<=fromBlock&&reg.high>=head.number;
 return {map:reg.keys,info:{fromBlock,low:reg.low,high:reg.high,keys:reg.keys.size,complete,remainingBlocks:Math.max(0,reg.low-fromBlock),error:error?(error.detail?.reason||error.code||'FAILED'):null}};
}
async function step(network,{fetcher=fetch,env=process.env,now=Date.now(),budgetMs=50000,store=storage,ethRpc}={}){
 const cfg=CHAINS[network];if(!cfg)throw Object.assign(Error('RADAR_INVALID_NETWORK'),{code:'RADAR_INVALID_NETWORK'});
 const t0=Date.now(),deadline=t0+budgetMs,segDeadline=t0+Math.floor(budgetMs*0.6),tune=tuning(env),prior=await store.readState(network).catch(()=>null),rpc=makeRpc(network,{fetcher,env,minIntervalMs:tune.minIntervalMs,pace0:Number(prior?.paceMs)||0}),nowSec=Math.floor(now/1000);
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
 const stats={scanned:0,segments:0,calls:0},learn={cap:Number(state.learnedCap)>0?Number(state.learnedCap):Infinity},maxCalls=20000;
 while(state.nextBlock<=head.number&&Date.now()<segDeadline){
  const from=state.nextBlock,to=Math.min(head.number,from+segBlocks-1);
  const prev=state.segments.at(-1);
  const fromTs=prev?prev.toTs:state.startTs;
  let scan;
  try{scan=await scanRange(rpc,cfg,from,to,{deadline:segDeadline,learn,maxCalls,concurrency:tune.concurrency,rateTries:tune.rateTries});}
  catch(e){if(e.code==='RADAR_ONCHAIN_SCAN_INCOMPLETE'&&Date.now()>=segDeadline)break;throw e;}
  const toTs=to===head.number?head.timestamp:(await block(rpc,to)).timestamp;
  state.segments.push({from,to,fromTs,toTs,swaps:scan.swaps,pools:[...scan.pools.values()].map(packPool)});
  state.nextBlock=to+1;stats.scanned+=to-from+1;stats.segments++;stats.calls+=scan.stats.calls;
  if(stats.segments%20===0)await store.writeState(network,state);
 }
 // Drop segments the window no longer needs (keep the one that still anchors the 24h start).
 while(state.segments.length>1&&state.segments[1].fromTs<=head.timestamp-WINDOW)state.segments.shift();
 state.updatedAt=new Date(now).toISOString();state.headBlock=head.number;state.learnedCap=Number.isFinite(learn.cap)?learn.cap:null;state.paceMs=rpc.pace().ms;
 await store.writeState(network,state);
 const caughtUp=state.nextBlock>head.number,cov=coverage(state.segments,head.timestamp);
 const progress={network,headBlock:head.number,nextBlock:state.nextBlock,blocksBehind:Math.max(0,head.number-state.nextBlock+1),segments:state.segments.length,
  run:{...stats,elapsedMs:Date.now()-t0,rpcCalls:rpc.calls},coverage:cov};
 // Registry runs every time (also while swaps catch up) so key coverage grows during bootstrap.
 const registry=await advanceRegistry(network,rpc,cfg,head,{store,deadline,learn,env,maxCalls,tune});
 progress.registry=registry.info;
 if(!caughtUp)return {status:'catching_up',...progress};
 if(!cov.ok)return {status:'bootstrapping',...progress};
 // Same reference/anchor evidence as the live scan.
 const tag=hex(head.number),eth=network==='ethereum'?rpc:(ethRpc||makeRpc('ethereum',{fetcher,env}));
 const [anchors,refETH,refUSDC]=await Promise.all([anchorsFor(rpc,network,tag),chainlink(eth,'ETH',nowSec).catch(()=>null),chainlink(eth,'USDC',nowSec).catch(()=>null)]);
 const refPrices={};if(refETH)refPrices.ETH=refETH;if(refUSDC)refPrices.USDC=refUSDC;
 if(!anchors.some(a=>refPrices[a.ref]))throw Object.assign(new Error('RADAR_REFERENCE_PRICE_UNAVAILABLE'),{code:'RADAR_REFERENCE_PRICE_UNAVAILABLE'});
 const merged=mergeSegments(state.segments);
 const startBlock={number:state.segments[0].from,timestamp:state.segments[0].fromTs};
 let body;
 try{body=await buildResult(network,rpc,{agg:merged.pools,swapCount:merged.swaps,start:startBlock,head,anchors,refPrices,tag,registry:registry.map,
  deadline:Date.now()+30000,logCalls:stats.calls,source:{windowSeconds:cov.seconds}});}
 catch(e){if(e.code==='RADAR_POOL_KEY_COVERAGE_LOW')return {status:'registry_backfilling',...progress,coverageDetail:e.detail};throw e;}
 body.coverage.registry=registry.info;
 const keyFp=(()=>{try{return require('node:crypto').createHash('sha256').update(String(process.env.ARC_RADAR_PUBLIC_KEY||process.env.ARC_HOLDER_PUBLIC_KEY||'')).digest('hex').slice(0,16);}catch{return null;}})();
 const integrity={headHash:head.hash,headBlock:head.number,segmentsFrom:state.segments[0].from,segmentsTo:state.segments.at(-1).to,segments:state.segments.length,
  segmentsContiguous:true,registry:registry.info,rpcChainId:cfg.chainId,sourceContract:cfg.poolManager,confirmations:cfg.confirmations,publicKeyFingerprint:keyFp,rpcCallsThisRun:rpc.calls};
 const snapshot={...body,snapshot:{version:1,network,chainId:cfg.chainId,generatedAt:new Date(now).toISOString(),headBlock:head.number,
  headTimestamp:head.timestamp,headTime:new Date(head.timestamp*1000).toISOString(),windowSeconds:cov.seconds,segments:state.segments.length,indexer:'incremental',integrity}};
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
