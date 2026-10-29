'use strict';
// Bounded, keyless-safe JSON GET/POST for Radar V2 sources: timeout, size cap, no redirects, strict JSON, 429 awareness.
const MAX_BYTES=1024*1024;
const cooldown=new Map(); // provider -> epoch ms until which no request may be sent (429 / Retry-After honoured)
const fail=(code,extra={})=>Object.assign(Error(code),{code,...extra});
function retryAfterMs(res,now){const v=res.headers?.get?.('retry-after');if(!v)return 0;const n=Number(v);if(Number.isFinite(n))return Math.max(0,n*1000);const t=Date.parse(v);return Number.isFinite(t)?Math.max(0,t-now):0;}
async function request(provider,url,{method='GET',headers={},body,fetcher=global.fetch,now=Date.now(),timeoutMs=8000}={}){
 const until=cooldown.get(provider)||0;
 if(until>now)throw fail('RADAR_PROVIDER_RATE_LIMITED',{provider,retryInMs:until-now});
 let res;
 try{res=await fetcher(url,{method,headers:{accept:'application/json;version=20230203',...headers},...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
 catch(e){throw fail(e?.name==='TimeoutError'?'RADAR_PROVIDER_TIMEOUT':'RADAR_PROVIDER_UNREACHABLE',{provider});}
 if(res.status===429){const wait=Math.max(60000,retryAfterMs(res,now));cooldown.set(provider,now+wait);throw fail('RADAR_PROVIDER_RATE_LIMITED',{provider,retryInMs:wait,httpStatus:429});}
 if(!res.ok)throw fail('RADAR_PROVIDER_HTTP_'+res.status,{provider,httpStatus:res.status});
 const text=await res.text();
 if(text.length>MAX_BYTES)throw fail('RADAR_PROVIDER_RESPONSE_TOO_LARGE',{provider});
 try{return JSON.parse(text);}catch{throw fail('RADAR_PROVIDER_INVALID_JSON',{provider});}
}
const _resetCooldowns=()=>cooldown.clear();
module.exports={request,fail,_resetCooldowns,MAX_BYTES};
