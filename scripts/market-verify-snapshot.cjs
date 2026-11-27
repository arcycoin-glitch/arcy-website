#!/usr/bin/env node
'use strict';
// Durable market verification job (#356). Read-only chain/API reads; writes ONE JSON file (--out). Never runs in a request.
// Tokens: the fixed verified-coverage cohort + every token currently listed by Radar (four sections). Per token:
//   primary   = the production DEX Screener adapter (exact pools and per-pool h24 volumes the report will sum)
//   volume24h = Swap-log reconstruction (market-volume.js, durable mode) of the LARGEST provider pools covering >= 95% of the
//               provider's summed volume; the record states the coverage share and is compared later against the live report.
// Paced per chain (Arc public RPC rate limits), bounded per token and in total.
process.env.SEARCH_MARKET_ONCHAIN_CHECK='on';
const fs=require('node:fs'),path=require('node:path');
const M=require('../search/server/lib/market-onchain'),MV=require('../search/server/lib/market-volume'),DEX=require('../search/server/lib/dex-market'),S=require('../search/server/lib/market-verify-snapshot');
const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,arr)=>x.startsWith('--')?[...a,[x.slice(2),arr[i+1]]]:a,[]));
const OUT=args.out||'market-verify/snapshot.json',TOTAL_MS=Number(process.env.MARKET_VERIFY_BUDGET_MS||45*60000),PACE={arc:600,robinhood:150,ethereum:150};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Paced per chain with bounded retry on rate limits / transient transport errors (never on RPC semantic errors).
const transient=e=>/429|rate|limit exceeded|timeout|ECONNRESET|socket|fetch failed|HTTP 5\d\d/i.test(String(e?.message||e?.code||''))&&!/range|exceeds|too many results/i.test(String(e?.message||''));
function paced(rpc,ms){let chain=Promise.resolve();
 const once=(m,p)=>{const run=chain.then(()=>rpc(m,p));chain=run.catch(()=>{}).then(()=>sleep(ms));return run;};
 return async(m,p)=>{for(let i=0;;i++){try{return await once(m,p);}catch(e){if(i>=4||!transient(e))throw e;await sleep(1500*2**i);}}};}
async function tokens(){
 const out=new Map();
 const cohort=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/verified-coverage/radar-cohort-20261121.json'),'utf8')).tokens;
 for(const t of cohort)out.set(t.network+':'+t.address,{network:t.network,address:t.address,symbol:t.symbol,origin:'cohort'});
 try{const r=await fetch('https://raw.githubusercontent.com/arcycoin-glitch/arcy-website/radar-v4-snapshots/radar-v4/snapshot.json',{signal:AbortSignal.timeout(20000)});const j=await r.json();
  for(const [sec,v] of Object.entries(j.sections||{}))for(const row of (v.rows||[])){const a=String(row.address||'').toLowerCase();if(!/^0x[0-9a-f]{40}$/.test(a))continue;
   const net=sec==='pons'?'robinhood':sec;const k=net+':'+a;if(!out.has(k))out.set(k,{network:net,address:a,symbol:row.symbol||null,origin:'radar:'+sec});}}catch(e){console.log('RADAR_LIST_UNAVAILABLE '+e.name);}
 return [...out.values()].map(t=>({...t,network:t.network==='pons'?'robinhood':t.network}));
}
(async()=>{
 const t0=Date.now(),list=await tokens(),entries={},stats={tokens:list.length,verified:0,reasons:{},calls:0};
 const rpcs={},eth=M.rpcFor('ethereum');
 for(const t of list){
  if(Date.now()-t0>TOTAL_MS){stats.reasons.TOTAL_BUDGET_EXHAUSTED=(stats.reasons.TOTAL_BUDGET_EXHAUSTED||0)+1;continue;}
  const key=t.network+':'+t.address,rec={symbol:t.symbol,origin:t.origin,computedAt:null};entries[key]=rec;
  try{
   const primary=await DEX.inspect(t.network,t.address);
   const ev=(primary?.volume24h?.evidence||[]).find(e=>Array.isArray(e?.pairs)&&Array.isArray(e?.pairVolumeUsd)&&e.pairs.length===e.pairVolumeUsd.length);
   const total=Number(primary?.volume24h?.value);
   if(!ev||!(total>0)){rec.volumeReason='PROVIDER_VOLUME_UNAVAILABLE';}
   else{
    const ranked=ev.pairs.map((p,i)=>({pool:String(p).toLowerCase(),v:Number(ev.pairVolumeUsd[i])||0})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
    let acc=0;const cover=[];for(const x of ranked){cover.push(x);acc+=x.v;if(acc/total>=S.COVERAGE_MIN)break;}
    if(acc/total<S.COVERAGE_MIN)rec.volumeReason='PROVIDER_VOLUME_COVERAGE_INCOMPLETE';
    else{
     const rpc=rpcs[t.network]||=paced(M.rpcFor(t.network),PACE[t.network]||200);
     const scoped={volume24h:{value:acc,evidence:[{pairs:cover.map(x=>x.pool)}]}};
     const r=await MV.inspect(t.network,t.address,scoped,{rpc,usdOf:a=>M.quoteUsd(a,{ethRpc:eth,now:Date.now()}),durable:true,maxPools:30,maxCalls:1500,timeoutMs:180000});
     stats.calls+=r.profile.calls||0;
     if(r.field){
      const per=new Map(cover.map(x=>[x.pool,x.v]));
      // per-pool agreement within the volume tolerance; a single pool far off means the window or scope is not comparable
      const bad=(r.field.evidence[0].pools||[]).find(p=>per.get(p.pool)>1000&&Math.abs(p.usd-per.get(p.pool))/per.get(p.pool)>0.30);
      if(bad)rec.volumeReason='POOL_VOLUME_DISAGREES';
      else{r.field.evidence[0]={...r.field.evidence[0],coverageOfProviderVolume:Math.round(1e4*acc/total)/1e4,providerPools:ranked.length,providerVolumeAtCompute:total,
       scope:'Covered provider pools only (lower bound of the provider scope); quote-side Swap amounts x CURRENT Chainlink quote USD. Uncovered provider pools are not reproduced.'};
       rec.volume24h=r.field;stats.verified++;}
     }else{rec.volumeReason=r.profile.reason;if(r.profile.error)rec.volumeError=String(r.profile.error).slice(0,120);}
    }
   }
  }catch(e){rec.volumeReason=e.code||'VOLUME_JOB_FAILED';}
  rec.computedAt=new Date().toISOString();
  if(rec.volumeReason)stats.reasons[rec.volumeReason.replace(/ \(.*/,'')]=(stats.reasons[rec.volumeReason.replace(/ \(.*/,'')]||0)+1;
  console.log('MV '+JSON.stringify({key,symbol:t.symbol,ok:Boolean(rec.volume24h),reason:rec.volumeReason||null,error:rec.volumeError||null,value:rec.volume24h?Math.round(rec.volume24h.value):null}));
 }
 const doc={schema:S.SCHEMA,generatedAt:new Date().toISOString(),engineCommit:process.env.GITHUB_SHA||null,elapsedMs:Date.now()-t0,stats,entries};
 if(!S.valid(doc,Date.now()))throw Error('INVALID_SNAPSHOT');
 fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(doc));
 console.log('MV_SUMMARY '+JSON.stringify({...stats,elapsedMs:doc.elapsedMs}));
})().catch(e=>{console.error(e);process.exitCode=1;});
