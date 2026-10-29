// Persistent-worker-only transport. Web/API RPC behavior is deliberately unchanged.
const budget=require('./holder-budget');
function create({endpoints,fetcher=fetch,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),interval=500}={}){
 const providers=[...new Set(endpoints)].map((url,i)=>({label:i===0?'primary':'fallback'+i,url,next:0,cooldown:0,failures:0,active:0,limit:2,interval,checked:false,successes:0,lastFault:0,gap:new Map(),stat:{calls:0,http429:0,answeredErrors:0,historyUnavailable:0}}));
 const metrics={requests:0,successful:0,http429:0,errors:0,fallbacks:0,backoffMs:0,pacingMs:0,cooldownWaitMs:0};let cursor=0;
 const failure=(code,extra={})=>Object.assign(Error(code),{code,...extra});
 // Pruned / unavailable-history answers (e.g. Blockdaemon JSON-RPC 4444) are a capability limit of ONE provider for
 // ONE method over an old block range: remembered per provider+method with expiry, never a provider outage.
 const HISTORY=/pruned|history (?:is )?unavailable|missing trie node|state (?:is )?(?:pruned|not available|unavailable)|historical state|no state available/i;
 const gapTtl=()=>Math.max(30000,Math.min(3600000,Number(process.env.ARC_HOLDER_HISTORY_GAP_TTL_MS)||600000));
 const toNum=t=>{if(typeof t!=='string'||!/^0x[0-9a-f]+$/i.test(t))return null;const n=Number(BigInt(t));return Number.isSafeInteger(n)?n:null;};
 function blockOf(req){const q=req?.params||[];switch(req?.method){case 'eth_getLogs':return toNum(q[0]?.fromBlock);case 'eth_call':case 'eth_getBalance':case 'eth_getCode':return toNum(q[1]);case 'eth_getBlockByNumber':return toNum(q[0]);default:return null;}}
 const gapped=(p,payload)=>(Array.isArray(payload)?payload:[payload]).some(r=>{const b=blockOf(r),g=p.gap.get(r?.method);return b!==null&&g&&now()<g.until&&b<=g.below;});
 // Nodes word contract execution failures differently ("execution reverted", code 3, "VM execution error",
 // "invalid opcode"...). On eth_call these are conclusive getter outcomes, not provider faults.
 const EXEC=/revert|execution error|vm exception|invalid opcode|out of gas|call exception|abi decod|stack (?:underflow|overflow)/i;
 const revertish=(x,req)=>EXEC.test(x?.error?.message||'')&&(/revert/i.test(x.error.message)||req?.method==='eth_call')||(req?.method==='eth_call'&&x?.error?.code===3);
 // Secret-free provider label: endpoint URLs may embed API keys, so only the slot is ever reported.
 const sanitizeMsg=m=>String(m||'').replace(/https?:\/\/[^\s"']+/gi,'[url]').replace(/\b(?!0x)[A-Za-z0-9_-]{32,}\b/g,'[redacted]').slice(0,120);
 async function wait(ms,kind='cooldownWaitMs'){if(ms>=budget.remaining())throw failure('HOLDER_WORKER_BUDGET_EXHAUSTED',{eligibleInMs:ms});metrics.backoffMs+=ms;metrics[kind]+=ms;await sleep(ms);budget.check();}
 // Pacing penalties decay with QUIET TIME, not only with successes: at an inflated interval successes are too rare to ever
 // earn the recovery back (observed: interval ratcheted to 8 s, slices became 1-2 requests, cursors stalled). Decay never
 // goes below the configured base interval, so the steady-state request rate and cost are unchanged.
 const relaxMs=()=>Math.max(2000,Math.min(300000,Number(process.env.ARC_HOLDER_RPC_RELAX_MS)||15000));
 function relax(p){if(p.lastFault&&(p.interval>interval||p.limit<2)&&now()-p.lastFault>=relaxMs()){p.interval=Math.max(interval,Math.floor(p.interval/2));if(p.interval<=interval)p.limit=2;p.lastFault=now();}}
 function cool(p,e){p.lastFault=now();p.failures++;p.successes=0;p.limit=1;p.interval=Math.min(8000,Math.max(interval,p.interval)*2);const retry=Number(e.retryAfterMs)||0;p.cooldown=now()+Math.max(retry,Math.min(120000,2000*2**Math.min(p.failures,6)));}
 async function wire(p,payload){const count=Array.isArray(payload)?payload.length:1;const start=Math.max(now(),p.next),delay=start-now();if(delay>=budget.remaining())throw failure('HOLDER_WORKER_BUDGET_EXHAUSTED',{eligibleInMs:delay});p.stat.calls++;p.next=start+p.interval*count;if(delay)await wait(delay,'pacingMs');budget.check();metrics.requests++;
  const timeout=Math.max(1,Math.min(8000,budget.remaining()));let r;
  try{r=await fetcher(p.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeout)});}catch(e){if((timeout<8000||budget.remaining()<=0)&&['TimeoutError','AbortError'].includes(e.name))throw failure('HOLDER_WORKER_BUDGET_EXHAUSTED');throw e;}
  if(!r.ok){const value=r.headers?.get('retry-after'),retryAfterMs=value?(Number.isFinite(Number(value))?Number(value)*1000:Math.max(0,Date.parse(value)-now())):0;if(r.status===429){metrics.http429++;p.stat.http429++;}if(r.status===400){let d;try{d=await r.json();}catch{}if(/block range|ranges? over|range.*(?:large|limit|exceed)|too many (?:logs|results)/i.test(d?.error?.message||''))throw failure('RPC_RANGE_LIMIT',{rpcCode:d.error.code});}throw failure('RPC_HTTP_ERROR',{httpStatus:r.status,retryAfterMs});}
  let d;try{d=await r.json();}catch(e){if((timeout<8000||budget.remaining()<=0)&&['TimeoutError','AbortError'].includes(e.name))throw failure('HOLDER_WORKER_BUDGET_EXHAUSTED');throw e;}const items=Array.isArray(payload)?d:[d],requests=Array.isArray(payload)?payload:[payload];
  if(!Array.isArray(items)||items.length!==requests.length||new Set(items.map(x=>x?.id)).size!==requests.length||requests.some(x=>!items.some(y=>y?.id===x.id&&(Object.hasOwn(y,'result')||y.error))))throw failure('MALFORMED_RPC_RESPONSE');
  for(const x of items){if(!x.error)continue;const m=x.error.message||'';if(x.error.code===4444||HISTORY.test(m)){const req=requests.find(y=>y.id===x.id);throw failure('RPC_CALL_FAILED',{rpcCode:x.error.code,rpcMessage:sanitizeMsg(m),rpcMethod:req?.method,answered:true,historyUnavailable:true,historyBlock:req?.method==='eth_getLogs'?(toNum(req.params?.[0]?.toBlock)??blockOf(req)):blockOf(req)});}if(/block range|ranges? over|range.*(?:large|limit|exceed)|too many (?:logs|results)|query returned more/i.test(m))throw failure('RPC_RANGE_LIMIT',{rpcCode:x.error.code});if(/rate.limit|too many|quota|capacity|request limit|limit exceeded/i.test(m)||[-32005,-32016].includes(x.error.code))throw failure('RPC_RATE_LIMIT',{rpcCode:x.error.code});
   // A generic provider-level JSON-RPC error must try the next verified
   // provider. Contract execution reverts remain conclusive getter outcomes.
   if(!revertish(x,requests.find(y=>y.id===x.id)))throw failure('RPC_CALL_FAILED',{rpcCode:x.error.code,rpcMessage:sanitizeMsg(m),rpcMethod:requests.find(y=>y.id===x.id)?.method,answered:true});
  }
  metrics.successful++;return d;
 }
 async function transport(payload){const tried=new Set(),attempts=[],answeredBy=new Set();let last;
  {const gp=providers.filter(p=>gapped(p,payload));if(gp.length&&gp.length<providers.length)for(const p of gp){tried.add(p);metrics.historySkips=(metrics.historySkips||0)+1;}}
  while(tried.size<providers.length){budget.check();let selected;providers.forEach(relax);
   let earliest=Infinity,selectedIndex=0;for(let i=0;i<providers.length;i++){const index=(cursor+i)%providers.length,p=providers[index];if(!tried.has(p)&&p.cooldown<=now()&&p.active<p.limit&&Math.max(now(),p.next)+(p.misses||0)*250<earliest){selected=p;selectedIndex=index;earliest=Math.max(now(),p.next)+(p.misses||0)*250;}}if(selected)cursor=(selectedIndex+1)%providers.length;
   if(!selected){const available=providers.filter(p=>!tried.has(p)&&Number.isFinite(p.cooldown));if(!available.length)throw Object.assign(last||failure('RPC_PROVIDERS_UNAVAILABLE'),{attempts});const delay=Math.max(25,Math.min(...available.map(p=>p.cooldown>now()?p.cooldown-now():50)));await wait(delay);continue;}
   const p=selected;tried.add(p);p.active++;
   try{if(!p.checked){const identity=await wire(p,{jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]});{let id=null;try{id=BigInt(identity.result);}catch{}if(id!==5042n)throw failure('CHAIN_ID_MISMATCH',{reportedChainId:id===null?null:String(id)});}p.checked=true;}
    const d=await wire(p,payload);p.failures=0;p.misses=0;p.successes++;for(const r of Array.isArray(payload)?payload:[payload]){const g=p.gap.get(r?.method),b=blockOf(r);if(g&&b!==null&&b<=g.below)p.gap.delete(r.method);}if(p.successes>=20){p.limit=2;p.interval=Math.max(interval,p.interval*.9);p.successes=0;}if(tried.size>1)metrics.fallbacks++;return d;
   }catch(e){last=e;if(e.code==='HOLDER_WORKER_BUDGET_EXHAUSTED')throw e;metrics.errors++;attempts.push({provider:p.label,class:e.code||e.name||'ERROR',httpStatus:e.httpStatus||null,rpcCode:e.rpcCode??null,method:e.rpcMethod||null,message:e.rpcMessage||(e.code?null:sanitizeMsg(e.message))});metrics.lastFailure=attempts.at(-1);if(e.code==='RPC_RANGE_LIMIT')throw Object.assign(e,{attempts});if(e.answered){p.misses=Math.min(20,(p.misses||0)+1);answeredBy.add(p);p.stat.answeredErrors++;if(e.historyUnavailable){p.stat.historyUnavailable++;if(e.historyBlock!==null&&e.historyBlock!==undefined&&e.rpcMethod){const g=p.gap.get(e.rpcMethod);{const live=g&&now()<g.until,streak=(live?g.streak:0)+1;
    // A single pruned answer covers the failed range; three in a row mean this provider keeps no usable history for the
    // method, so every historical (numeric-block) request skips it until the entry expires and one request re-probes.
    p.gap.set(e.rpcMethod,{below:streak>=3?Infinity:Math.max(live?g.below:-1,e.historyBlock),until:now()+gapTtl(),streak});}}}}else cool(p,e);if(e.code==='CHAIN_ID_MISMATCH')p.cooldown=Infinity;
   }finally{p.active--;}
  }
  // Quota exhaustion inside a scheduled slice is a yield, not a failure: report when a rate-limited provider becomes
  // eligible so the scheduler can requeue the token instead of retrying immediately or marking the job FAILED.
  if(budget.remaining()!==Infinity&&attempts.some(a=>a.httpStatus===429||a.class==='RPC_RATE_LIMIT')){const cooling=providers.filter(p=>Number.isFinite(p.cooldown)&&p.cooldown>now()).map(p=>p.cooldown-now());if(cooling.length)throw failure('HOLDER_WORKER_BUDGET_EXHAUSTED',{eligibleInMs:Math.min(...cooling),quota:true,attempts});}
  throw Object.assign(last||failure('RPC_PROVIDERS_UNAVAILABLE'),{attempts});
 }
 async function rpc(method,params){const d=await transport({jsonrpc:'2.0',id:1,method,params});if(d.error)throw failure(revertish(d,{method})?'GETTER_REVERTED':'RPC_CALL_FAILED',{rpcCode:d.error.code});return d.result;}
 async function batch(calls){if(!Array.isArray(calls)||!calls.length||calls.length>100)throw Error('RPC batch must contain 1-100 calls');const out=[];for(let start=0;start<calls.length;start+=5){const chunk=calls.slice(start,start+5),payload=chunk.map((x,i)=>({...x,jsonrpc:'2.0',id:i+1})),d=await transport(payload);for(const x of payload){const item=d.find(y=>y.id===x.id);if(item.error)throw failure('RPC_BATCH_ITEM_FAILED',{rpcCode:item.error.code});out.push(item.result);}}return out;}
 async function diagnose(){
  // Read-only per-provider probe: chain id, head, one eth_call, one tiny getLogs. Never throws; no secrets.
  const out=[];
  for(const p of providers){
   const row={provider:p.label,steps:{}};
   const step=async(name,method,params)=>{const t=Date.now();
    try{const r=await fetcher(p.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(6000)});
     if(!r.ok){row.steps[name]={ok:false,httpStatus:r.status,ms:Date.now()-t};return null;}
     const d=await r.json();row.steps[name]=d?.error?{ok:false,rpcCode:d.error.code,message:sanitizeMsg(d.error.message),ms:Date.now()-t}:{ok:true,ms:Date.now()-t};return d?.result;}
    catch(e){row.steps[name]={ok:false,class:e?.name==='TimeoutError'?'TIMEOUT':'TRANSPORT',message:sanitizeMsg(e?.message),ms:Date.now()-t};return null;}};
   const id=await step('eth_chainId','eth_chainId',[]);
   if(id!==null&&id!==undefined){let n=null;try{n=BigInt(id);}catch{}row.chainId=n===null?null:String(n);row.chainOk=n===5042n;}
   const head=await step('eth_blockNumber','eth_blockNumber',[]);
   if(head){const h=Number(BigInt(head));row.head=h;
    await step('eth_getLogs_8_blocks','eth_getLogs',[{fromBlock:'0x'+(h-8).toString(16),toBlock:'0x'+h.toString(16),topics:[]}]);}
   await step('eth_call_nonexistent','eth_call',[{to:'0x'+'0'.repeat(38)+'01',data:'0x313ce567'},'latest']);
   // Historical-state and batch capability: the Holder needs both. Neither is a provider fault when it fails
   // here, but the report shows which provider can serve them so selection problems are visible.
   if(head){const h=Number(BigInt(head));
    await step('historical_getBalance_10k_blocks_back','eth_getBalance',['0x'+'0'.repeat(38)+'01','0x'+Math.max(1,h-10000).toString(16)]);
    const t=Date.now();
    try{const r=await fetcher(p.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify([1,2,3,4,5].map(id=>({jsonrpc:'2.0',id,method:'eth_blockNumber',params:[]}))),signal:AbortSignal.timeout(6000)});
     if(!r.ok)row.steps.batch_of_5={ok:false,httpStatus:r.status,ms:Date.now()-t};
     else{const d=await r.json();row.steps.batch_of_5=Array.isArray(d)&&d.length===5&&d.every(x=>x&&!x.error)?{ok:true,ms:Date.now()-t}:{ok:false,message:sanitizeMsg(Array.isArray(d)?d.find(x=>x?.error)?.error?.message:d?.error?.message),ms:Date.now()-t};}}
    catch(e){row.steps.batch_of_5={ok:false,class:e?.name==='TimeoutError'?'TIMEOUT':'TRANSPORT',message:sanitizeMsg(e?.message),ms:Date.now()-t};}}
   out.push(row);
  }
  return out;
 }
 return {rpc,batch,diagnose,providerLabels:()=>providers.map(p=>p.label),metrics:()=>({...metrics}),health:()=>providers.map(p=>({active:p.active,limit:p.limit,interval:p.interval,baseInterval:interval,cooldownMs:Math.max(0,p.cooldown-now()),...p.stat,historyGaps:[...p.gap].filter(([,g])=>now()<g.until).length})),
  // Earliest moment (ms from now) any provider can take a request; lets the scheduler requeue instead of burning a slice.
  readyInMs:()=>Math.min(...providers.map(p=>Number.isFinite(p.cooldown)?Math.max(0,p.cooldown-now(),p.next-now()):Infinity))};
}
let instance;function current(){return instance||(instance=create({interval:Math.max(50,Math.min(5000,Number(process.env.ARC_HOLDER_RPC_INTERVAL_MS)||500)),endpoints:[process.env.ARC_RPC_URL||'https://rpc.mainnet.arc.io',...(process.env.ARC_RPC_FALLBACK_URLS||'https://rpc.quicknode.mainnet.arc.io,https://rpc.blockdaemon.mainnet.arc.io').split(',').map(x=>x.trim()).filter(Boolean)]}));}
module.exports={create,current};
