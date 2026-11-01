'use strict';
// Read-only, rate-limited latency/status probe of the explorer search endpoints
// that Search discovery uses. 3 chains x 10 queries, sequential, 600 ms apart.
// Purpose: decide with evidence whether the 1000 ms optional-provider deadline
// in multichain-service.discover drops answers that arrive slightly later.
const {CHAIN_CONFIG}=require('../search/server/lib/chains');
const QUERIES=['link','usdc','arcy','weth','uni','aave','tsla','poll','dai','pons'];
const pct=(a,p)=>a.length?a.slice().sort((x,y)=>x-y)[Math.min(a.length-1,Math.ceil(p*a.length)-1)]:null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const out={};
 for(const net of ['ethereum','arc','robinhood']){
  const rows=[];
  for(const q of QUERIES){
   const url=new URL('/api/v2/search',CHAIN_CONFIG[net].explorer);url.searchParams.set('q',q);
   const t=Date.now();let status='error',items=null;
   try{
    const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
    status=r.status;
    if(r.ok){const j=await r.json();items=Array.isArray(j.items)?j.items.filter(i=>i.type==='token').length:null}
   }catch(e){status=e.name==='TimeoutError'?'timeout':'neterr'}
   rows.push({q,status,ms:Date.now()-t,items});
   await sleep(600);
  }
  const ok=rows.filter(r=>r.status===200),ms=ok.map(r=>r.ms);
  const statuses={};for(const r of rows)statuses[r.status]=(statuses[r.status]||0)+1;
  out[net]={n:rows.length,statuses,okCount:ok.length,p50:pct(ms,.5),p95:pct(ms,.95),max:ms.length?Math.max(...ms):null,
   over1000:ok.filter(r=>r.ms>1000).length,over2500:ok.filter(r=>r.ms>2500).length,
   withTokens:ok.filter(r=>r.items>0).length};
 }
 const line=JSON.stringify(out);
 console.log(line);
 console.log('::notice title=discovery-latency::'+line.slice(0,3500));
})();
