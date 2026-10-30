'use strict';
// ARCY Radar V2 — source registry and access policy.
// Every external source, its documented limits, its attribution duty and the gate that decides whether ARCY may call it.
// Facts below were taken from the providers' own documentation on 2026-10-30; anything NOT confirmed from a primary page is
// marked `confirmed:false` and is re-checked by scripts/probe-radar-v2.cjs (internal CI probe, no redistribution).
const NETWORKS=Object.freeze({
 arc:Object.freeze({id:'arc',chainId:5042,label:'Arc',gecko:'arc',dex:'arc'}),
 ethereum:Object.freeze({id:'ethereum',chainId:1,label:'Ethereum',gecko:'eth',dex:'ethereum'}),
 robinhood:Object.freeze({id:'robinhood',chainId:4663,label:'Robinhood Chain',gecko:'robinhood',dex:'robinhood'}),
 // pons is a launch platform ON Robinhood Chain, not a fourth blockchain.
 pons:Object.freeze({id:'pons',chainId:4663,label:'Pons Launch',gecko:'robinhood',dex:'robinhood',host:'robinhood'})
});
const SOURCES=Object.freeze({
 geckoterminal:Object.freeze({
  id:'geckoterminal',label:'CoinGecko Onchain / GeckoTerminal',role:'ranking: top pools by 24h volume; newest pools',
  docs:'https://docs.coingecko.com/docs/keyless-public-api',terms:'https://www.coingecko.com/en/api_terms',
  attribution:Object.freeze({text:'Data powered by CoinGecko / GeckoTerminal',url:'https://www.geckoterminal.com/'}),
  access:Object.freeze({
   keyless:Object.freeze({host:'https://api.geckoterminal.com/api/v2',perMinute:5,confirmed:true,note:'Shared IP pool, ~5 calls/min, varies with load; provider says NOT for production or scheduled polling. ARCY allows it only outside Vercel (local/CI).'}),
   demo:Object.freeze({host:'https://api.coingecko.com/api/v3/onchain',header:'x-cg-demo-api-key',perMinute:100,monthlyCredits:10000,confirmed:false,note:'Free plan per CoinGecko pricing page: 100 calls/min, 10,000 credits/month, attribution required, licence cell blank (commercial use NOT stated). Onchain endpoint availability on Demo is not stated on the page: verified by the CI probe.'}),
   pro:Object.freeze({host:'https://pro-api.coingecko.com/api/v3/onchain',header:'x-cg-pro-api-key',perMinute:500,confirmed:true,note:'Paid, commercial licence. Not opened by this change (no new paid service).'})
  })
 }),
 dexscreener:Object.freeze({
  id:'dexscreener',label:'DEX Screener',role:'independent cross-check of price, volume, liquidity, change and pool age for the exact contract',
  docs:'https://docs.dexscreener.com/api/reference',terms:'https://docs.dexscreener.com/api/api-terms-and-conditions',
  attribution:Object.freeze({text:'Cross-checked with DEX Screener',url:'https://dexscreener.com/'}),
  host:'https://api.dexscreener.com',perMinute:300,batch:30,confirmed:true,
  note:'DEX data endpoints ~300 requests/min (profile/boost endpoints 60/min). No API key. No top-by-volume list endpoint, so it can only verify candidates, not rank. Public display stays OFF on any Vercel deployment until DEXSCREENER_PUBLIC_DISPLAY_APPROVED=true (repo licence decision).'
 }),
 pons:Object.freeze({
  id:'pons',label:'pons factory contracts (Robinhood Chain RPC, targeted eth_call)',role:'membership proof that a token was launched by an official pons factory; graduation status',
  docs:'https://docs.ponsfamily.com/',attribution:Object.freeze({text:'Independent index; not operated or endorsed by pons',url:'https://docs.ponsfamily.com/'}),
  confirmed:true,note:'pons documents no public REST/GraphQL API or subgraph; onchain data is public. ARCY makes ≤2 batched point reads per refresh (no log scan, no history, no index).'
 })
});
// Official pons factories (docs.ponsfamily.com, Contracts). New versions ship as NEW factories: add them here with a docs link.
const PONS=Object.freeze({
 factories:Object.freeze(['0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb','0x0c37a24f5d23a486fa692d1500881d698b1f77a4']),
 weth:'0x0bd7d308f8e1639fab988df18a8011f41eacad73',
 maxCandidates:10,   // token addresses per RPC batch (2 factories x 10 = 20 eth_calls; a public RPC rejected 80)
 maxChecked:40        // candidates checked per refresh, in batches of maxCandidates
});
const num=(v,d)=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):d;
const onVercel=env=>env.VERCEL==='1';
// Which GeckoTerminal tier may this process use? Fail closed.
function geckoAccess(env=process.env){
 const g=SOURCES.geckoterminal.access;
 if(env.COINGECKO_PRO_API_KEY)return {mode:'pro',...g.pro,key:env.COINGECKO_PRO_API_KEY,ttlMs:num(env.RADAR_V2_TTL_MS,10*60*1000)};
 if(env.COINGECKO_DEMO_API_KEY)return {mode:'demo',...g.demo,key:env.COINGECKO_DEMO_API_KEY,ttlMs:Math.max(num(env.RADAR_V2_TTL_MS,60*60*1000),60*60*1000)};
 if(!onVercel(env))return {mode:'keyless',...g.keyless,key:null,ttlMs:Math.max(num(env.RADAR_V2_TTL_MS,45*60*1000),30*60*1000)};
 return {mode:'off',reason:'RADAR_SOURCE_KEY_REQUIRED'};
}
// May a response be delivered publicly? Same two operator approvals as the existing Radar gate, in EVERY environment
// (Preview included): a deployed URL is externally reachable, and neither provider's terms have been confirmed for ARCY yet.
function publicationAllowed(env=process.env){
 if(env.MARKET_RADAR_PUBLIC_DISPLAY_APPROVED==='true'&&env.MARKET_RADAR_JSON_DELIVERY_APPROVED==='true')return {ok:true,scope:'approved'};
 return {ok:false,reason:'RADAR_NOT_CONFIGURED'};
}
function dexscreenerAllowed(env=process.env){return !onVercel(env)||env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED==='true';}
// Worst-case monthly credit use of one refresh cycle for the Demo plan, assuming a single serving region.
function demoBudget(ttlMs,pagesPerNetwork=1){
 // V3 discovery: per chain 1 top-volume page (x pages) + 1 trending page + 1 new-pools page = 3 chains x (pagesPerNetwork+2);
 // Pons reuses Robinhood's pages; 4 tokens/multi calls (3 chains + Pons).
 const callsPerCycle=3*(pagesPerNetwork+2)+4;
 const cyclesPerMonth=Math.ceil(30*24*3600*1000/ttlMs);
 return {callsPerCycle,cyclesPerMonth,callsPerMonth:callsPerCycle*cyclesPerMonth,within10k:callsPerCycle*cyclesPerMonth<=10000};
}
module.exports={NETWORKS,SOURCES,PONS,geckoAccess,publicationAllowed,dexscreenerAllowed,demoBudget};
