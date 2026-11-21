#!/usr/bin/env node
'use strict';
// Read-only Phase-2 sizing probe on the FIXED cohort. Prints one compact JSON line per token so CI logs carry the evidence:
//  * Production report: per core field status/dataState/reasonCode/evidenceClass/source (+ mechanics reason codes)
//  * DEX Screener pools for the token (pair, dex, labels, base/quote, liquidity) - the pools an on-chain check must reproduce
//  * chain facts for Arc / chain 4663 tokens: head, deployment block (eth_getCode binary search), block time, Transfer density
// No writes, no keys, bounded calls.
const fs=require('node:fs'),path=require('node:path');
const V=require('../search/server/lib/verified-coverage');
const BASE=(process.env.ARCY_BASE||'https://www.arcyusdc.xyz').replace(/\/$/,'');
const cohort=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/verified-coverage/radar-cohort-20261121.json'),'utf8'));
const RPC={arc:'https://rpc.mainnet.arc.io',robinhood:'https://rpc.mainnet.chain.robinhood.com',ethereum:'https://ethereum-rpc.publicnode.com'};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let calls=0;
async function rpc(net,method,params){calls++;const r=await fetch(RPC[net],{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20000)});const j=await r.json();if(j.error)throw Error(method+': '+JSON.stringify(j.error).slice(0,160));return j.result;}
async function deployBlock(net,a,head){let lo=0,hi=head;if((await rpc(net,'eth_getCode',[a,'0x'+hi.toString(16)]))==='0x')return null;while(lo<hi){const mid=Math.floor((lo+hi)/2);const code=await rpc(net,'eth_getCode',[a,'0x'+mid.toString(16)]);if(code&&code!=='0x')hi=mid;else lo=mid+1;}return lo;}
async function report(t){const r=await fetch(BASE+'/api/search?action=report&chain='+t.network+'&address='+t.address,{headers:{accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'},signal:AbortSignal.timeout(60000)});return r.ok?r.json():{httpStatus:r.status};}
(async()=>{
 for(const t of cohort.tokens){
  const out={section:t.section,symbol:t.symbol,address:t.address};
  try{const rep=await report(t);out.fields={};
   for(const [,card,key] of V.CORE){const f=V.fieldOf(rep,card,key);out.fields[card+'.'+key]=f?[f.status,f.dataState,f.reasonCode||null,f.evidenceClass||null,f.source||null,f.crossCheck?.state||null].join('|'):'ABSENT';}
   const pe=rep?.cards?.activity?.fields?.priceUsd?.evidence?.[0],le=rep?.cards?.liquidity?.fields?.liquidityUsd?.evidence?.[0];out.pricePairs=pe?.pairs||null;out.liqPairs=le?.pairs||null;
   const m=rep?.cards?.mechanics?.fields||{};out.mech=Object.fromEntries(Object.entries(m).map(([k,f])=>[k,(f?.status||'')+'|'+(f?.reasonCode||'')+'|'+String(f?.value??'').slice(0,40)]));
   out.mechCard=rep?.cards?.mechanics?{state:rep.cards.mechanics.dataState||null,arch:String(rep.cards.mechanics.fields?.contractArchitecture?.value||'').slice(0,80)}:null;
  }catch(e){out.reportError=e.message;}
  await wait(2700);
  try{const net=t.network==='pons'?'robinhood':t.network;const r=await fetch('https://api.dexscreener.com/token-pairs/v1/'+net+'/'+t.address,{signal:AbortSignal.timeout(15000)});const d=await r.json();
   out.pools=(Array.isArray(d)?d:[]).slice(0,12).map(p=>({pair:p.pairAddress,dex:p.dexId,labels:p.labels||null,base:p.baseToken?.address?.toLowerCase()===t.address?'SELF':p.baseToken?.symbol,quote:p.quoteToken?.symbol,quoteAddr:p.quoteToken?.address,liq:p.liquidity?.usd??null,px:p.priceUsd??null}));}catch(e){out.poolsError=e.message;}
  if(t.network!=='ethereum'){const net=t.network==='pons'?'robinhood':t.network;
   try{const head=Number(BigInt(await rpc(net,'eth_blockNumber',[])));const hb=await rpc(net,'eth_getBlockByNumber',['0x'+head.toString(16),false]),pb=await rpc(net,'eth_getBlockByNumber',['0x'+(head-100000).toString(16),false]);
    const dep=await deployBlock(net,t.address,head);out.chain={head,blockTime:+((Number(hb.timestamp)-Number(pb.timestamp))/100000).toFixed(3),deploy:dep,span:dep===null?null:head-dep};
    const from=Math.max(dep||0,head-2000);const logs=await rpc(net,'eth_getLogs',[{address:t.address,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],fromBlock:'0x'+from.toString(16),toBlock:'0x'+head.toString(16)}]);out.chain.logsLast2000=logs.length;
    const w=await fetch((net==='robinhood'?'https://robinhoodchain.blockscout.com':'https://arcexplorer.org')+(net==='robinhood'?'/api/v2/tokens/'+t.address:'/api/v1/tokens/'+t.address),{signal:AbortSignal.timeout(15000)}).then(r=>r.ok?r.json():{http:r.status}).catch(e=>({err:e.message}));out.explorer={holders:w.holders_count??w.holders??w.holderCount??null,http:w.http||null};
   }catch(e){out.chainError=e.message.slice(0,160);}}
  console.log('PROBE '+JSON.stringify(out));
 }
 console.log('PROBE_RPC_CALLS '+calls);
})().catch(e=>{console.error(e);process.exitCode=1;});
