'use strict';
// Read-only timing probe for the three DISCOVER dependencies of the Arc Holder worker (public A/X Explorer API, GET only).
const BASE='https://arcexplorer.org',T=Number(process.env.PROBE_TIMEOUT_MS)||30000;
const COHORT=['0x4c9b47dbd5933aa4574b2c27f82419e4dbbd0222','0x3ead4e80e9e5bc0e01682d7ee74c4881b040d3ea','0x28f986a61e078795639f239675582a12b4cf7f01','0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b','0xf76b1d00bd3d63a37246b5f512074e864010e33d'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function hit(path){const t=Date.now();try{const r=await fetch(BASE+path,{headers:{accept:'application/json'},signal:AbortSignal.timeout(T)});const text=await r.text();let items=null,next;try{const j=JSON.parse(text);items=Array.isArray(j.items)?j.items.length:null;next=j.nextOffset;}catch{}return {path:path.replace(/0x[0-9a-f]{40}/,m=>m.slice(0,8)),ms:Date.now()-t,http:r.status,bytes:text.length,items,next};}catch(e){return {path:path.replace(/0x[0-9a-f]{40}/,m=>m.slice(0,8)),ms:Date.now()-t,err:e.name+':'+(e.code||'')};}}
(async()=>{
 const out=[await hit('/api/v1/stats'),await hit('/api/v1/stats')];
 for(const a of COHORT){
  out.push(await hit('/api/v1/tokens/'+a));
  for(const lim of [1000,200]){out.push(await hit('/api/v1/tokens/'+a+'/holders?limit='+lim+'&offset=0'));await sleep(500);}
 }
 for(let i=0;i<out.length;i+=6)console.log('::notice title=explorer-discover-'+(i/6)+'::'+JSON.stringify(out.slice(i,i+6)));
})();
