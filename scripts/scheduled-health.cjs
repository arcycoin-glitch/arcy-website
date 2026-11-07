'use strict';
// Scheduled production health check. READ-ONLY, ~6 cheap requests, no full-chain
// scans, no holder-worker triggers. A failing exit code fails the GitHub Actions
// run, which is the only alert channel (GitHub's own notification settings).
// It does not repair anything and cannot change production.
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const H={accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'};
const CHAIN_ID={arc:5042,ethereum:1,robinhood:4663};
// Long-lived canonical contracts documented by their issuers (same entries as the in-repo identity registry).
// Exact-address RPC reads prove the chain/RPC/decoding path works WITHOUT any DEX, explorer or market index,
// and without depending on any one project's token listing.
const CANONICAL={
 ethereum:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
 arc:'0x3600000000000000000000000000000000000000',
 robinhood:'0x492641f648a4986844848e0befe66d14817bce34'
};
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
 await get('health','/api/search?action=health',b=>b.ok===true&&b.expectedCards===5?true:'unexpected card count '+b.expectedCards);
 for(const net of Object.keys(CHAIN_ID))
  await get('discover-isolation-'+net,'/api/search?action=discover&chain='+net+'&q=link',
   b=>b.ok===true&&b.network===net&&b.chainId===CHAIN_ID[net]&&(b.matches||[]).every(m=>m.network===net&&m.chainId===CHAIN_ID[net])?true:'identity/chain mismatch');
  for(const net of Object.keys(CANONICAL))
  await get('exact-token-'+net,'/api/search?action=token&chain='+net+'&address='+CANONICAL[net],
   b=>b.ok===true&&b.chainId===CHAIN_ID[net]&&b.address===CANONICAL[net]&&/^0x[0-9a-f]+$/i.test(b.block||'')&&/^[1-9][0-9]*$/.test(String(b.totalSupplyRaw||''))?true:'on-chain read incomplete');
 // Operational pipeline status (one cached request; no blockchain work). UNAVAILABLE fails the run (actionable:
 // worker down or data stale beyond tolerance); DEGRADED is surfaced as a warning annotation only.
 let status=null;
 await get('pipeline-status','/api/search?action=status',b=>{status=b;return b.ok===true&&typeof b.overall==='string'?
  (b.overall==='UNAVAILABLE'?'pipeline UNAVAILABLE: worker '+b.components?.holderWorker?.state+' ('+(b.components?.holderWorker?.reasonCode||'-')+')':true):'status payload malformed';});
 // Chain-scoped search must keep working for a known multi-network ticker; it must not
 // depend on any one historical token being listed. An empty result is still valid;
 // only a failed request or a cross-chain identity leak fails the check.
 const failed=results.filter(r=>!r.ok);
 const lat=results.map(r=>r.ms).sort((a,b)=>a-b);
 const summary={checked:results.length,failed:failed.length,p50:lat[Math.floor(lat.length/2)],max:lat[lat.length-1],results};
 console.log(JSON.stringify(summary));
 for(const f of failed)console.log('::error title=ARCY health '+f.name+'::'+f.detail);
 if(status?.components){const c=status.components,w=c.holderWorker||{},parts=['worker='+w.state+(w.reasonCode?'/'+w.reasonCode:'')+' heartbeatAge='+(w.heartbeat?.ageSeconds??'-')+'s',
  ...['arc','ethereum','robinhood'].map(k=>'pulse.'+k+'='+(c.pulse?.[k]?.state||'-')),'unlocks='+(c.unlocks?.state||'-'),'version.match='+status.version?.match];
  console.log('::'+(status.overall==='HEALTHY'?'notice':'warning')+' title=ARCY pipeline '+status.overall+'::'+parts.join(' · '));}
 process.exitCode=failed.length?1:0;
})();
