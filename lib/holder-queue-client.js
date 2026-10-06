const pending=new Map(),recent=new Map();
async function enqueue(a){const url=process.env.ARC_HOLDER_QUEUE_URL,token=process.env.ARC_HOLDER_QUEUE_TOKEN;
 if(!url||!token)return {queued:false,reasonCode:'BACKGROUND_QUEUE_NOT_CONFIGURED'};
 if(pending.has(a))return pending.get(a);if(recent.get(a)>Date.now())return {queued:true,coalesced:true};
 const task=(async()=>{try{const endpoint=new URL(url);if(endpoint.protocol!=='https:')return {queued:false,reasonCode:'BACKGROUND_QUEUE_CONFIGURATION_INVALID'};
 const r=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({chainId:5042,address:a}),signal:AbortSignal.timeout(1500)});
 const d=await r.json();if(!r.ok||d.queued!==true)return {queued:false,reasonCode:'BACKGROUND_QUEUE_UNAVAILABLE'};
 recent.set(a,Date.now()+60000);if(recent.size>1000)recent.delete(recent.keys().next().value);return {queued:true};
 }catch{return {queued:false,reasonCode:'BACKGROUND_QUEUE_UNAVAILABLE'};}})();pending.set(a,task);try{return await task;}finally{pending.delete(a);}
}
module.exports={enqueue};
