'use strict';
// ARCY Radar V6 — live re-check of a reviewed official page (issue #279). Builder only, never in a visitor request.
// A dossier records that a page on the project's OFFICIAL domain publishes the exact contract. Each snapshot run re-fetches that
// page (bounded) and looks for the exact address in the served HTML/text. Only pages recorded as static (`evidenceStatic: true`,
// i.e. the address is present in the raw response, not injected by JavaScript) can produce ADDRESS_NOT_FOUND; a script-rendered page
// can only be ADDRESS_FOUND or NOT_STATICALLY_CHECKABLE, so a client-rendered site never demotes a genuine project.
// Hardening: https only, the host must be one of the dossier's reviewed official domains (or raw GitHub content of the reviewed
// organisation), redirects are not followed, 8 s timeout, 2 MB cap, no cookies or credentials.
const DOS=require('./dossiers');
const MAX_BYTES=2*1024*1024,TIMEOUT_MS=8000;
function allowed(url,d){
 let u;try{u=new URL(url);}catch{return false;}
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))return false;
 if(u.hostname==='raw.githubusercontent.com')return Boolean(d.github?.owner)&&u.pathname.toLowerCase().startsWith('/'+String(d.github.owner).toLowerCase()+'/');
 return DOS.officialUrl(url,d);
}
async function check(d,address,{fetcher=global.fetch,now=Date.now()}={}){
 const url=d?.evidenceUrl,at=new Date(now).toISOString();
 if(!url)return {status:'NO_EVIDENCE_URL',url:null,at};
 if(!allowed(url,d))return {status:'URL_NOT_ON_OFFICIAL_DOMAIN',url,at};
 let res;
 try{res=await fetcher(url,{method:'GET',redirect:'manual',headers:{accept:'text/html,text/plain,application/json;q=0.9,*/*;q=0.5','user-agent':'arcy-radar-official-check/1 (+https://www.arcyusdc.xyz)'},signal:AbortSignal.timeout(TIMEOUT_MS)});}
 catch(e){return {status:'UNREACHABLE',url,at,reason:e?.name==='TimeoutError'?'TIMEOUT':'NETWORK'};}
 if(res.status>=300&&res.status<400)return {status:'UNREACHABLE',url,at,reason:'REDIRECT_NOT_FOLLOWED'};
 if(!res.ok)return {status:'UNREACHABLE',url,at,reason:'HTTP_'+res.status};
 let text;try{text=await res.text();}catch{return {status:'UNREACHABLE',url,at,reason:'READ'};}
 if(text.length>MAX_BYTES)text=text.slice(0,MAX_BYTES);
 const found=text.toLowerCase().includes(String(address).toLowerCase());
 if(found)return {status:'ADDRESS_FOUND',url,at};
 return {status:d.evidenceStatic===true?'ADDRESS_NOT_FOUND':'NOT_STATICALLY_CHECKABLE',url,at};
}
// Re-check every row that carries a dossier with an evidence URL; bounded and concurrent-limited. Mutates rows (officialCheck).
async function recheck(rows,{fetcher=global.fetch,now=Date.now(),max=40,concurrency=4,dossierFor}={}){
 const todo=rows.filter(r=>dossierFor(r)?.evidenceUrl).slice(0,max),report={checked:0,found:0,notFound:0,unreachable:0,notCheckable:0};
 let i=0;
 await Promise.all(Array.from({length:Math.min(concurrency,todo.length)},async()=>{
  while(i<todo.length){const r=todo[i++];const c=await check(dossierFor(r),r.address,{fetcher,now});r.officialCheck=c;report.checked++;
   if(c.status==='ADDRESS_FOUND')report.found++;else if(c.status==='ADDRESS_NOT_FOUND')report.notFound++;else if(c.status==='NOT_STATICALLY_CHECKABLE')report.notCheckable++;else report.unreachable++;}
 }));
 return report;
}
module.exports={check,recheck,allowed};
