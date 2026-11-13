'use strict';
// Optional INTERNAL cache of a successfully verified Pons response across Vercel
// instances. The existing authenticated Railway worker already holds the
// shared Radar credit ledger; this cache NEVER reads unverified pool candidates.
const {PONS}=require('./sources');
const MAX_AGE_MS=3*60*60*1000,MAX_BYTES=140000;
function age(data,now=Date.now()){
 const at=typeof data?.asOf==='string'?Date.parse(data.asOf):NaN;
 return Number.isFinite(at)?now-at:Infinity;
}
function valid(data,now=Date.now()){
 if(!data||data.ok!==true||data.network!=='pons'||data.chainId!==4663||
  data.version!==2||data.engine!=='arcy-radar-v3'||data.freshness!=='FRESH')return false;
 const a=age(data,now);
 if(!Number.isFinite(a)||a < -60000||a>MAX_AGE_MS)return false;
 if(!Array.isArray(data.tokens)||data.tokens.length>10||
    data.coverage?.ponsConfirmed!==data.tokens.length)return false;
 if(!data.tokens.every((x,i)=>x&&x.rank===i+1&&
  typeof x.address==='string'&&/^0x[0-9a-f]{40}$/i.test(x.address)&&
  typeof x.symbol==='string'&&typeof x.name==='string'&&
  x.fields&&typeof x.fields==='object'&&
  x.launch?.status==='ONCHAIN_VERIFIED'&&PONS.factories.includes(x.launch.factory)))return false;
 try{return Buffer.byteLength(JSON.stringify(data),'utf8')<=MAX_BYTES;}catch{return false;}
}
function endpoint(env){
 if(env?.VERCEL!=='1'||env?.RADAR_PONS_DURABLE_CACHE_ENABLED!=='true'||!env.ARC_HOLDER_QUEUE_URL||!env.ARC_HOLDER_QUEUE_TOKEN)return null;
 try{
  const url=new URL(env.ARC_HOLDER_QUEUE_URL);
  if(url.protocol!=='https:'||url.username||url.password)return null;
  url.pathname='/quota/radar/verified-pons';url.search='';url.hash='';
  return url.href;
 }catch{return null;}
}
async function communicate(mode,data,{env=process.env,fetcher=global.fetch,now=Date.now()}={}){
 const url=endpoint(env);
 if(!url)return null;
 try{
  const body=mode==='put'?{mode,snapshot:data}:{mode};
  const res=await fetcher(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+env.ARC_HOLDER_QUEUE_TOKEN},
   body:JSON.stringify(body),signal:AbortSignal.timeout(1500)});
  if(!res.ok)return null;
  const parsed=await res.json();
  if(parsed?.ok!==true)return null;
  if(mode==='put')return parsed.saved===true;
  return parsed.hit===true&&valid(parsed.snapshot,now)?parsed.snapshot:null;
 }catch{return null;}
}
const read=options=>communicate('get',null,options);
async function write(data,options={}){
 if(!valid(data,options.now??Date.now()))return false;
 return await communicate('put',data,options)===true;
}
module.exports={read,write,valid,age,MAX_AGE_MS,MAX_BYTES,endpoint};
