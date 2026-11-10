'use strict';
// Continuous, checkpointed scans for the reviewed Pulse watch scope.
// A checkpoint advances only across a complete, non-overflowing range. Every update replays a bounded overlap so a
// shallow reorg can replace the corresponding event slice. Source failures preserve the last good events and cursor.
const engine=require('./engine'),watchlist=require('./watchlist'),storage=require('./checkpoint-storage');
const INTERVAL_MS=30*60*1000,RETRY_MS=5*60*1000,MIN_REORG_OVERLAP=64;
// Dense ranges do not widen. Cap the request to the guaranteed fixed-span capacity so every
// complete maxWindows scan can advance, regardless of whether the sparse-window optimization applies.
const scanCapacity=cfg=>cfg.span*cfg.maxWindows;
const iso=ms=>new Date(ms).toISOString();
function cleanCost(cost){return {rpcCalls:Number.isSafeInteger(cost?.rpcCalls)?cost.rpcCalls:0,httpRequests:Number.isSafeInteger(cost?.httpRequests)?cost.httpRequests:0};}
function publicStatus(chain,state){
 if(!state)return {schemaVersion:1,engine:'pulse-onchain-monitor',chain,chainId:watchlist.network(chain).chainId,status:'NOT_STARTED',complete:false,coverage:null,lastAttempt:null,events:[]};
 return {schemaVersion:state.schemaVersion,engine:'pulse-onchain-monitor',chain,chainId:state.chainId,status:state.lastAttempt.status,complete:state.lastAttempt.complete,
  generatedAt:state.generatedAt,coverage:state.coverage,lastAttempt:state.lastAttempt,events:state.events};
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
  if(!force&&previous&&previous.lastAttempt?.complete===true&&Number.isFinite(lastSuccess)&&now-lastSuccess<INTERVAL_MS)
   return {...publicStatus(chain,previous),skipped:true,reasonCode:'REFRESH_INTERVAL_NOT_REACHED',rpcCalls:0};
  if(!force&&previous?.lastAttempt?.complete!==true&&Number.isFinite(lastAt)&&now-lastAt<RETRY_MS)
   return {...publicStatus(chain,previous),skipped:true,reasonCode:'RETRY_BACKOFF',rpcCalls:0};
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
   const next=previous?{...previous,revision:previous.revision+1,generatedAt:at,lastAttempt:attempt}:
    {schemaVersion:1,chain,chainId:cfg.chainId,revision:1,generatedAt:at,coverage:null,lastAttempt:attempt,events:[]};
   try{await store.save(next);}catch(error){return {chain,status:'CHECKPOINT_UNAVAILABLE',complete:false,reasonCode:error.code||'PULSE_CHECKPOINT_WRITE_FAILED',rpcCalls:attempt.cost.rpcCalls};}
   return {...publicStatus(chain,next),reasonCode};
  }
  const events=(result.events||[]).filter(e=>e.confirmation?.status==='CONFIRMED');
  const startBlock=previous?.coverage?.startBlock??window.fromBlock;
  const fromBlock=window.fromBlock,toBlock=window.toBlock;
  const nextBlock=Math.max(previous?.coverage?.nextBlock||0,toBlock+1);
  const keepTo=nextBlock-1,hash=toBlock>=keepTo||!previous?.coverage?window.toBlockHash:previous.coverage.lastSuccessfulBlockHash;
  const storedEvents=mergedEvents(previous?.events,events,fromBlock,toBlock);
  const coverage={startBlock,nextBlock,lastSuccessfulBlock:keepTo,lastSuccessfulBlockHash:hash,completeFromGenesis:startBlock===0,
   reorgOverlap:Math.max(MIN_REORG_OVERLAP,cfg.confirmationDepth*2),lastSuccessfulAt:at,
   retainedEventFromBlock:storedEvents.length?Math.min(...storedEvents.map(e=>e.blockNumber)):null,retainedEvents:storedEvents.length};
  const attempt={at,status:result.status,complete:true,reasonCode:null,cost:cleanCost(result.cost),window:{fromBlock,toBlock,blocksCovered:window.blocksCovered,blocksPlanned:window.blocksPlanned,fromTimestamp:window.fromTimestamp,toTimestamp:window.toTimestamp}};
  const next={schemaVersion:1,chain,chainId:cfg.chainId,revision:(previous?.revision||0)+1,generatedAt:at,coverage,lastAttempt:attempt,events:storedEvents};
  try{await store.save(next);}catch(error){return {chain,status:'CHECKPOINT_UNAVAILABLE',complete:false,reasonCode:error.code||'PULSE_CHECKPOINT_WRITE_FAILED',rpcCalls:attempt.cost.rpcCalls};}
   return {...publicStatus(chain,next),reasonCode:null};
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
async function latest(chain,{env=process.env}={}){
 try{return publicStatus(chain,await storage.read(chain,{env}));}
 catch(error){return {schemaVersion:1,engine:'pulse-onchain-monitor',chain,chainId:watchlist.network(chain).chainId,status:'CHECKPOINT_UNAVAILABLE',complete:false,reasonCode:error.code||'PULSE_CHECKPOINT_READ_FAILED',coverage:null,lastAttempt:null,events:[]};}
}
module.exports={refreshChain,refreshAll,latest,publicStatus,mergedEvents,scanCapacity,INTERVAL_MS,RETRY_MS,MIN_REORG_OVERLAP};
