'use strict';
// Read-only 24h-change field coverage probe (Issue #115). Keyless, paced, CI/local only; changes nothing in Production.
// For every token the Radar finally lists, compares the RAW GeckoTerminal price_change_percentage of the selected EXACT pool (every channel)
// against the merged row and the final change24hPct/status/reason. Distinguishes: provider omission, pool mismatch, same-pool recovery,
// source conflict and parse loss (raw value present but final null = a software defect, exit 1).
const fs=require('fs');
const radar=require('../lib/radar-v2');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const NETS=(process.env.PROBE_NETWORKS||'robinhood,pons,arc,ethereum').split(',');
const rawBodies=new Map();
const rec=async(u,o)=>{
 if(/geckoterminal/.test(u))await sleep(14000);
 const r=await fetch(u,{...o,signal:AbortSignal.timeout(12000)});
 if(/geckoterminal.*\/(pools|new_pools|trending_pools)\?/.test(u)){
  const kind=/new_pools/.test(u)?'new':/trending_pools/.test(u)?'trending':'top',net=(u.match(/networks\/([^/]+)\//)||[])[1];
  const txt=await r.clone().text();try{rawBodies.set(net+'|'+kind,JSON.parse(txt));}catch{}
 }
 return r;
};
const rawFor=(gecko,pool)=>{const out={};for(const kind of ['top','trending','new']){const b=rawBodies.get(gecko+'|'+kind);const p=b&&b.data&&b.data.find(x=>x.attributes&&String(x.attributes.address).toLowerCase()===pool);out[kind]=p?{listed:true,price_change_percentage:p.attributes.price_change_percentage===undefined?'ABSENT':p.attributes.price_change_percentage,h24:p.attributes.price_change_percentage&&p.attributes.price_change_percentage.h24!==undefined?p.attributes.price_change_percentage.h24:'ABSENT'}:{listed:false};}return out;};
const hasVal=v=>v!==undefined&&v!==null&&v!=='ABSENT'&&String(v).trim()!==''&&Number.isFinite(Number(v));
(async()=>{
 const env={MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true'};
 const S=require('../lib/radar-v2/sources');
 const report={generatedAt:new Date().toISOString(),networks:{}};let defects=0;
 for(const net of NETS){
  const gk=S.NETWORKS[net==='pons'?'robinhood':net].gecko;
  try{
   if(net==='pons')await sleep(20000);
   const out=await radar.load(net,{env,fetcher:rec,now:Date.now,rpcUrl:process.env.ROBINHOOD_RPC_URL||'https://rpc.mainnet.chain.robinhood.com'});
   const tally={};const rows=out.tokens.map(t=>{
    const raw=rawFor(gk,t.pool),f=t.fields.change24hPct;
    const rawHas=Object.values(raw).some(x=>x.listed&&hasVal(x.h24)),sameKinds=Object.entries(raw).filter(([,x])=>x.listed).map(([k])=>k);
    let cls;
    if(f.status!=='NOT_VERIFIED')cls=f.recovery?'RECOVERED_SAME_POOL':'REPORTED';
    else if(f.reasonCode==='SOURCES_DISAGREE')cls='CONFLICT';
    else if(rawHas){cls='PARSE_LOSS';defects++;}
    else if(!sameKinds.length)cls='POOL_NOT_IN_RAW_PAGES';
    else cls='PROVIDER_OMISSION';
    tally[cls]=(tally[cls]||0)+1;
    return {symbol:t.symbol,address:t.address,pool:t.pool,poolCreatedAt:t.poolCreatedAt,class:cls,status:f.status,reasonCode:f.reasonCode||null,final:t.change24hPct,raw,sources:(f.sources||[]).map(s=>({p:s.provider,v:s.value}))};
   });
   report.networks[net]={tokens:rows.length,tally,rows};
   console.log('::notice::change24h '+net+' '+JSON.stringify(tally)+' of '+rows.length);
   for(const r of rows)console.log('::notice::c24row '+net+' '+r.symbol+' '+r.class+' final='+r.final+' reason='+r.reasonCode+' src='+JSON.stringify(r.sources)+' raw='+JSON.stringify(Object.fromEntries(Object.entries(r.raw).map(([k,x])=>[k,x.listed?x.h24:'-'])))+' created='+r.poolCreatedAt+' pool='+String(r.pool).slice(0,10));
   for(const r of []) console.log('  '+net+' '+r.symbol+' '+r.class+' final='+r.final+' reason='+r.reasonCode+' raw='+JSON.stringify(Object.fromEntries(Object.entries(r.raw).map(([k,x])=>[k,x.listed?x.h24:'not-listed']))));
  }catch(e){report.networks[net]={error:e.code||String(e.message||e)};console.log('::warning::change24h '+net+' failed '+(e.code||e.message));}
 }
 const out=process.env.PROBE_OUT||'change24h-report.json';fs.writeFileSync(out,JSON.stringify(report,null,1));
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\n### 24h change coverage\n```json\n'+JSON.stringify(Object.fromEntries(Object.entries(report.networks).map(([k,v])=>[k,v.tally||v.error])),null,1)+'\n```\n');
 if(defects){console.log('::error::change24h PARSE_LOSS defects: '+defects);process.exit(1);}
})();
