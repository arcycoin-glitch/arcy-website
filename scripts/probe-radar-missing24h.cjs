'use strict';
// Read-only: classifies every Radar row whose 24h change is NOT shown, using the PUBLIC production API
// (same JSON the page receives). Keeps exact chain, token address, pool id and the field's own evidence.
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const H={accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const out={};
 for(const section of ['arc','ethereum','robinhood','pons']){
  try{
   const r=await fetch(BASE+'/api/search?action=radar&chain='+section,{headers:H,signal:AbortSignal.timeout(40000)});
   const d=await r.json();const tokens=Array.isArray(d.tokens)?d.tokens:[];
   const reasons={},rows=[];
   for(const t of tokens){
    const f=t.fields?.change24hPct;if(!f)continue;
    const key=f.status!=='NOT_VERIFIED'?(f.recovery?'RECOVERED':'SHOWN'):(f.reasonCode||'NO_REASON');
    reasons[key]=(reasons[key]||0)+1;
    if(f.status==='NOT_VERIFIED')rows.push({s:t.symbol,a:t.address,chain:t.chainId,pool:t.pool,created:t.poolCreatedAt,code:f.reasonCode,ageH:f.poolAgeHours,src:(f.sources||[]).map(x=>[x.provider||x.p||x.name,x.value??x.v]),hasReason:Boolean(f.reason)});
   }
   out[section]={http:r.status,generatedAt:d.generatedAt||null,tokens:tokens.length,reasons,rows};
   console.log('::notice title=missing24h-'+section+'::'+JSON.stringify(out[section]).slice(0,3500));
  }catch(e){out[section]={error:e.name==='TimeoutError'?'timeout':String(e.message).slice(0,80)};console.log('::warning title=missing24h-'+section+'::'+JSON.stringify(out[section]));}
  await sleep(1500);
 }
 console.log(JSON.stringify(out));
})();
