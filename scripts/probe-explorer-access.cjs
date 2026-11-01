'use strict';
// Read-only access probe: does an honest, identifying User-Agent change HTTP 403
// from datacenter IPs? Also checks other documented Arc explorer hostnames.
// 2 queries x (hosts) x (default UA / identifying UA). ~24 requests, 700 ms apart.
const HOSTS=['https://explorer.arc.io','https://arcscan.app','https://arcexplorer.org','https://robinhoodchain.blockscout.com','https://eth.blockscout.com'];
const UA='ARCY-SEARCH/1.0 (+https://www.arcyusdc.xyz; read-only token research)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const out={};
 for(const host of HOSTS){
  out[host]={};
  for(const [label,ua] of [['default',null],['identified',UA]]){
   const statuses=[];
   for(const q of ['link','usdc']){
    const url=new URL('/api/v2/search',host);url.searchParams.set('q',q);
    try{
     const r=await fetch(url,{headers:{accept:'application/json',...(ua?{'user-agent':ua}:{})},signal:AbortSignal.timeout(8000)});
     statuses.push(r.status+(r.ok?(Array.isArray((await r.json().catch(()=>({}))).items)?'+items':'+other'):''));
    }catch(e){statuses.push(e.name==='TimeoutError'?'timeout':'neterr:'+(e.cause?.code||e.name))}
    await sleep(700);
   }
   out[host][label]=statuses;
  }
 }
 const line=JSON.stringify(out);console.log(line);
 console.log('::notice title=explorer-access::'+line.slice(0,3500));
})();
