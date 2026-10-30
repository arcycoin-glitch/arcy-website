'use strict';
// CI-only evidence probe for the ~2x GeckoTerminal vs DEX Screener liquidity gap on graduated Pons (Uniswap v4) pools.
// Uses PoolGraduated tokens (chain evidence) and raw provider fields; derives, from token AMOUNTS and prices, which provider counts which side.
const pons=require('../lib/radar-v2/pons');
const RPC=process.env.ROBINHOOD_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
const lines=[];const log=m=>{lines.push(m);console.log(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ctx={fetcher:async(u,o)=>{for(let i=0;i<4;i++){await sleep(400+i*2500);const r=await fetch(u,{...o,signal:AbortSignal.timeout(20000)});if(r.status!==429)return r;}return fetch(u,{...o,signal:AbortSignal.timeout(20000)});},now:Date.now};
const get=async u=>{for(let i=0;i<4;i++){await sleep(2300);const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});if(r.status===429){await sleep(15000);continue;}return r.ok?r.json():null;}return null;};
(async()=>{
 const gr=await pons.recentGraduations(RPC,ctx,{max:12});
 const toks=gr.graduations.slice(0,10).map(g=>g.token);log('graduated tokens sampled: '+toks.length);
 const rows=[];
 for(const t of toks){
  const ds=await get('https://api.dexscreener.com/token-pairs/v1/robinhood/'+t);
  const p=(Array.isArray(ds)?ds:[]).filter(x=>x.chainId==='robinhood'&&x.baseToken?.address?.toLowerCase()===t).sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];
  if(!p||!p.liquidity){log(t.slice(0,8)+' no DS pair');continue;}
  const price=Number(p.priceUsd),pn=Number(p.priceNative),qPrice=pn>0?price/pn:null;
  const baseVal=p.liquidity.base*price,quoteVal=qPrice?p.liquidity.quote*qPrice:null;
  const gt=await get('https://api.geckoterminal.com/api/v2/networks/robinhood/pools/'+p.pairAddress);
  const a=gt?.data?.attributes||{};
  rows.push({t:t.slice(0,8),dsUsd:p.liquidity.usd,baseVal:Math.round(baseVal),quoteVal:quoteVal&&Math.round(quoteVal),sumSides:quoteVal&&Math.round(baseVal+quoteVal),gtReserve:Number(a.reserve_in_usd)||null,dex:p.dexId});
 }
 for(const r of rows)log(JSON.stringify(r)+' | ds/sum='+(r.sumSides?(r.dsUsd/r.sumSides).toFixed(2):'?')+' ds/(2*quote)='+(r.quoteVal?(r.dsUsd/(2*r.quoteVal)).toFixed(2):'?')+' gt/quote='+(r.quoteVal&&r.gtReserve?(r.gtReserve/r.quoteVal).toFixed(2):'?')+' gt/ds='+(r.gtReserve?(r.gtReserve/r.dsUsd).toFixed(2):'?'));
 console.log('::notice title=liquidity-definition::'+lines.join('\n').replace(/%/g,'%25').replace(/\n/g,'%0A'));
})().catch(e=>console.log('::notice title=liquidity-definition::FAIL '+(e.code||e.message)));
