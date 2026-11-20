'use strict';
// Radar Intelligence — bounded, SSRF-hardened evidence fetcher (issue #279).
//
// Every evidence adapter goes through this module. Guarantees:
//  - HTTPS only, exact-host allowlist (no wildcards, no user-supplied hosts), no URL credentials, port 443 only.
//  - redirect:'error' — an off-site (or any) redirect is a failure, never followed.
//  - hard timeout, response size cap, strict JSON.
//  - per-provider daily request budget + per-run budget; a refused budget is an explicit error, never a silent skip.
//  - circuit breaker: N consecutive transport/5xx failures open the breaker for a cool-off period.
//  - bounded retry with backoff for 429/503 only (honours Retry-After up to a small ceiling), then provider cooldown.
//  - ETag / Last-Modified revalidation cache (304 costs no payload; still counts against budget).
//  - in-flight de-duplication of identical GETs.
//  - Authorization is attached ONLY for api.github.com and only from a server env var; never logged, never forwarded.
// Honest scope: state lives in process memory (one warm serverless instance). It bounds one instance, not the fleet.
const PROVIDERS=Object.freeze({
 github:Object.freeze({hosts:['api.github.com'],perDay:900,label:'GitHub REST API',terms:'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
  limit:'60 requests/hour unauthenticated, 5,000/hour with a token (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)'}),
 snapshot:Object.freeze({hosts:['hub.snapshot.org'],perDay:300,label:'Snapshot Hub GraphQL',terms:'https://docs.snapshot.box/tools/api',
  limit:'60 requests/minute without an API key (docs.snapshot.box/tools/api)'}),
 blockscout:Object.freeze({hosts:['eth.blockscout.com','robinhoodchain.blockscout.com'],perDay:600,label:'Blockscout explorer API',terms:'https://docs.blockscout.com/devs/apis',
  limit:'public instance limits apply; ARCY Search already reads these exact hosts'}),
 // Separate provider id: an Arc explorer outage/cooldown must never block Ethereum or Robinhood explorer reads (#279 V5).
 arcexplorer:Object.freeze({hosts:['explorer.arc.io'],perDay:200,label:'Arc explorer token index',terms:'https://explorer.arc.io',
  limit:'public instance; one token-index page per snapshot build'})
});
const HOST_TO_PROVIDER=new Map(Object.entries(PROVIDERS).flatMap(([id,p])=>p.hosts.map(h=>[h,id])));
const MAX_BYTES=512*1024,TIMEOUT_MS=8000,BREAKER_THRESHOLD=4,BREAKER_OPEN_MS=10*60*1000,MAX_RETRY_WAIT_MS=4000,COOLDOWN_MIN_MS=60*1000;
const fail=(code,extra={})=>Object.assign(Error(code),{code,...extra});
const state={day:null,used:new Map(),breaker:new Map(),cooldown:new Map(),etag:new Map(),inflight:new Map()};
const dayOf=ms=>new Date(ms).toISOString().slice(0,10);
function roll(now){const d=dayOf(now);if(state.day!==d){state.day=d;state.used.clear();}}
function check(url){
 let u;try{u=new URL(url);}catch{throw fail('INTEL_URL_INVALID');}
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))throw fail('INTEL_URL_UNSAFE');
 const provider=HOST_TO_PROVIDER.get(u.hostname.toLowerCase());
 if(!provider)throw fail('INTEL_HOST_NOT_ALLOWED',{host:u.hostname});
 return {u,provider};
}
function retryAfter(res,now){const v=res.headers?.get?.('retry-after');if(!v)return null;const n=Number(v);if(Number.isFinite(n))return Math.max(0,n*1000);const t=Date.parse(v);return Number.isFinite(t)?Math.max(0,t-now):null;}
// run = {budget:{max,used}} — per-run budget shared by the caller (engine). Optional.
async function json(url,{method='GET',body,fetcher=global.fetch,now=Date.now,env=process.env,run=null,sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=TIMEOUT_MS}={}){
 const {u,provider}=check(url),p=PROVIDERS[provider],t=typeof now==='function'?now():now;
 roll(t);
 const key=method+' '+u.toString()+(body?' '+JSON.stringify(body):'');
 if(method==='GET'&&state.inflight.has(key))return state.inflight.get(key);
 const task=(async()=>{
  const br=state.breaker.get(provider);
  if(br&&br.openUntil>t)throw fail('INTEL_CIRCUIT_OPEN',{provider,retryInMs:br.openUntil-t});
  const cd=state.cooldown.get(provider)||0;
  if(cd>t)throw fail('INTEL_PROVIDER_COOLDOWN',{provider,retryInMs:cd-t});
  for(let attempt=0;attempt<2;attempt++){
   const used=state.used.get(provider)||0;
   if(used>=p.perDay)throw fail('INTEL_DAILY_BUDGET_EXHAUSTED',{provider});
   if(run?.budget&&run.budget.used>=run.budget.max)throw fail('INTEL_RUN_BUDGET_EXHAUSTED',{provider});
   state.used.set(provider,used+1);if(run?.budget)run.budget.used++;
   if(run?.calls)run.calls[provider]=(run.calls[provider]||0)+1;
   const headers={accept:'application/json','user-agent':'arcy-radar-intel/1 (+https://www.arcyusdc.xyz)'};
   if(provider==='github'){headers.accept='application/vnd.github+json';headers['x-github-api-version']='2022-11-28';if(env.GITHUB_TOKEN&&/^[A-Za-z0-9_]{20,255}$/.test(env.GITHUB_TOKEN))headers.authorization='Bearer '+env.GITHUB_TOKEN;}
   const cached=method==='GET'?state.etag.get(key):null;
   if(cached?.etag)headers['if-none-match']=cached.etag;else if(cached?.lastModified)headers['if-modified-since']=cached.lastModified;
   if(body!==undefined)headers['content-type']='application/json';
   let res;
   try{res=await fetcher(u.toString(),{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
   catch(e){trip(provider,t);throw fail(e?.name==='TimeoutError'?'INTEL_TIMEOUT':'INTEL_UNREACHABLE',{provider});}
   if(res.status===304&&cached){heal(provider);return structuredClone(cached.data);}
   if(res.status===429||res.status===503){
    const wait=retryAfter(res,t);
    if(attempt===0&&(wait===null||wait<=MAX_RETRY_WAIT_MS)){await sleep(wait??750);continue;}
    state.cooldown.set(provider,t+Math.max(COOLDOWN_MIN_MS,wait||0));
    if(res.status===503)trip(provider,t);
    throw fail(res.status===429?'INTEL_RATE_LIMITED':'INTEL_PROVIDER_UNAVAILABLE',{provider,httpStatus:res.status});
   }
   // GitHub signals secondary rate limits with 403 + x-ratelimit-remaining: 0
   if(res.status===403&&provider==='github'&&res.headers?.get?.('x-ratelimit-remaining')==='0'){
    const reset=Number(res.headers.get('x-ratelimit-reset'));state.cooldown.set(provider,Number.isFinite(reset)?reset*1000:t+COOLDOWN_MIN_MS);
    throw fail('INTEL_RATE_LIMITED',{provider,httpStatus:403});
   }
   if(res.status>=500){trip(provider,t);throw fail('INTEL_HTTP_'+res.status,{provider,httpStatus:res.status});}
   if(!res.ok)throw fail('INTEL_HTTP_'+res.status,{provider,httpStatus:res.status});
   const text=await res.text();
   if(text.length>MAX_BYTES)throw fail('INTEL_RESPONSE_TOO_LARGE',{provider});
   let data;try{data=JSON.parse(text);}catch{throw fail('INTEL_INVALID_JSON',{provider});}
   heal(provider);
   const etag=res.headers?.get?.('etag'),lastModified=res.headers?.get?.('last-modified');
   if(method==='GET'&&(etag||lastModified)){state.etag.set(key,{etag,lastModified,data});if(state.etag.size>500)state.etag.delete(state.etag.keys().next().value);}
   return data;
  }
  throw fail('INTEL_RATE_LIMITED',{provider});
 })();
 if(method!=='GET')return task;
 state.inflight.set(key,task);
 try{return await task;}finally{state.inflight.delete(key);}
}
function trip(provider,t){const b=state.breaker.get(provider)||{fails:0,openUntil:0};b.fails++;if(b.fails>=BREAKER_THRESHOLD){b.openUntil=t+BREAKER_OPEN_MS;b.fails=0;}state.breaker.set(provider,b);}
function heal(provider){const b=state.breaker.get(provider);if(b)b.fails=0;}
function snapshot(){return {day:state.day,used:Object.fromEntries(state.used),breakers:Object.fromEntries([...state.breaker].map(([k,v])=>[k,{fails:v.fails,openUntil:v.openUntil?new Date(v.openUntil).toISOString():null}])),
 cooldowns:Object.fromEntries([...state.cooldown].map(([k,v])=>[k,new Date(v).toISOString()]))};}
function _reset(){state.day=null;for(const k of ['used','breaker','cooldown','etag','inflight'])state[k].clear();}
module.exports={json,check,snapshot,_reset,PROVIDERS,MAX_BYTES,BREAKER_THRESHOLD};
