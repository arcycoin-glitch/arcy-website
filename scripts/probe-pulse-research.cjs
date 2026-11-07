'use strict';
// Read-only real-source probe for Pulse research depth (Phase 1 evidence). Runs the same direct first-party review
// the live site uses for Ethereum / Robinhood (allowPartial + recentWindow) and, when BASE_NETWORKS points at the
// base-branch copy of lib/pulse-networks.js, the same review with the old code for a before/after comparison.
// Public sources only; no credentials; nothing is written or published.
const path=require('node:path');
const NEW=require('../lib/pulse-networks');
const OLD=process.env.BASE_NETWORKS?require(path.resolve(process.env.BASE_NETWORKS)):null;
const now=Date.now();
const short=s=>String(s||'').replace(/\s+/g,' ').slice(0,330);
async function review(mod,chain){
 try{return await mod.generate({chain,now,trigger:'probe',allowPartial:true,sourceTimeoutMs:8000,recentWindow:true});}
 catch(e){return {error:e.code||e.message};}
}
(async()=>{
 const out={generatedAt:new Date(now).toISOString(),chains:{}};
 for(const chain of ['ethereum','robinhood']){
  const [after,before]=await Promise.all([review(NEW,chain),OLD?review(OLD,chain):null]);
  const cards=e=>(e?.cards||[]).map(c=>({contentType:c.contentType,owner:c.owner,publishedAt:c.publishedAt,title:short(c.title),summary:short(c.summary),evidence:c.research?.evidence||null,url:c.url}));
  out.chains[chain]={after:{status:after.status||after.error,complete:after.complete,failures:after.audit?.sourceFailures?.length,rejected:after.audit?.rejected,cards:cards(after)},
   before:before?{status:before.status||before.error,rejected:before.audit?.rejected,cards:cards(before)}:null};
  for(const [i,c] of cards(after).entries()){
   const b=before?cards(before)[i]:null;
   console.log('::notice title=pulse-'+chain+'-card'+(i+1)+'::'+JSON.stringify({after:{type:c.contentType,evidence:c.evidence,date:c.publishedAt&&c.publishedAt.slice(0,10),title:c.title,summary:c.summary},before:b?{type:b.contentType,title:b.title,summary:b.summary}:null}).slice(0,3900));
  }
 }
 console.log(JSON.stringify(out,null,1));
})();
