'use strict';
// Proves the reserve of 4 credits is a true upper bound for one Demo-plan load() (3 channel pages + 1 tokens/multi), on all four sections.
const test=require('node:test'),assert=require('node:assert/strict');
test('one metered Demo load never makes more than 4 GeckoTerminal calls (reserve = worst case)',async()=>{
 for(const network of ['arc','ethereum','robinhood','pons']){
  const radar=require('../lib/radar-v2'),budget=require('../lib/radar-v2/budget');budget._reset();
  const env={MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true',COINGECKO_DEMO_API_KEY:'k'};
  let gecko=0;const fetcher=async u=>{u=String(u);if(/coingecko|geckoterminal/.test(u)){gecko++;
   if(/tokens\/multi/.test(u))return {ok:true,status:200,headers:new Map(),json:async()=>({data:[]})};
   return {ok:true,status:200,headers:new Map(),json:async()=>({data:Array.from({length:20},(_,i)=>({id:network+'_0x'+String(i+1).padStart(40,'0'),type:'pool',attributes:{address:'0x'+String(i+100).padStart(40,'0')},relationships:{}}))})};}
   throw new Error('offline');};
  try{await radar.load(network,{env,fetcher,now:()=>Date.parse('2026-10-30T12:00:00Z'),disableCache:false});}catch{}
  assert.ok(gecko<=4,network+' made '+gecko+' provider calls');
  assert.ok(budget.snapshot(env,Date.parse('2026-10-30T12:00:00Z')).spentCredits>=Math.min(gecko,4)||gecko===0);
 }
});
test('V5 builder expansion: reserve covers the extra pages; an unavailable expansion page never fails the Radar; visitors are never expanded',async()=>{
 const radar=require('../lib/radar-v2'),budget=require('../lib/radar-v2/budget');
 const env={MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true',COINGECKO_DEMO_API_KEY:'k'};
 for(const [network,expected] of [['ethereum',6],['arc',5]]){
  budget._reset();radar._cache.clear();
  const urls=[];const fetcher=async u=>{u=String(u);if(/coingecko|geckoterminal/.test(u)){urls.push(u);
   if(/tokens\/multi/.test(u)){const b={data:[]};return {ok:true,status:200,headers:new Map(),json:async()=>b,text:async()=>JSON.stringify(b)};}
   // every expansion page (page>=2 beyond the base plan) is down: must degrade, not fail
   if(/page=([2-9])/.test(u)&&!(network==='arc'&&/pools\?page=2/.test(u)))return {ok:false,status:503,headers:new Map(),json:async()=>({}),text:async()=>'{}'};
   {const b={data:Array.from({length:20},(_,i)=>({id:network+'_0x'+String(i+1).padStart(40,'0'),type:'pool',attributes:{address:'0x'+String(i+100).padStart(40,'0')},relationships:{}}))};return {ok:true,status:200,headers:new Map(),json:async()=>b,text:async()=>JSON.stringify(b)};}}
   throw new Error('offline');};
  let out=null,err=null;
  try{out=await radar.load(network,{env,fetcher,now:()=>Date.parse('2026-10-30T12:00:00Z'),expanded:true});}catch(e){err=e;}
  assert.ok(urls.length<=expected,network+' expanded made '+urls.length+' calls, reserve '+expected);
  // Failure, if any, must come from the base pages' content (no rows), never from the unavailable optional expansion pages.
  if(err){assert.ok(err.code,network+': unexpected error '+err.message);assert.doesNotMatch(String(err.code),/HTTP_5|UNAVAILABLE/,network+': expansion page outage failed the Radar');}
  if(out)assert.match(JSON.stringify(out.discovery.channels.status),/EXPANSION_PAGE_\d_UNAVAILABLE|TOP_PAGE_2/,network);
 }
 const src=require('node:fs').readFileSync('search/server/api/radar.js','utf8');
 assert.match(src,/const expanded=legacyRequested&&req\.query\?\.discovery==='v5-expanded'/,'expansion only for the builder legacy read');
});
