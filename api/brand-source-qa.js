'use strict';
// Temporary QA-only, fixed-source discovery of official brand downloads.
// No client-controlled URL, proxying, credentials or persistence.
const SOURCES={
  robinhood:'https://docs.robinhood.com/chain/brand-guidelines/',
  arc:'https://www.arc.io/brand-guidelines-and-partner-toolkit'
};
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false});
 const out={};
 for(const [key,url] of Object.entries(SOURCES)){
  try{
   const response=await fetch(url,{redirect:'follow',headers:{'User-Agent':'ARCY Search Source Verification/1.0','Accept':'text/html'},signal:AbortSignal.timeout(15000)});
   const html=await response.text();
   const searches=[...html.matchAll(/feather|download|\.svg|brand.asset|\.png|logo/gi)].slice(0,700);
   const snippets=searches.filter(m=>/feather|\.svg|\.png|download/i.test(m[0])).slice(0,120).map(m=>html.slice(Math.max(0,m.index-240),Math.min(html.length,m.index+490)));
   const urls=[...html.matchAll(/(?:href|src)=(?:\"([^\"]+)\"|'([^']+)')/gi)]
    .map(m=>m[1]||m[2]).filter(v=>/(\.svg|\.png|\.zip|\.webp|\.avif|\.pdf|assets|robinhood|brand)/i.test(v))
    .slice(0,100);
   out[key]={status:response.status,finalUrl:response.url,htmlBytes:html.length,snippets,urls};
  }catch(e){out[key]={error:e.name||'FETCH_FAILED',message:String(e.message).slice(0,180)};}
 }
 return res.status(200).json(out);
};
