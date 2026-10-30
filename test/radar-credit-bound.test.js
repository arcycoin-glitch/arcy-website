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
