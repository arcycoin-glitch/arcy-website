#!/usr/bin/env node
'use strict';
// Read-only ceiling for a DURABLE (background) market verifier on the fixed cohort, using the production engine modules.
//  volume:    provider pools ranked by DEX Screener h24 volume; the smallest prefix covering >= 95% of the provider volume is
//             reconstructed from Swap logs (market-volume durable mode) and compared with the provider volume of those pools (30%).
//  liquidity: provider pools ranked by liquidity; prefix to >= 95%, each pool re-read on-chain (v2/v3/v4) vs provider value (10%).
// Reports, per token, success or the first blocking reason, with calls and time. Writes nothing.
process.env.SEARCH_MARKET_ONCHAIN_CHECK='on';
const fs=require('node:fs'),path=require('node:path'),M=require('../search/server/lib/market-onchain'),MV=require('../search/server/lib/market-volume'),V4T=require('../search/server/lib/v4-tvl');
const cohort=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/verified-coverage/radar-cohort-20261121.json'),'utf8')).tokens;
const DS={arc:'arc',ethereum:'ethereum',robinhood:'robinhood',pons:'robinhood'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const prefix=(rows,key)=>{const tot=rows.reduce((a,r)=>a+(r[key]||0),0);const sorted=[...rows].filter(r=>r[key]>0).sort((a,b)=>b[key]-a[key]);let acc=0,out=[];for(const r of sorted){out.push(r);acc+=r[key];if(acc/tot>=0.95)break;}return {pools:out,share:tot?acc/tot:0,total:tot};};
(async()=>{
 const sum={vol:{ok:0,fail:{}},liq:{ok:0,fail:{}}};
 for(const t of cohort){
  const network=t.network==='pons'?'robinhood':t.network;let pairs=[];
  try{pairs=((await (await fetch('https://api.dexscreener.com/latest/dex/tokens/'+t.address,{signal:AbortSignal.timeout(15000)})).json()).pairs||[]).filter(p=>p.chainId===DS[t.network]).slice(0,30);}catch{continue;}
  const rows=pairs.map(p=>({pool:String(p.pairAddress).toLowerCase(),liq:p.liquidity?.usd||0,vol:p.volume?.h24||0}));
  const rpc0=M.rpcFor(network),ethRpc=M.rpcFor('ethereum');
  // volume
  {const pr=prefix(rows,'vol'),t0=Date.now();let res;
   if(!pr.pools.length){res={reason:'NO_PROVIDER_VOLUME'};}
   else{const primary={volume24h:{value:pr.pools.reduce((a,r)=>a+r.vol,0),evidence:[{pairs:pr.pools.map(r=>r.pool)}]}};
    const out=await MV.inspect(network,t.address,primary,{rpc:rpc0,usdOf:a=>M.quoteUsd(a,{ethRpc,now:Date.now()}),durable:true,maxPools:30,maxCalls:3000,timeoutMs:240000});
    if(out.field){const ds=primary.volume24h.value,rel=Math.abs(out.field.value-ds)/ds;res={ok:rel<=0.30,onchain:Math.round(out.field.value),ds:Math.round(ds),rel:Math.round(rel*1e3)/1e3,swaps:out.profile.swaps};if(!res.ok)res.reason='VOLUME_DISAGREES';}
    else res={reason:out.profile.reason};
    res.pools=pr.pools.length;res.share=Math.round(pr.share*1e3)/1e3;res.calls=out.profile.calls;}
   res.ms=Date.now()-t0;if(res.ok)sum.vol.ok++;else sum.vol.fail[String(res.reason).replace(/ \(.*/,'')]=(sum.vol.fail[String(res.reason).replace(/ \(.*/,'')]||0)+1;
   console.log('DURABLE_VOL '+JSON.stringify({section:t.section,symbol:t.symbol,...res}));}
  // liquidity
  {const pr=prefix(rows,'liq'),t0=Date.now();let calls=0;const rpc=(m,a)=>{calls++;return rpc0(m,a);};let res={pools:pr.pools.length,share:Math.round(pr.share*1e3)/1e3};
   try{const block=await rpc('eth_blockNumber',[]),call=(to,data)=>rpc('eth_call',[{to,data},block]);let on=0,ds=0;
    for(const x of pr.pools){const p=await M.readPool(x.pool,{network,token:t.address,rpc,call,block});if(!p.quoteAsset)throw Object.assign(Error(),{code:'QUOTE_ASSET_UNSUPPORTED'});
     const q=await M.quoteUsd(p.quoteAsset,{ethRpc,now:Date.now()});let ta,qa;
     if(p.kind==='UNISWAP_V4'){const pp=await V4T.poolPrincipal({call,getCode:a=>rpc('eth_getCode',[a,block]),stateView:M.V4[network].stateView,poolId:x.pool,key:p.poolKey,tick:p.tick,sqrtPriceX96:p.sqrtPriceX96});const i0=p.poolKey.currency0===t.address;ta=(i0?pp.amount0Raw:pp.amount1Raw)/10**p.decimals[t.address];qa=(i0?pp.amount1Raw:pp.amount0Raw)/10**p.decimals[p.quote];}
     else{ta=p.amounts[t.address];qa=p.amounts[p.quote];}
     const v=ta*p.price*q.usd+qa*q.usd;if(Math.abs(v-x.liq)/x.liq>0.10)throw Object.assign(Error(),{code:'POOL_LIQUIDITY_DISAGREES'});on+=v;ds+=x.liq;}
    res.ok=true;res.onchain=Math.round(on);res.ds=Math.round(ds);
   }catch(e){res.reason=e.code||e.message;}
   res.calls=calls;res.ms=Date.now()-t0;if(res.ok)sum.liq.ok++;else sum.liq.fail[res.reason]=(sum.liq.fail[res.reason]||0)+1;
   console.log('DURABLE_LIQ '+JSON.stringify({section:t.section,symbol:t.symbol,...res}));}
  await sleep(500);
 }
 console.log('DURABLE_SUMMARY '+JSON.stringify(sum));
})().catch(e=>{console.error(e);process.exitCode=1;});
