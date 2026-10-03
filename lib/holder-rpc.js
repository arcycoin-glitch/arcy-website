// Persistent-worker-only transport. Web/API RPC behavior is deliberately unchanged.
const budget=require('./holder-budget');
function create({endpoints,fetcher=fetch,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),interval=500}={}){
 const providers=[...new Set(endpoints)].map(url=>({url,next:0,cooldown:0,failures:0,active:0,limit:2,interval,checked:false,successes:0}));
 const metrics={requests:0,successful:0,http429:0,errors:0,fallbacks:0,backoffMs:0,pacingMs:0,cooldownWaitMs:0};let cursor=0;
 const failure=(code,extra={})=>Object.assign(Error(code),{code,...extra});
 async function wait(ms,kind='cooldownWaitMs'){if(ms>=budget.remaining())throw failure('HOLDER_WORKER_BUDGET_EXHAUSTED');metrics.backoffMs+=ms;metrics[kind]+=ms;await sleep(ms);budget.check();}
 function cool(p,e){p.failures++;p.successes=0;p.limit=1;p.interval=Math.min(8000,p.interval*2);const retry=Number(e.retryAfterMs)||0;p.cooldown=now()+Math.max(retry,Math.min(120000,2000*2**Math.min(p.failures,6)));}
 async function wire(p,payload){const count=Array.isArray(payload)?payload.length:1;const start=Math.max(now(),p.next),delay=start-now();if(delay>=budget.remaining())throw failure('HOLDER_WORKER_BUDGET_EXHAUSTED');p.next=start+p.interval*count;if(delay)await wait(delay,'pacingMs');budget.check();metrics.requests++;
  const r=await fetcher(p.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(Math.max(1,Math.min(8000,budget.remaining())))});
  if(!r.ok){const value=r.headers?.get('retry-after'),retryAfterMs=value?(Number.isFinite(Number(value))?Number(value)*1000:Math.max(0,Date.parse(value)-now())):0;if(r.status===429)metrics.http429++;if(r.status===400){let d;try{d=await r.json();}catch{}if(/block range|ranges? over|range.*(?:large|limit|exceed)|too many (?:logs|results)/i.test(d?.error?.message||''))throw failure('RPC_RANGE_LIMIT',{rpcCode:d.error.code});}throw failure('RPC_HTTP_ERROR',{httpStatus:r.status,retryAfterMs});}
  const d=await r.json(),items=Array.isArray(payload)?d:[d],requests=Array.isArray(payload)?payload:[payload];
  if(!Array.isArray(items)||items.length!==requests.length||new Set(items.map(x=>x?.id)).size!==requests.length||requests.some(x=>!items.some(y=>y?.id===x.id&&(Object.hasOwn(y,'result')||y.error))))throw failure('MALFORMED_RPC_RESPONSE');
  for(const x of items){if(!x.error)continue;const m=x.error.message||'';if(/block range|ranges? over|range.*(?:large|limit|exceed)|too many (?:logs|results)|query returned more/i.test(m))throw failure('RPC_RANGE_LIMIT',{rpcCode:x.error.code});if(/rate.limit|too many|quota|capacity|request limit|limit exceeded/i.test(m)||[-32005,-32016].includes(x.error.code))throw failure('RPC_RATE_LIMIT',{rpcCode:x.error.code});}
  metrics.successful++;return d;
 }
 async function transport(payload){const tried=new Set();let last;
  while(tried.size<providers.length){budget.check();let selected;
   let earliest=Infinity,selectedIndex=0;for(let i=0;i<providers.length;i++){const index=(cursor+i)%providers.length,p=providers[index];if(!tried.has(p)&&p.cooldown<=now()&&p.active<p.limit&&Math.max(now(),p.next)<earliest){selected=p;selectedIndex=index;earliest=Math.max(now(),p.next);}}if(selected)cursor=(selectedIndex+1)%providers.length;
   if(!selected){const available=providers.filter(p=>!tried.has(p)&&Number.isFinite(p.cooldown));if(!available.length)throw last||failure('RPC_PROVIDERS_UNAVAILABLE');const delay=Math.max(25,Math.min(...available.map(p=>p.cooldown>now()?p.cooldown-now():50)));await wait(delay);continue;}
   const p=selected;tried.add(p);p.active++;
   try{if(!p.checked){const identity=await wire(p,{jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]});if(identity.result!=='0x13b2')throw failure('CHAIN_ID_MISMATCH');p.checked=true;}
    const d=await wire(p,payload);p.failures=0;p.successes++;if(p.successes>=20){p.limit=2;p.interval=Math.max(interval,p.interval*.9);p.successes=0;}if(tried.size>1)metrics.fallbacks++;return d;
   }catch(e){last=e;metrics.errors++;if(e.code==='RPC_RANGE_LIMIT')throw e;if(e.code==='HOLDER_WORKER_BUDGET_EXHAUSTED')throw e;cool(p,e);if(e.code==='CHAIN_ID_MISMATCH')p.cooldown=Infinity;
   }finally{p.active--;}
  }throw last||failure('RPC_PROVIDERS_UNAVAILABLE');
 }
 async function rpc(method,params){const d=await transport({jsonrpc:'2.0',id:1,method,params});if(d.error)throw failure(/revert/i.test(d.error.message||'')?'GETTER_REVERTED':'RPC_CALL_FAILED',{rpcCode:d.error.code});return d.result;}
 async function batch(calls){if(!Array.isArray(calls)||!calls.length||calls.length>100)throw Error('RPC batch must contain 1-100 calls');const out=[];for(let start=0;start<calls.length;start+=5){const chunk=calls.slice(start,start+5),payload=chunk.map((x,i)=>({...x,jsonrpc:'2.0',id:i+1})),d=await transport(payload);for(const x of payload){const item=d.find(y=>y.id===x.id);if(item.error)throw failure('RPC_BATCH_ITEM_FAILED',{rpcCode:item.error.code});out.push(item.result);}}return out;}
 return {rpc,batch,metrics:()=>({...metrics}),health:()=>providers.map(p=>({active:p.active,limit:p.limit,interval:p.interval,cooldownMs:Math.max(0,p.cooldown-now())}))};
}
let instance;function current(){return instance||(instance=create({endpoints:[process.env.ARC_RPC_URL||'https://rpc.mainnet.arc.io',...(process.env.ARC_RPC_FALLBACK_URLS||'https://rpc.quicknode.mainnet.arc.io,https://rpc.blockdaemon.mainnet.arc.io').split(',').map(x=>x.trim()).filter(Boolean)]}));}
module.exports={create,current};
