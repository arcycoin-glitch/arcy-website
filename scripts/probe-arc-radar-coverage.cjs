#!/usr/bin/env node
'use strict';
// Read-only Arc Radar coverage probe (CI only). Part A: the production response ARCY's own Radar page receives.
// Part B: the SAME lib/radar-v2 pipeline run here (keyless GeckoTerminal, DEX Screener) with every stage decision recorded per
// candidate. Never writes production state, never uses production keys or quota.
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const H={accept:'application/json','sec-fetch-site':'same-origin',referer:BASE+'/search/','user-agent':'arcy-ci-radar-probe'};
const out=(t,o)=>console.log('::notice title='+t+'::'+JSON.stringify(o).slice(0,60000));
const pick=t=>({rank:t.rank,symbol:t.symbol,name:t.name,address:t.address,price:t.priceUsd,vol:t.volume24hUsd,liq:t.liquidityUsd,chg:t.change24hPct,logo:!!t.logo,score:t.discovery?.score,age:t.discovery?.poolAgeDays,counts:t.verification?.counts,channels:t.discovery?.channels});
async function prod(chain){
 const r=await fetch(BASE+'/api/search?action=radar&chain='+chain,{headers:H,signal:AbortSignal.timeout(60000)});const d=await r.json().catch(()=>null);
 return {http:r.status,ok:d?.ok,error:d?.error,reasonCode:d?.reasonCode,asOf:d?.asOf,freshness:d?.freshness,staleReason:d?.staleReason,selection:d?.selection,channels:d?.discovery?.channels,uniqueCandidates:d?.discovery?.uniqueCandidates,excludedCounts:d?.discovery?.excludedCounts,creditLedger:d?.discovery?.creditLedger,coverage:d?.coverage,usage:d?.usage,tokens:(d?.tokens||[]).map(pick),excluded:(d?.excluded||[]).map(x=>({s:x.symbol,a:x.address,r:x.reason,d:String(x.detail||'').slice(0,160),v:x.volume24hUsd,e:x.evidence}))};
}
(async()=>{
 for(const chain of ['arc','ethereum','robinhood','pons']){try{out('prod-'+chain,await prod(chain));}catch(e){out('prod-'+chain,{error:e.message});}}
 if(process.env.SKIP_LOCAL)return;
 // Part B: instrumented local run of the same pipeline (keyless => same Arc channel plan as Demo).
 delete process.env.VERCEL;delete process.env.COINGECKO_DEMO_API_KEY;delete process.env.COINGECKO_PRO_API_KEY;
 Object.assign(process.env,{MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true'});
 const D=require('../lib/radar-v2/discovery'),gecko=require('../lib/radar-v2/gecko'),radar=require('../lib/radar-v2');
 const trace=new Map(),note=(a,k,v)=>{if(!trace.has(a))trace.set(a,{});trace.get(a)[k]=v;};
 const wrap=(name,fn)=>{const o=D[name];D[name]=function(...args){const r=o.apply(this,args);try{fn(args,r);}catch{}return r;};};
 wrap('classify',([c],r)=>note(c.address,'identity',r?r.reason:'OK'));
 wrap('rankingMaturityIssue',([c,,o],r)=>note(c.address,o?.strict?'maturityStrict':'maturity',r?r.reason:'OK'));
 wrap('gates',([c],r)=>note(c.address,c.crossShare===null&&c.scopeVolume==='POOL'?'poolGates':'finalGates',r.length?r.join(','):'OK'));
 const origParse=gecko.parse;gecko.parse=(body,n)=>{const res=origParse(body,n);for(const x of res.rows)note(x.address,'seen',{sym:x.symbol,name:x.name,pool:x.pool,vol:x.volume24hUsd,liq:x.liquidityUsd,price:x.priceUsd,created:x.poolCreatedAt,buys:x.buys24h,sells:x.sells24h,coinId:x.coinId||null});return res;};
 const origMulti=gecko.fetchMulti;gecko.fetchMulti=async(...a)=>{const m=await origMulti(...a);for(const [k,v] of m)note(k,'token',{price:v.priceUsd,vol:v.volume24hUsd,liq:v.liquidityUsd,coinId:v.coinId||null});return m;};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 let rawFetch=global.fetch,calls=[];const fetcher=async(u,o)=>{calls.push(String(u).replace(/\?.*/,''));await sleep(13000);return rawFetch(u,o);};
 try{
  const d=await radar.load('arc',{env:process.env,fetcher,disableCache:true});
  out('local-arc-summary',{channels:d.discovery.channels,unique:d.discovery.uniqueCandidates,excludedCounts:d.discovery.excludedCounts,coverage:d.coverage,usage:d.usage,tokens:d.tokens.map(pick),calls});
  const ranked=new Set(d.tokens.map(t=>t.address)),ex=new Map(d.excluded.map(x=>[x.address,x]));
  const rows=[...trace.entries()].filter(([,v])=>v.seen).map(([a,v])=>({a,...v,ranked:ranked.has(a),excluded:ex.get(a)?{r:ex.get(a).reason,d:String(ex.get(a).detail||'').slice(0,200),e:ex.get(a).evidence}:null}));
  for(let i=0;i<rows.length;i+=12)out('local-arc-trace-'+(i/12),rows.slice(i,i+12));
 }catch(e){out('local-arc-error',{code:e.code,message:e.message,calls});}
})().catch(e=>{console.log('::error title=radar-probe::'+e.message);process.exitCode=1;});
