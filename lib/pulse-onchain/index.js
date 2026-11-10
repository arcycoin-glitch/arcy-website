'use strict';
// Pulse V2 on-chain entry point: bounded refresh scheduling, request de-duplication and per-network failure isolation.
// One scan per network per TTL per process; concurrent callers share the in-flight scan. A failing network never
// affects another network's result and is retried sooner than a healthy one.
const engine=require('./engine'),watchlist=require('./watchlist');
const TTL_OK=300000,TTL_DEGRADED=60000;
const cache=new Map(),inflight=new Map();
const enabled=(env=process.env)=>env.ARC_PULSE_ONCHAIN!=='0';

function disabled(chain){
 const cfg=watchlist.network(chain);
 return {schemaVersion:engine.SCHEMA_VERSION,engine:'pulse-onchain',chain,chainId:cfg.chainId,generatedAt:new Date().toISOString(),status:'DISABLED',complete:false,reasonCode:'ONCHAIN_PULSE_DISABLED',events:[],
  emptyState:'On-chain Pulse is switched off by configuration. No statement is made about network activity.'};
}
async function get(chain,{now=Date.now(),env=process.env,fetcher=fetch,scan=engine.scan,force=false,deadlineMs=6500}={}){
 watchlist.network(chain);
 if(!enabled(env))return disabled(chain);
 const hit=cache.get(chain);
 if(!force&&hit&&hit.expiresAt>now)return {...hit.value,cache:{hit:true,ageSeconds:Math.round((now-hit.storedAt)/1000)}};
 if(!inflight.has(chain)){
  inflight.set(chain,(async()=>{
   let value;
   try{value=await scan({chain,now,env,fetcher,deadlineMs});}
   catch(error){value={...disabled(chain),status:'PROVIDER_UNAVAILABLE',reasonCode:/^[A-Z_0-9]{1,60}$/.test(error?.code||'')?error.code:'ONCHAIN_SCAN_FAILED',
    emptyState:'On-chain activity could not be read. This is a data-source failure, not a quiet network.'};}
   const healthy=value.complete===true;
   // A degraded scan never replaces a still-recent complete one: serve the complete result, flagged as retained.
   const prior=cache.get(chain);
   if(!healthy&&prior?.value.complete===true&&now-prior.storedAt<6*TTL_OK){
    cache.set(chain,{...prior,expiresAt:now+TTL_DEGRADED});
    return {...prior.value,retainedAfter:{status:value.status,reasonCode:value.reasonCode,at:value.generatedAt}};
   }
   cache.set(chain,{value,storedAt:now,expiresAt:now+(healthy?TTL_OK:TTL_DEGRADED)});
   return value;
  })().finally(()=>inflight.delete(chain)));
 }
 const value=await inflight.get(chain);
 return {...value,cache:{hit:false,ageSeconds:0}};
}
async function all(options={}){
 const chains=Object.keys(watchlist.NETWORKS);
 const values=await Promise.all(chains.map(chain=>get(chain,options)));
 return Object.fromEntries(chains.map((chain,i)=>[chain,values[i]]));
}

// Maps one confirmed, material event onto the EXISTING Pulse card contract (owner / title / summary / https url).
// Used only to fill a slot that would otherwise show a non-news source guide; never replaces dated verified news.
function card(event){
 if(!event||event.confirmation?.status!=='CONFIRMED'||!['HIGH','MEDIUM'].includes(event.materiality?.level)||!event.eventTimestamp||!/^https:\/\//.test(event.evidence?.reference||''))return null;
 const cfg=watchlist.network(event.network);
 return {owner:cfg.label.toUpperCase()+' · ON-CHAIN EVENT',title:event.headline,
  summary:event.summary+' Verified: '+(event.verification==='ONCHAIN_CONFIRMED_STATE_CORROBORATED'?'confirmed log, still in effect at the scan head':'confirmed log from the watched contract')+'. Materiality: '+event.materiality.level+'. Not proven: intent, identity of the accounts or market impact.',
  url:event.evidence.reference,linkLabel:'VIEW TRANSACTION ↗',publishedAt:event.eventTimestamp,verifiedCurrentWeek:false,contentType:'ONCHAIN_EVENT',
  onchain:{id:event.id,category:event.category,verification:event.verification,materiality:event.materiality.level,transactionHash:event.transactionHash}};
}
function cards(result,limit=3){
 if(!result||!['EVENTS_DETECTED','PARTIAL_COVERAGE'].includes(result.status))return [];
 return result.events.map(card).filter(Boolean).slice(0,limit);
}
// Non-blocking read for latency-sensitive callers (homepage bundle): returns the cached scan or null and starts a
// refresh in the background. Never throws and never waits on a provider.
function peek(chain,options={}){
 const now=options.now??Date.now(),hit=cache.get(chain);
 if(!hit||hit.expiresAt<=now)get(chain,options).catch(()=>{});
 return hit&&now-hit.storedAt<6*TTL_OK?hit.value:null;
}
function reset(){cache.clear();inflight.clear();}
module.exports={get,all,peek,card,cards,enabled,reset,TTL_OK,TTL_DEGRADED};
