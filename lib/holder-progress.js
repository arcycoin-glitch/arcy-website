'use strict';
// In-process, secret-free per-token progress and scheduling counters for the persistent Holder worker. Nothing here is
// persisted or published: the durable truth stays in the signed checkpoints. It feeds (a) the fair scheduler's
// remaining-work estimate and (b) the authenticated /holder/rpc-diagnostics route.
const tokens=new Map(),totals={invocations:0,slices:0,complete:0,yielded:0,failed:0,building:0,cooldownYields:0,starvationPicks:0,smallestFirstPicks:0,oldestFirstPicks:0};
let lastInvocation=null;
const entry=a=>{let e=tokens.get(a);if(!e){e={address:a,phase:null,cursor:null,target:null,remainingBlocks:null,remainingBalances:null,remainingCalls:null,width:null,candidates:null,advancedTotal:0,slices:0,yields:0,failures:0,completes:0,lastReason:null,lastState:null,lastServedAt:null,lastProgressAt:null,lastSliceMs:null,lastAdvanced:null,firstSeenAt:Date.now(),primed:false};tokens.set(a,e);}return e;};
// Called by the checkpoint builder after every durable save (and once after load).
function note(a,s,now=Date.now()){
 const e=entry(a),head=s.block?Number(BigInt(s.block)):null,width=Math.max(1,Number(s.phase==='CATCHUP'?s.catchupRange:s.tailRange)||1000);
 let cursor=null,rb=null,rbal=null,calls=null;
 if(s.phase==='TAIL'&&head!==null){cursor=s.tailCursor;rb=Math.max(0,head-cursor+1);calls=Math.ceil(rb/width);}
 else if(s.phase==='CATCHUP'&&head!==null){cursor=s.catchupCursor;rb=Math.max(0,head-cursor+1);calls=Math.ceil(rb/width);}
 else if(s.phase==='READ'){cursor=s.balanceCursor;rbal=Math.max(0,(s.addresses?.length||0)-(s.balanceCursor||0));calls=Math.ceil(rbal/200);}
 else if(s.phase==='DISCOVER'){cursor=s.offset??0;}
 if(e.phase===s.phase&&e.cursor!==null&&cursor!==null&&cursor>e.cursor){e.advancedTotal+=cursor-e.cursor;e.lastProgressAt=now;}
 Object.assign(e,{phase:s.phase||null,cursor,target:head,remainingBlocks:rb,remainingBalances:rbal,remainingCalls:calls,width:s.phase==='TAIL'||s.phase==='CATCHUP'?width:null,candidates:s.addresses?.length??null});
}
const get=a=>tokens.get(a)||null;
function sliceDone(a,{state,reason,elapsedMs,advancedBefore,now=Date.now(),served=true}){
 const e=entry(a),adv=e.advancedTotal-(advancedBefore||0);
 e.slices++;if(served)e.lastServedAt=now;e.lastState=state;e.lastReason=reason||null;e.lastSliceMs=elapsedMs;e.lastAdvanced=adv;
 totals.slices++;
 if(state==='COMPLETE'){e.completes++;totals.complete++;}else if(state==='FAILED'||state==='UNSUPPORTED'){e.failures++;totals.failed++;}else totals.building++;
 if(reason==='HOLDER_WORKER_BUDGET_EXHAUSTED'||reason==='RPC_COOLDOWN_YIELD'){e.yields++;totals.yielded++;if(reason==='RPC_COOLDOWN_YIELD')totals.cooldownYields++;}
}
function markPrimed(a){entry(a).primed=true;}
function pick(kind){if(kind==='starved')totals.starvationPicks++;else if(kind==='oldest')totals.oldestFirstPicks++;else totals.smallestFirstPicks++;}
function invocation(summary){totals.invocations++;lastInvocation=summary;}
function snapshot(now=Date.now()){
 const list=[...tokens.values()].map(e=>({...e,idleMs:e.lastServedAt===null?null:Math.max(0,now-e.lastServedAt)})).sort((a,b)=>String(a.address).localeCompare(String(b.address)));
 return {totals:{...totals},lastInvocation,tokens:list};
}
function _reset(){tokens.clear();for(const k of Object.keys(totals))totals[k]=0;lastInvocation=null;}
module.exports={note,markPrimed,get,sliceDone,pick,invocation,snapshot,_reset};
