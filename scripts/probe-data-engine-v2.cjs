'use strict';
// Read-only Production verification for Data Engine V2 (Radar categories, logo identity, evidence states, Live Trading).
// Public site API only, same-origin headers, no keys, no writes.
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const h={accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'};
const get=async u=>{const t=Date.now();try{const r=await fetch(u,{headers:h,signal:AbortSignal.timeout(90000)});return {status:r.status,ms:Date.now()-t,json:await r.json().catch(()=>null)};}catch(e){return {status:0,ms:Date.now()-t,error:String(e.message).slice(0,120)};}};
const note=(t,o)=>console.log('::notice title='+t+'::'+JSON.stringify(o).slice(0,3800));
let fail=0;const check=(ok,what)=>{if(!ok){fail++;console.log('::error title=check::'+what);}};
(async()=>{
 for(const chain of ['arc','ethereum','robinhood']){
  const r=await get(BASE+'/api/search?action=radar&chain='+chain),d=r.json||{},c=d.categories;
  const counts=c?Object.fromEntries(['qualified','emerging','momentumWatch','lowLiquidityHighRisk','insufficientEvidence'].map(k=>[k,c[k]?.count])):null;
  const flagged=c?[...(c.emerging?.items||[]),...(c.momentumWatch?.items||[])].map(x=>[x.symbol,x.signal||null,(x.anomalies||[]).join('|'),x.ageHours??null,x.momentum?.volumeUsd?.h1??null]):[];
  const logos=(d.tokens||[]).map(t=>t.logo?.url?(t.logo.url.startsWith('/')?'LOCAL':'CDN'):'NONE');
  const dupLogo=(()=>{const m=new Map();for(const t of d.tokens||[])if(t.logo?.url)m.set(t.logo.url,(m.get(t.logo.url)||0)+1);return [...m.values()].filter(n=>n>1).length;})();
  note('radar-'+chain,{status:r.status,ms:r.ms,ranked:(d.tokens||[]).length,counts,funnel:c?.funnel?.text,flagged,logos,dupLogoUrls:dupLogo,
   change24hMissing:(d.tokens||[]).filter(t=>t.change24hPct===null).map(t=>[t.symbol,t.fields?.change24hPct?.reasonCode])});
  if(r.status===200){check(c?.version==='data-engine-v2','categories on '+chain);check(dupLogo===0,'no shared logo URL in '+chain+' radar');}
  await new Promise(s=>setTimeout(s,4000));
 }
 for(const [chain,address,label] of [['ethereum','0x6982508145454ce325ddbe47a25d4ec3d2311933','PEPE'],['arc','0xece5ca8bf9220718e5727754026757512212cb3c','ARGUS-TAX'],['robinhood','0x18e674231a58c239dc7daedcffe15ec3a24cff5c','UERC20']]){
  const r=await get(BASE+'/api/search?action=report&chain='+chain+'&address='+address),d=r.json||{};
  const es=d.evidenceSummary||d.report?.evidenceSummary;
  note('evidence-'+label,{status:r.status,ms:r.ms,states:es?.stateTotal||null,classes:es?.total||null});
  if(r.status===200)check(es&&es.stateTotal,'evidence states on '+label);
 }
 for(const [chain,address,label] of [['arc','0xf76b1d00bd3d63a37246b5f512074e864010e33d','POLL'],['ethereum','0x6982508145454ce325ddbe47a25d4ec3d2311933','PEPE']]){
  const r=await get(BASE+'/api/search?action=trades&chain='+chain+'&address='+address),d=r.json||{};
  note('trades-'+label,{status:r.status,ms:r.ms,state:d.status,reason:d.reasonCode||null,trades:(d.trades||[]).length,lastTradeAt:d.lastTradeAt||null,
   verified:(d.pools||[]).map(p=>p.dex+':'+p.pool.slice(0,10)+':'+(p.providerTrades24h??'')),uncovered:(d.excludedPools||[]).filter(x=>x.providerTrades24h>0).map(x=>x.dex+':'+x.reasonCode+':'+x.providerTrades24h),
   rpc:d.cost?.rpcCalls??null,window:d.window&&{mode:d.window.mode,from:d.window.scannedFromBlock,to:d.window.toBlock}});
 }
 for(const q of ['poll','pepe']){
  const r=await get(BASE+'/api/search?action=discover&q='+q),d=r.json||{},items=d.results||d.items||d.tokens||[];
  const urls=new Map();for(const x of items)if(x.logoUrl&&!x.logoUrl.startsWith('/')){const k=x.logoUrl;urls.set(k,new Set([...(urls.get(k)||[]),(x.chainId||x.network)+':'+String(x.address).toLowerCase()]));}
  const shared=[...urls.values()].filter(s=>s.size>1).length;
  note('search-logos-'+q,{status:r.status,ms:r.ms,results:items.length,withLogo:items.filter(x=>x.logoUrl).length,withheld:items.filter(x=>x.logoWithheld).length,sharedAcrossContracts:shared,
   sample:items.slice(0,8).map(x=>[x.symbol,x.network||x.chainId,String(x.address).slice(0,10),x.logoUrl?(x.logoUrl.startsWith('/')?'LOCAL':'CDN'):x.logoWithheld||'NONE'])});
  if(r.status===200)check(shared===0,'search "'+q+'" has no logo shared by different contracts');
 }
 if(fail)process.exitCode=1;
})();
