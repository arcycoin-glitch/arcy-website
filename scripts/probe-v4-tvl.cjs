#!/usr/bin/env node
'use strict';
// Read-only agreement probe: exact-scope v4 pool principal (search/server/lib/v4-tvl.js) x on-chain price x Chainlink quote USD,
// versus DEX Screener's per-pool liquidity.usd, for every v4 pool of the fixed cohort whose quote asset is supported.
process.env.SEARCH_MARKET_ONCHAIN_CHECK='on';
const fs=require('node:fs'),path=require('node:path'),M=require('../search/server/lib/market-onchain'),V=require('../search/server/lib/v4-tvl');
const cohort=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/verified-coverage/radar-cohort-20261121.json'),'utf8')).tokens;
const DS={arc:'arc',ethereum:'ethereum',robinhood:'robinhood',pons:'robinhood'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const stats={pools:0,ok:0,agree10:0,fail:{}};
 for(const t of cohort){
  const network=t.network==='pons'?'robinhood':t.network;let pairs=[];
  try{pairs=((await (await fetch('https://api.dexscreener.com/latest/dex/tokens/'+t.address,{signal:AbortSignal.timeout(15000)})).json()).pairs||[]).filter(p=>p.chainId===DS[t.network]&&(p.labels||[]).includes('v4'));}catch{continue;}
  for(const p of pairs.slice(0,6)){
   stats.pools++;const t0=Date.now();let calls=0;
   const rpc0=M.rpcFor(network),rpc=(m,a)=>{calls++;return rpc0(m,a);};
   try{
    const block=await rpc('eth_blockNumber',[]),call=(to,data)=>rpc('eth_call',[{to,data},block]);
    const pool=String(p.pairAddress).toLowerCase(),token=t.address;
    const x=await M.readPool(pool,{network,token,rpc,call,block});
    const v=M.V4[network];const s=(await call(v.stateView,'0xc815641c'+pool.slice(2))).slice(2).match(/.{64}/g);
    const sqrtP=BigInt('0x'+s[0])&((1n<<160n)-1n);let tick=Number(BigInt('0x'+s[1])&0xffffffn);if(tick>=2**23)tick-=2**24;
    const pr=await V.poolPrincipal({call,getCode:a=>rpc('eth_getCode',[a,block]),stateView:v.stateView,poolId:pool,key:x.poolKey,tick,sqrtPriceX96:sqrtP});
    const dec=async a=>a==='0x0000000000000000000000000000000000000000'?M.QUOTES[network][a].decimals:Number(BigInt(await call(a,'0x313ce567')));
    const [d0,d1]=[await dec(x.poolKey.currency0),await dec(x.poolKey.currency1)];
    const q=await M.quoteUsd(x.quoteAsset,{ethRpc:M.rpcFor('ethereum'),now:Date.now()});
    const tokenIs0=x.poolKey.currency0===token,amtTok=(tokenIs0?pr.amount0Raw/10**d0:pr.amount1Raw/10**d1),amtQ=(tokenIs0?pr.amount1Raw/10**d1:pr.amount0Raw/10**d0);
    const usd=amtTok*x.price*q.usd+amtQ*q.usd,ds=p.liquidity?.usd??null,rel=ds?Math.abs(usd-ds)/ds:null;
    stats.ok++;if(rel!==null&&rel<=0.10)stats.agree10++;
    console.log('V4TVL '+JSON.stringify({section:t.section,symbol:t.symbol,pool:pool.slice(0,12),hooks:x.poolKey.hooks,ticks:pr.initializedTicks,words:pr.bitmapWords,onchainUsd:Math.round(usd),dexscreenerUsd:ds,relDiff:rel===null?null:Math.round(rel*1e4)/1e4,calls,ms:Date.now()-t0}));
   }catch(e){stats.fail[e.code||e.message]=(stats.fail[e.code||e.message]||0)+1;console.log('V4TVL '+JSON.stringify({section:t.section,symbol:t.symbol,pool:String(p.pairAddress).slice(0,12),error:e.code||e.message,calls,ms:Date.now()-t0}));}
   await sleep(400);
  }
 }
 console.log('V4TVL_SUMMARY '+JSON.stringify(stats));
})().catch(e=>{console.error(e);process.exitCode=1;});
