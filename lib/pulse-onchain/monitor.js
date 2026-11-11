'use strict';
// Continuous, checkpointed scans for the reviewed Pulse watch scope.
// A checkpoint advances only across a complete, non-overflowing range. Every update replays a bounded overlap so a
// shallow reorg can replace the corresponding event slice. Source failures preserve the last good events and cursor.
const engine=require('./engine'),watchlist=require('./watchlist'),storage=require('./checkpoint-storage');
const INTERVAL_MS=30*60*1000,ROBINHOOD_INTERVAL_MS=15*60*1000,RETRY_MS=5*60*1000,MIN_REORG_OVERLAP=64;
const intervalMs=chain=>chain==='robinhood'?ROBINHOOD_INTERVAL_MS:INTERVAL_MS;
// Dense ranges do not widen. Cap the request to the guaranteed fixed-span capacity so every
// complete maxWindows scan can advance, regardless of whether the sparse-window optimization applies.
const scanCapacity=cfg=>cfg.span*cfg.maxWindows;
const iso=ms=>new Date(ms).toISOString();
function cleanCost(cost){return {rpcCalls:Number.isSafeInteger(cost?.rpcCalls)?cost.rpcCalls:0,httpRequests:Number.isSafeInteger(cost?.httpRequests)?cost.httpRequests:0};}
// Lag: how far the checkpoint is behind the CONFIRMED chain head that the last scan observed. A run can be
// complete for its own range and still be behind the chain (bounded capacity per run); that is reported as LAGGING,
// never as complete coverage. An observation older than three refresh intervals means the monitor is not running:
// the real distance is then unknown and is reported as STALE_OBSERVATION.
function observedHead(result,at){
 const number=result?.head?.number,confirmedHead=result?.confirmation?.confirmedHead;
 return Number.isSafeInteger(number)&&Number.isSafeInteger(confirmedHead)&&confirmedHead>=0&&number>=confirmedHead?
  {number,confirmedHead,policy:typeof result.confirmation.policy==='string'?result.confirmation.policy:null,observedAt:at}:null;
}
function lagOf(chain,state,now=Date.now()){
 const cfg=watchlist.network(chain),c=state?.coverage,h=state?.head;
 const capacity=scanCapacity(cfg)-Math.max(MIN_REORG_OVERLAP,cfg.confirmationDepth*2);
 if(!c)return {state:'UNKNOWN',reasonCode:'NO_COVERAGE',blocks:null,seconds:null,capacityBlocksPerRun:capacity};
 const observedMs=Date.parse(h?.observedAt||'');
 if(!h||!Number.isSafeInteger(h.confirmedHead)||!Number.isFinite(observedMs))return {state:'UNKNOWN',reasonCode:'HEAD_NOT_OBSERVED',blocks:null,seconds:null,capacityBlocksPerRun:capacity};
 const blocks=Math.max(0,h.confirmedHead-c.lastSuccessfulBlock),coveredMs=Date.parse(c.lastSuccessfulBlockTimestamp||'');
 const base={blocks,seconds:blocks===0?0:Number.isFinite(coveredMs)?Math.max(0,Math.round((observedMs-coveredMs)/1000)):null,
  confirmedHead:h.confirmedHead,observedAt:h.observedAt,observationAgeSeconds:Math.max(0,Math.round((now-observedMs)/1000)),
  capacityBlocksPerRun:capacity,minimumRunsToCatchUp:blocks===0?0:Math.ceil(blocks/capacity)};
 if(now-observedMs>3*intervalMs(chain))return {state:'STALE_OBSERVATION',reasonCode:'PULSE_MONITOR_NOT_RUNNING',...base};
 return blocks===0?{state:'CAUGHT_UP',reasonCode:null,...base}:{state:'LAGGING',reasonCode:'PULSE_MONITOR_BEHIND_HEAD',...base};
}
function publicStatus(chain,state,now=Date.now()){
 if(!state)return {schemaVersion:1,engine:'pulse-onchain-monitor',chain,chainId:watchlist.network(chain).chainId,status:'NOT_STARTED',complete:false,coverage:null,lastAttempt:null,lag:lagOf(chain,null,now),events:[]};
 const lag=lagOf(chain,state,now),behind=lag.state==='LAGGING'||lag.state==='STALE_OBSERVATION';
 // The last attempt keeps its own verdict; the public verdict is downgraded when the checkpoint is not at the confirmed head.
 return {schemaVersion:state.schemaVersion,engine:'pulse-onchain-monitor',chain,chainId:state.chainId,
  status:behind&&state.lastAttempt.complete?(lag.state==='LAGGING'?'LAGGING':'STALE'):state.lastAttempt.status,
  complete:state.lastAttempt.complete&&!behind,...(behind&&state.lastAttempt.complete?{reasonCode:lag.reasonCode}:{}),
  generatedAt:state.generatedAt,coverage:state.coverage,lastAttempt:state.lastAttempt,lag,events:state.events};
}
function mergedEvents(previous,events,fromBlock,toBlock){
 const retained=(previous||[]).filter(e=>e.blockNumber<fromBlock||e.blockNumber>toBlock),byId=new Map();
 for(const event of [...retained,...events])byId.set(event.id,event);
 return [...byId.values()].sort((a,b)=>b.blockNumber-a.blockNumber||b.logIndex-a.logIndex).slice(0,storage.MAX_EVENTS);
}
async function refreshChain(chain,{now=Date.now(),env=process.env,fetcher=fetch,scan=engine.scan,force=false}={}){
 const cfg=watchlist.network(chain);
 if(!storage.directory(env))return {chain,status:'PERSISTENCE_UNCONFIGURED',complete:false,reasonCode:'PULSE_CHECKPOINT_STORAGE_UNCONFIGURED',rpcCalls:0};
 return storage.withLease(chain,async store=>{
  let previous;
  try{previous=await store.read();}catch(error){return {chain,status:'CHECKPOINT_UNAVAILABLE',complete:false,reasonCode:error.code||'PULSE_CHECKPOINT_READ_FAILED',rpcCalls:0};}
  const lastAt=Date.parse(previous?.lastAttempt?.at||''),lastSuccess=Date.parse(previous?.coverage?.lastSuccessfulAt||'');
  // A checkpoint that did not reach the confirmed head catches up at the retry cadence (still one bounded scan per run).
  const wait=previous&&lagOf(chain,previous,now).state==='LAGGING'?RETRY_MS:intervalMs(chain);
  if(!force&&previous&&previous.lastAttempt?.complete===true&&Number.isFinite(lastSuccess)&&now-lastSuccess<wait)
   return {...publicStatus(chain,previous,now),skipped:true,reasonCode:wait===RETRY_MS?'CATCH_UP_INTERVAL_NOT_REACHED':'REFRESH_INTERVAL_NOT_REACHED',rpcCalls:0};
  if(!force&&previous?.lastAttempt?.complete!==true&&Number.isFinite(lastAt)&&now-lastAt<RETRY_MS)
   return {...publicStatus(chain,previous,now),skipped:true,reasonCode:'RETRY_BACKOFF',rpcCalls:0};
  let result;
  try{
   if(!previous?.coverage)result=await scan({chain,now,env,fetcher,maxEvents:storage.MAX_EVENTS});
   else{
    const overlap=Math.max(MIN_REORG_OVERLAP,cfg.confirmationDepth*2),fromBlock=Math.max(previous.coverage.startBlock,previous.coverage.nextBlock-overlap);
    const toBlock=previous.coverage.nextBlock+scanCapacity(cfg)-1;
    result=await scan({chain,now,env,fetcher,maxEvents:storage.MAX_EVENTS,range:{fromBlock,toBlock}});
   }
  }catch(error){result={status:'PROVIDER_UNAVAILABLE',complete:false,reasonCode:/^[A-Z_0-9]{1,80}$/.test(error?.code||'')?error.code:'ONCHAIN_SCAN_FAILED',events:[],cost:{rpcCalls:0}};}
  const at=iso(now),overflow=Number(result?.counts?.filtered?.overflow)||0,window=result?.window;
  const successful=result?.complete===true&&overflow===0&&window&&Number.isSafeInteger(window.fromBlock)&&Number.isSafeInteger(window.toBlock)&&window.toBlock>=window.fromBlock&&/^0x[0-9a-f]{64}$/i.test(window.toBlockHash||'');
  if(!successful){
   const reasonCode=overflow?'PULSE_EVENT_BATCH_OVERFLOW':result?.reasonCode||'PULSE_CHECKPOINT_RANGE_INCOMPLETE';
   const attempt={at,status:result?.status==='PROVIDER_UNAVAILABLE'?'PROVIDER_UNAVAILABLE':'PARTIAL_COVERAGE',complete:false,reasonCode,cost:cleanCost(result?.cost),...(window?{window:{fromBlock:window.fromBlock,toBlock:window.toBlock,blocksCovered:window.blocksCovered,blocksPlanned:window.blocksPlanned}}:{})};
   const seen=observedHead(result,at);
   const next=previous?{...previous,revision:previous.revision+1,generatedAt:at,lastAttempt:attempt,...(seen?{head:seen}:{})}:
    {schemaVersion:1,chain,chainId:cfg.chainId,revision:1,generatedAt:at,coverage:null,lastAttempt:attempt,...(seen?{head:seen}:{}),events:[]};
   try{await store.save(next);}catch(error){return {chain,status:'CHECKPOINT_UNAVAILABLE',complete:false,reasonCode:error.code||'PULSE_CHECKPOINT_WRITE_FAILED',rpcCalls:attempt.cost.rpcCalls};}
   return {...publicStatus(chain,next,now),reasonCode};
  }
  const events=(result.events||[]).filter(e=>e.confirmation?.status==='CONFIRMED');
  const startBlock=previous?.coverage?.startBlock??window.fromBlock;
  const fromBlock=window.fromBlock,toBlock=window.toBlock;
  const nextBlock=Math.max(previous?.coverage?.nextBlock||0,toBlock+1);
  const keepTo=nextBlock-1,hash=toBlock>=keepTo||!previous?.coverage?window.toBlockHash:previous.coverage.lastSuccessfulBlockHash;
  const storedEvents=mergedEvents(previous?.events,events,fromBlock,toBlock);
  const coverage={startBlock,nextBlock,lastSuccessfulBlock:keepTo,lastSuccessfulBlockHash:hash,completeFromGenesis:startBlock===0,
   reorgOverlap:Math.max(MIN_REORG_OVERLAP,cfg.confirmationDepth*2),lastSuccessfulAt:at,
   lastSuccessfulBlockTimestamp:toBlock>=keepTo||!previous?.coverage?(Number.isFinite(Date.parse(window.toTimestamp||''))?window.toTimestamp:null):previous.coverage.lastSuccessfulBlockTimestamp??null,
   retainedEventFromBlock:storedEvents.length?Math.min(...storedEvents.map(e=>e.blockNumber)):null,retainedEvents:storedEvents.length};
  const attempt={at,status:result.status,complete:true,reasonCode:null,cost:cleanCost(result.cost),window:{fromBlock,toBlock,blocksCovered:window.blocksCovered,blocksPlanned:window.blocksPlanned,fromTimestamp:window.fromTimestamp,toTimestamp:window.toTimestamp}};
  const seen=observedHead(result,at)||null;
  const next={schemaVersion:1,chain,chainId:cfg.chainId,revision:(previous?.revision||0)+1,generatedAt:at,coverage,lastAttempt:attempt,...(seen?{head:seen}:{}),events:storedEvents};
  try{await store.save(next);}catch(error){return {chain,status:'CHECKPOINT_UNAVAILABLE',complete:false,reasonCode:error.code||'PULSE_CHECKPOINT_WRITE_FAILED',rpcCalls:attempt.cost.rpcCalls};}
   const published=publicStatus(chain,next,now);
   return {...published,reasonCode:published.reasonCode||null};
 },{env});
}
async function refreshAll(options={}){
 const out={};
 // Keep provider load bounded across networks; failures are caught inside each chain refresh and never cancel siblings.
 for(const chain of Object.keys(watchlist.NETWORKS)){
  try{out[chain]=await refreshChain(chain,options);}catch(error){out[chain]={chain,status:'PROVIDER_UNAVAILABLE',complete:false,reasonCode:/^[A-Z_0-9]{1,80}$/.test(error?.code||'')?error.code:'ONCHAIN_MONITOR_FAILED',rpcCalls:0};}
 }
 return out;
}
async function latest(chain,{env=process.env,now=Date.now()}={}){
 try{return publicStatus(chain,await storage.read(chain,{env}),now);}
 catch(error){return {schemaVersion:1,engine:'pulse-onchain-monitor',chain,chainId:watchlist.network(chain).chainId,status:'CHECKPOINT_UNAVAILABLE',complete:false,reasonCode:error.code||'PULSE_CHECKPOINT_READ_FAILED',coverage:null,lastAttempt:null,events:[]};}
}
module.exports={refreshChain,refreshAll,latest,publicStatus,lagOf,mergedEvents,scanCapacity,intervalMs,INTERVAL_MS,ROBINHOOD_INTERVAL_MS,RETRY_MS,MIN_REORG_OVERLAP};
