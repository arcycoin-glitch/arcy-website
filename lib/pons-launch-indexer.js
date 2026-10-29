'use strict';
// Incremental pons Launch Radar indexer (Railway). Persists a launch list and per-pool swap aggregates so a run
// only reads new blocks. A signed snapshot is published only when launch AND swap scans reach the confirmed head.
const pons=require('./pons-launch-radar');
const onchain=require('./market-radar-onchain');
const storage=require('./market-radar-storage');
const {PONS}=pons;
const {scanRange,makeRpc,block,blocksPerSecond,firstBlockAtOrAfter,chainlink,emptyStats,sanitize}=onchain;
const VERSION=1,PIECE=250000,POOLS_PER_REQUEST=40,LOOKBACK_SECONDS=7*86400,KEY='pons';
const hex=n=>'0x'+BigInt(n).toString(16);
const packAgg=a=>({pool:a.pool,swaps:a.swaps,txs:a.txs,lastTx:a.lastTx,buys:a.buys,sells:a.sells,pairVolume:String(a.pairVolume),
 first:{blockNumber:a.first.blockNumber,logIndex:a.first.logIndex,sqrtPriceX96:String(a.first.sqrtPriceX96)},last:{blockNumber:a.last.blockNumber,logIndex:a.last.logIndex,sqrtPriceX96:String(a.last.sqrtPriceX96)}});
const unpackAgg=a=>({...a,pairVolume:BigInt(a.pairVolume),first:{...a.first,sqrtPriceX96:BigInt(a.first.sqrtPriceX96)},last:{...a.last,sqrtPriceX96:BigInt(a.last.sqrtPriceX96)}});
const before=(x,y)=>x.blockNumber<y.blockNumber||(x.blockNumber===y.blockNumber&&x.logIndex<y.logIndex);
function mergeAgg(into,delta){
 const cur=into.get(delta.pool);
 if(!cur){into.set(delta.pool,delta);return;}
 cur.swaps+=delta.swaps;cur.buys+=delta.buys;cur.sells+=delta.sells;cur.pairVolume+=delta.pairVolume;
 // delta covers strictly later blocks than cur, so its first swap can share a tx with cur's last only if blocks match
 cur.txs+=delta.txs-(delta.first.tx&&delta.first.tx===cur.lastTx?1:0);cur.lastTx=delta.lastTx;
 if(before(delta.first,cur.first))cur.first=delta.first;if(before(cur.last,delta.last))cur.last=delta.last;
}
const chunk=(arr,n)=>Array.from({length:Math.ceil(arr.length/n)},(_,i)=>arr.slice(i*n,(i+1)*n));
async function step({fetcher=fetch,env=process.env,now=Date.now(),budgetMs=50000,store=storage,ethRpc}={}){
 const t0=Date.now(),deadline=t0+budgetMs,tune={minIntervalMs:Number(env.ARC_RADAR_MIN_INTERVAL_MS)>=0&&env.ARC_RADAR_MIN_INTERVAL_MS!==undefined?Number(env.ARC_RADAR_MIN_INTERVAL_MS):250,concurrency:Math.max(1,Math.min(4,Number(env.ARC_RADAR_CONCURRENCY)||2)),rateTries:40},
  prior=await store.readState(KEY).catch(()=>null),rpc=makeRpc('robinhood',{fetcher,env,minIntervalMs:tune.minIntervalMs,pace0:Number(prior?.paceMs)||0}),nowSec=Math.floor(now/1000),cfg=onchain.CHAINS.robinhood;
 const factories=pons.factoriesOf(env);
 const chainId=Number(BigInt(await rpc.call('eth_chainId',[])));
 if(chainId!==PONS.chainId)throw Object.assign(Error('RADAR_RPC_CHAIN_MISMATCH'),{code:'RADAR_RPC_CHAIN_MISMATCH',detail:{expected:PONS.chainId,got:chainId}});
 const latest=await block(rpc,'latest');
 if(latest.timestamp>nowSec+300||nowSec-latest.timestamp>900)throw Object.assign(Error('RADAR_RPC_HEAD_STALE'),{code:'RADAR_RPC_HEAD_STALE'});
 const head=latest.number>cfg.confirmations+10?await block(rpc,latest.number-cfg.confirmations):latest;
 let state=await store.readState(KEY);
 const fp=factories.map(f=>f.address).join(',');
 if(!state||state.version!==VERSION||state.chainId!==PONS.chainId||state.factories!==fp)
  state={version:VERSION,chainId:PONS.chainId,factories:fp,launchNext:null,swapStart:null,swapNext:null,launches:[],aggs:{},learnedCap:null};
 const learn={cap:Number(state.learnedCap)>0?Number(state.learnedCap):Infinity},maxCalls=20000,stats={calls:0};
 if(state.launchNext===null){
  const bps=await blocksPerSecond(rpc,head).catch(()=>null);
  const start=await firstBlockAtOrAfter(rpc,head,head.timestamp-LOOKBACK_SECONDS,{bps});
  state.swapStart=start.number;state.swapNext=start.number;
  // Launch events older than the lookback cannot have full swap history here, so they are not scanned or shown.
  state.launchNext=Math.max(start.number,Math.min(...factories.map(f=>f.startBlock||0)));
 }
 const note=(scan)=>{stats.calls+=scan.stats.calls;};
 // 1) new launches
 const launchDeadline=t0+Math.floor(budgetMs*0.4);
 while(state.launchNext<=head.number&&Date.now()<launchDeadline){
  const a=state.launchNext,b=Math.min(head.number,a+PIECE-1),found=[];
  try{note(await scanRange(rpc,cfg,a,b,{deadline:launchDeadline,learn,maxCalls,concurrency:tune.concurrency,rateTries:tune.rateTries,filter:{address:factories.map(f=>f.address),topics:[PONS.launchedTopic]},
   parse:(log,f,t)=>pons.parseLaunch(log,factories,f,t),sink:l=>found.push(l)}));}
  catch(e){if(e.code==='RADAR_ONCHAIN_SCAN_INCOMPLETE'&&Date.now()>=launchDeadline)break;throw e;}
  const known=new Set(state.launches.map(l=>l.token));
  for(const l of found)if(!known.has(l.token)){state.launches.push(l);known.add(l.token);}
  state.launchNext=b+1;
 }
 // 2) swaps of every tracked pool, only up to the block launches are known for
 const target=Math.min(head.number,state.launchNext-1);
 const byPool=new Map(state.launches.map(l=>[l.pool,l]));
 while(state.swapNext<=target&&Date.now()<deadline){
  const a=state.swapNext,b=Math.min(target,a+PIECE-1),delta=new Map();
  try{
   for(const pools of chunk([...byPool.keys()],POOLS_PER_REQUEST)){
    const sub=new Map(pools.map(p=>[p,byPool.get(p)]));
    note(await scanRange(rpc,cfg,a,b,{deadline,learn,maxCalls,concurrency:tune.concurrency,rateTries:tune.rateTries,filter:{address:pools,topics:[PONS.swapTopic]},
     parse:(log,f,t)=>{const s=pons.parseSwap(log,sub,f,t);return s&&s.blockNumber>=sub.get(s.pool).blockNumber?s:null;},
     sink:s=>pons.addPoolSwap(delta,sub.get(s.pool),s)}));
   }
  }catch(e){if(e.code==='RADAR_ONCHAIN_SCAN_INCOMPLETE'&&Date.now()>=deadline)break;throw e;}
  const aggs=new Map(Object.entries(state.aggs).map(([k,v])=>[k,unpackAgg(v)]));
  for(const d of delta.values())mergeAgg(aggs,d);
  state.aggs=Object.fromEntries([...aggs].map(([k,v])=>[k,packAgg(v)]));
  state.swapNext=b+1;
  await store.writeState(KEY,state);
 }
 state.learnedCap=Number.isFinite(learn.cap)?learn.cap:null;state.paceMs=rpc.pace().ms;state.updatedAt=new Date(now).toISOString();state.headBlock=head.number;
 await store.writeState(KEY,state);
 const progress={network:KEY,headBlock:head.number,launchBlocksBehind:Math.max(0,head.number-state.launchNext+1),swapBlocksBehind:Math.max(0,head.number-state.swapNext+1),
  launchesTracked:state.launches.length,run:{calls:stats.calls,elapsedMs:Date.now()-t0,rpcCalls:rpc.calls}};
 if(state.launchNext<=head.number||state.swapNext<=head.number)return {status:'catching_up',...progress};
 // 3) publish
 const eth=ethRpc||makeRpc('ethereum',{fetcher,env});
 const ethUsd=await chainlink(eth,'ETH',nowSec).catch(()=>null);
 const newest=state.launches.slice().sort(pons.sortNewest).slice(0,PONS.maxItems);
 const aggs=new Map(Object.entries(state.aggs).map(([k,v])=>[k,unpackAgg(v)]));
 const items=await pons.buildItems(rpc,newest,aggs,{head,ethUsd,deadline:Date.now()+30000,tag:hex(head.number)});
 const startTs=(await block(rpc,state.swapStart)).timestamp;
 const body=pons.envelope(items.map((x,i)=>({rank:i+1,...x})),{head,ethUsd,
  window:{fromBlock:state.swapStart,toBlock:head.number,from:new Date(startTs*1000).toISOString(),to:new Date(head.timestamp*1000).toISOString(),seconds:head.timestamp-startTs,lookbackHours:LOOKBACK_SECONDS/3600},
  coverage:{launchesTracked:state.launches.length,shown:items.length,factories:factories.map(f=>({address:f.address,label:f.label,startBlock:f.startBlock})),windowScanComplete:true,indexer:'incremental',
   notes:items.length===0?'No launches from the official pons factories were observed in the window.':null}});
 const snapshot={...body,snapshot:{version:1,network:KEY,chainId:PONS.chainId,generatedAt:new Date(now).toISOString(),headBlock:head.number,headTimestamp:head.timestamp,headTime:new Date(head.timestamp*1000).toISOString(),indexer:'incremental',integrity:{headHash:head.hash,headBlock:head.number,swapScanFrom:state.swapStart,factories:factories.map(f=>f.address),rpcChainId:PONS.chainId,confirmations:cfg.confirmations,rpcCallsThisRun:rpc.calls}}};
 await store.publish(KEY,snapshot);
 return {status:'published',...progress,tokens:items.length};
}
async function run(opts={}){
 const store=opts.store||storage,started=new Date().toISOString();
 try{
  const r=await step(opts);
  const audit=(await store.readAudit(KEY))||{};
  await store.writeAudit(KEY,{...audit,lastRun:{at:started,status:r.status,headBlock:r.headBlock,launchesTracked:r.launchesTracked,tokens:r.tokens??null,elapsedMs:r.run.elapsedMs},...(r.status==='published'?{lastSuccessful:{at:started,headBlock:r.headBlock,tokens:r.tokens}}:{})});
  return r;
 }catch(error){
  const audit=(await store.readAudit(KEY).catch(()=>null))||{};
  await store.writeAudit(KEY,{...audit,lastFailure:{at:started,code:error.code||'PONS_INDEXER_FAILED',reason:sanitize(error.detail?.reason||error.message,120)}}).catch(()=>{});
  throw error;
 }
}
module.exports={step,run,mergeAgg,KEY};
