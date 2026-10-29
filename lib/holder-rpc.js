// Persistent-worker-only transport. Web/API RPC behavior is deliberately unchanged.
const budget=require('./holder-budget');
function create({endpoints,fetcher=fetch,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),interval=500}={}){
 const providers=[...new Set(endpoints)].map((url,i)=>({label:i===0?'primary':'fallback'+i,url,next:0,cooldown:0,failures:0,active:0,limit:2,interval,checked:false,successes:0}));
 const metrics={requests:0,successful:0,http429:0,errors:0,fallbacks:0,backoffMs:0,pacingMs:0,cooldownWaitMs:0};let cursor=0;
 const failure=(code,extra={})=>Object.assign(Error(code),{code,...extra});
 // Nodes word contract execution failures differently ("execution reverted", code 3, "VM execution error",
 // "invalid opcode"...). On eth_call these are conclusive getter outcomes, not provider faults.
 const EXEC=/revert|execution error|vm exception|invalid opcode|out of gas|call exception|abi decod|stack (?:underflow|overflow)/i;
 const revertish=(x,req)=>EXEC.test(x?.error?.message||'')&&(/revert/i.test(x.error.message)||req?.method==='eth_call')||(req?.method==='eth_call'&&x?.error?.code===3);
 // Secret-free provider label: endpoint URLs may embed API keys, so only the slot is ever reported.
 const sanitizeMsg=m=>String(m||'').replace(/https?:\/\/[^\s"']+/gi,'[url]').replace(/\b(?!0x)[A-Za-z0-9_-]{32,}\b/g,'[redacted]').slice(0,120);
 async function wait(ms,kind='cooldownWaitMs'){if(ms>=budget.remaining())throw failure('HOLDER_WORKER_BUDGET_EXHAUSTED');metrics.backoffMs+=ms;metrics[kind]+=ms;await sleep(ms);budget.check();}
 function cool(p,e){p.failures++;p.successes=0;p.limit=1;p.interval=Math.min(8000,p.interval*2);const retry=Number(e.retryAfterMs)||0;p.cooldown=now()+Math.max(retry,Math.min(120000,2000*2**Math.min(p.failures,6)));}
 async function wire(p,payload){const count=Array.isArray(payload)?payload.length:1;const start=Math.max(now(),p.next),delay=start-now();if(delay>=budget.remaining())throw failure('HOLDER_WORKER_BUDGET_EXHAUSTED');p.next=start+p.interval*count;if(delay)await wait(delay,'pacingMs');budget.check();metrics.requests++;
  const timeout=Math.max(1,Math.min(8000,budget.remaining()));let r;
  try{r=await fetcher(p.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeout)});}catch(e){if((timeout<8000||budget.remaining()<=0)&&['TimeoutError','AbortError'].includes(e.name))throw failure('HOLDER_WORKER_BUDGET_EXHAUSTED');throw e;}
  if(!r.ok){const value=r.headers?.get('retry-after'),retryAfterMs=value?(Number.isFinite(Number(value))?Number(value)*1000:Math.max(0,Date.parse(value)-now())):0;if(r.status===429)metrics.http429++;if(r.status===400){let d;try{d=await r.json();}catch{}if(/block range|ranges? over|range.*(?:large|limit|exceed)|too many (?:logs|results)/i.test(d?.error?.message||''))throw failure('RPC_RANGE_LIMIT',{rpcCode:d.error.code});}throw failure('RPC_HTTP_ERROR',{httpStatus:r.status,retryAfterMs});}
  let d;try{d=await r.json();}catch(e){if((timeout<8000||budget.remaining()<=0)&&['TimeoutError','AbortError'].includes(e.name))throw failure('HOLDER_WORKER_BUDGET_EXHAUSTED');throw e;}const items=Array.isArray(payload)?d:[d],requests=Array.isArray(payload)?payload:[payload];
  if(!Array.isArray(items)||items.length!==requests.length||new Set(items.map(x=>x?.id)).size!==requests.length||requests.some(x=>!items.some(y=>y?.id===x.id&&(Object.hasOwn(y,'result')||y.error))))throw failure('MALFORMED_RPC_RESPONSE');
  for(const x of items){if(!x.error)continue;const m=x.error.message||'';if(/block range|ranges? over|range.*(?:large|limit|exceed)|too many (?:logs|results)|query returned more/i.test(m))throw failure('RPC_RANGE_LIMIT',{rpcCode:x.error.code});if(/rate.limit|too many|quota|capacity|request limit|limit exceeded/i.test(m)||[-32005,-32016].includes(x.error.code))throw failure('RPC_RATE_LIMIT',{rpcCode:x.error.code});
   // A generic provider-level JSON-RPC error must try the next verified
   // provider. Contract execution reverts remain conclusive getter outcomes.
   if(!revertish(x,requests.find(y=>y.id===x.id)))throw failure('RPC_CALL_FAILED',{rpcCode:x.error.code,rpcMessage:sanitizeMsg(m),rpcMethod:requests.find(y=>y.id===x.id)?.method});
  }
  metrics.successful++;return d;
 }
 async function transport(payload){const tried=new Set(),attempts=[];let last;
  while(tried.size<providers.length){budget.check();let selected;
   let earliest=Infinity,selectedIndex=0;for(let i=0;i<providers.length;i++){const index=(cursor+i)%providers.length,p=providers[index];if(!tried.has(p)&&p.cooldown<=now()&&p.active<p.limit&&Math.max(now(),p.next)<earliest){selected=p;selectedIndex=index;earliest=Math.max(now(),p.next);}}if(selected)cursor=(selectedIndex+1)%providers.length;
   if(!selected){const available=providers.filter(p=>!tried.has(p)&&Number.isFinite(p.cooldown));if(!available.length)throw Object.assign(last||failure('RPC_PROVIDERS_UNAVAILABLE'),{attempts});const delay=Math.max(25,Math.min(...available.map(p=>p.cooldown>now()?p.cooldown-now():50)));await wait(delay);continue;}
   const p=selected;tried.add(p);p.active++;
   try{if(!p.checked){const identity=await wire(p,{jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]});{let id=null;try{id=BigInt(identity.result);}catch{}if(id!==5042n)throw failure('CHAIN_ID_MISMATCH',{reportedChainId:id===null?null:String(id)});}p.checked=true;}
    const d=await wire(p,payload);p.failures=0;p.successes++;if(p.successes>=20){p.limit=2;p.interval=Math.max(interval,p.interval*.9);p.successes=0;}if(tried.size>1)metrics.fallbacks++;return d;
   }catch(e){last=e;if(e.code==='HOLDER_WORKER_BUDGET_EXHAUSTED')throw e;metrics.errors++;attempts.push({provider:p.label,class:e.code||e.name||'ERROR',httpStatus:e.httpStatus||null,rpcCode:e.rpcCode??null,method:e.rpcMethod||null,message:e.rpcMessage||(e.code?null:sanitizeMsg(e.message))});metrics.lastFailure=attempts.at(-1);if(e.code==='RPC_RANGE_LIMIT')throw Object.assign(e,{attempts});cool(p,e);if(e.code==='CHAIN_ID_MISMATCH')p.cooldown=Infinity;
   }finally{p.active--;}
  }throw Object.assign(last||failure('RPC_PROVIDERS_UNAVAILABLE'),{attempts});
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
   out.push(row);
  }
  return out;
 }
 return {rpc,batch,diagnose,providerLabels:()=>providers.map(p=>p.label),metrics:()=>({...metrics}),health:()=>providers.map(p=>({active:p.active,limit:p.limit,interval:p.interval,cooldownMs:Math.max(0,p.cooldown-now())}))};
}
let instance;function current(){return instance||(instance=create({endpoints:[process.env.ARC_RPC_URL||'https://rpc.mainnet.arc.io',...(process.env.ARC_RPC_FALLBACK_URLS||'https://rpc.quicknode.mainnet.arc.io,https://rpc.blockdaemon.mainnet.arc.io').split(',').map(x=>x.trim()).filter(Boolean)]}));}
module.exports={create,current};
