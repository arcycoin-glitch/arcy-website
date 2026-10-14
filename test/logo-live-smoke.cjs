'use strict';
// Diagnostic ONLY: failures are surfaced, not silently counted as verified logos.
const probes=[
 {name:'Ethereum AAVE DEX exact contract',url:'https://api.dexscreener.com/tokens/v1/ethereum/0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',kind:'dex'},
 {name:'Arc ARCY DEX exact contract',url:'https://api.dexscreener.com/tokens/v1/arc/0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b',kind:'dex'},
 {name:'ArcTools Arc explorer search',url:'https://explorer.arc.io/api/v2/search?q=ArcTools',kind:'explorer'},
 {name:'ArcTools DEX keyword index',url:'https://api.dexscreener.com/latest/dex/search?q=ArcTools',kind:'search'},
 {name:'ARCY logo preview API',url:'https://arcy-official-9w6ioz0ki-arcy3.vercel.app/api/search?action=discover&chain=arc&q=ARCY',kind:'site'}
];
(async()=>{
 for(const task of probes){
  try{
   const res=await fetch(task.url,{signal:AbortSignal.timeout(8000),headers:{accept:'application/json'}});
   let body;try{body=await res.json()}catch{}
   const arr=task.kind==='dex'?body:task.kind==='search'?body?.pairs:
    task.kind==='explorer'?body?.items:body?.matches;
   const first=Array.isArray(arr)?arr.slice(0,5):[];
   console.log(JSON.stringify({name:task.name,http:res.status,count:Array.isArray(arr)?arr.length:null,
    logosFound:first.filter(x=>Boolean(x?.info?.imageUrl||x?.icon_url||x?.logoUrl)).length,
    chains:[...new Set(first.map(x=>x?.chainId||x?.network||null))]}));
  }catch(e){console.log(JSON.stringify({name:task.name,error:String(e.message||'network unavailable').slice(0,120)}));}
 }
})();
