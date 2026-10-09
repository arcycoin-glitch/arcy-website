const pending=new Map(),recent=new Map();
async function enqueue(a){const url=process.env.ARC_HOLDER_QUEUE_URL,token=process.env.ARC_HOLDER_QUEUE_TOKEN;
 if(!url||!token)return {queued:false,reasonCode:'BACKGROUND_QUEUE_NOT_CONFIGURED'};
 if(pending.has(a))return pending.get(a);if(recent.get(a)>Date.now())return {queued:true,coalesced:true};
 const task=(async()=>{try{const endpoint=new URL(url);if(endpoint.protocol!=='https:')return {queued:false,reasonCode:'BACKGROUND_QUEUE_CONFIGURATION_INVALID'};
 const r=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({chainId:5042,address:a}),signal:AbortSignal.timeout(4000)});
 const d=await r.json();if(!r.ok||d.queued!==true)return {queued:false,reasonCode:'BACKGROUND_QUEUE_UNAVAILABLE'};
 recent.set(a,Date.now()+60000);if(recent.size>1000)recent.delete(recent.keys().next().value);return {queued:true,job:d.job||null};
 }catch{return {queued:false,reasonCode:'BACKGROUND_QUEUE_UNAVAILABLE'};}})();pending.set(a,task);try{return await task;}finally{pending.delete(a);}
}
async function status(a){const url=process.env.ARC_HOLDER_QUEUE_URL,token=process.env.ARC_HOLDER_QUEUE_TOKEN;if(!url||!token)return {ok:false,reasonCode:'BACKGROUND_QUEUE_NOT_CONFIGURED'};try{const endpoint=new URL(url);endpoint.pathname='/job';endpoint.searchParams.set('address',a);const r=await fetch(endpoint,{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(2500)}),d=await r.json();return r.ok&&d?.ok===true?d:{ok:false,reasonCode:d?.reasonCode||'HOLDER_JOB_STATUS_UNAVAILABLE'};}catch{return {ok:false,reasonCode:'HOLDER_JOB_STATUS_UNAVAILABLE'};}}
module.exports={enqueue,status};
