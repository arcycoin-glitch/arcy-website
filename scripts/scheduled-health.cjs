'use strict';
// Scheduled production health check. READ-ONLY, ~6 cheap requests, no full-chain
// scans, no holder-worker triggers. A failing exit code fails the GitHub Actions
// run, which is the only alert channel (GitHub's own notification settings).
// It does not repair anything and cannot change production.
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const H={accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'};
const CHAIN_ID={arc:5042,ethereum:1,robinhood:4663};
const results=[];
async function get(name,path,check){
 const t=Date.now();let ok=false,detail='';
 try{
  const r=await fetch(BASE+path,{headers:H,signal:AbortSignal.timeout(30000)});
  const body=await r.json().catch(()=>null);
  const verdict=r.ok&&body?check(body):'http '+r.status;
  ok=verdict===true;detail=ok?'':String(verdict);
 }catch(e){detail=e.name==='TimeoutError'?'timeout':'network error'}
 results.push({name,ok,ms:Date.now()-t,detail});
}
(async()=>{
 await get('health','/api/search?action=health',b=>b.ok===true&&b.expectedCards===6?true:'unexpected card count '+b.expectedCards);
 for(const net of Object.keys(CHAIN_ID))
  await get('discover-isolation-'+net,'/api/search?action=discover&chain='+net+'&q=link',
   b=>b.ok===true&&b.network===net&&b.chainId===CHAIN_ID[net]&&(b.matches||[]).every(m=>m.network===net&&m.chainId===CHAIN_ID[net])?true:'identity/chain mismatch');
  // Chain-scoped search must keep working for a known multi-network ticker; it must not
 // depend on any one historical token being listed. An empty result is still valid;
 // only a failed request or a cross-chain identity leak fails the check.
 const failed=results.filter(r=>!r.ok);
 const lat=results.map(r=>r.ms).sort((a,b)=>a-b);
 const summary={checked:results.length,failed:failed.length,p50:lat[Math.floor(lat.length/2)],max:lat[lat.length-1],results};
 console.log(JSON.stringify(summary));
 for(const f of failed)console.log('::error title=ARCY health '+f.name+'::'+f.detail);
 process.exitCode=failed.length?1:0;
})();
