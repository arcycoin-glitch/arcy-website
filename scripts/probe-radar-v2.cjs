'use strict';
// CI-only live probe for Radar V2 sources. Paced under GeckoTerminal's keyless 5 calls/minute; no keys are used or logged.
// Prints only HTTP status/shape facts (no raw provider data). Exit 1 only on a hard contract break.
const gecko=require('../lib/radar-v2/gecko'),dexs=require('../lib/radar-v2/dexscreener'),pons=require('../lib/radar-v2/pons'),S=require('../lib/radar-v2/sources');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const KNOWN={robinhood:'0x39dbed3a2bd333467115de45665cc57f813c4571',arc:'0xf76b1d00bd3d63a37246b5f512074e864010e33d'};
(async()=>{
 let bad=0;const access={mode:'keyless',host:'https://api.geckoterminal.com/api/v2',header:null,key:null};
 for(const net of ['arc','ethereum','robinhood']){
  try{const r=await gecko.fetchPage(access,net,'top',1,{});console.log('GT '+net+': OK '+r.rows.length+' contract-matched rows of '+r.inspected+' pools');if(!r.rows.length)bad++;}
  catch(e){bad++;console.log('GT '+net+': FAIL '+e.code);}
  await sleep(13000);
 }
 try{const r=await gecko.fetchPage(access,'pons','new',1,{});console.log('GT robinhood new_pools: OK '+r.rows.length+' rows');}catch(e){console.log('GT new_pools: FAIL '+e.code);}
 for(const [net,a] of Object.entries(KNOWN)){
  try{const m=await dexs.tokens(net,[a],{});const p=m.get(a.toLowerCase())||[];console.log('DS '+net+' ('+S.NETWORKS[net].dex+'): '+(p.length?'OK '+p.length+' pair(s)':'slug accepted but token not found'));}
  catch(e){console.log('DS '+net+' ('+S.NETWORKS[net].dex+'): FAIL '+e.code);}
 }
 for(const net of ['ethereum']){try{const m=await dexs.tokens(net,['0xdac17f958d2ee523a2206206994597c13d831ec7'],{});console.log('DS ethereum control: '+((m.get('0xdac17f958d2ee523a2206206994597c13d831ec7')||[]).length+' pair(s)'));}catch(e){console.log('DS ethereum control: FAIL '+e.code);bad++;}}
 try{
  const rpc=process.env.ROBINHOOD_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
  const out=await pons.membership(rpc,[KNOWN.robinhood],{});console.log('Pons membership read: OK members='+out.members.size);
 }catch(e){console.log('Pons membership read: FAIL '+e.code);}
 if(bad)process.exitCode=1;
})();
