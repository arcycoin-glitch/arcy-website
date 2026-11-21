#!/usr/bin/env node
'use strict';
// Read-only capacity probe for holder indexing on chain 4663 (Robinhood Chain; Pons tokens live on the same chain).
// Measures what a resumable Transfer-log census needs: head/block time, accepted eth_getLogs span, state retention for
// pinned-block balance reads, Multicall3 presence, Transfer density and first-Transfer block per cohort token.
const fs=require('node:fs'),path=require('node:path');
const RPC=process.env.PROBE_RPC||'https://rpc.mainnet.chain.robinhood.com';
const T='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const cohort=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/verified-coverage/radar-cohort-20261121.json'),'utf8')).tokens.filter(t=>t.chainId===4663);
let calls=0;
async function rpc(method,params){calls++;const t=Date.now();const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});const j=await r.json().catch(()=>({error:{message:'HTTP '+r.status}}));if(j.error)throw Object.assign(Error(JSON.stringify(j.error).slice(0,200)),{ms:Date.now()-t});return j.result;}
const hex=n=>'0x'+n.toString(16);
(async()=>{
 const head=Number(BigInt(await rpc('eth_blockNumber',[])));
 const hb=await rpc('eth_getBlockByNumber',[hex(head),false]);
 const out={rpc:RPC,head,chainId:Number(BigInt(await rpc('eth_chainId',[])))};
 for(const back of [1e5,1e6,5e6]){try{const b=await rpc('eth_getBlockByNumber',[hex(head-back),false]);out['blockTime@'+back]=+((Number(hb.timestamp)-Number(b.timestamp))/back).toFixed(4);}catch(e){out['blockTime@'+back]=e.message.slice(0,80);}}
 try{const g=await rpc('eth_getBlockByNumber',['0x1',false]);out.genesisTime=new Date(Number(g.timestamp)*1000).toISOString();}catch(e){out.genesisTime=e.message.slice(0,80);}
 // state retention: balance of the WETH contract at increasing depth
 out.state={};for(const back of [0,64,128,1000,10000,100000,1000000]){try{await rpc('eth_getBalance',['0x0bd7d308f8e1639fab988df18a8011f41eacad73',hex(head-back)]);out.state[back]='ok';}catch(e){out.state[back]=e.message.slice(0,70);}}
 try{const code=await rpc('eth_getCode',['0xca11bde05977b3631167028862be2a173976ca11','latest']);out.multicall3=code&&code.length>2?'present ('+(code.length/2-1)+' bytes)':'absent';}catch(e){out.multicall3=e.message.slice(0,80);}
 console.log('CAP '+JSON.stringify(out));
 for(const t of cohort){
  const r={symbol:t.symbol,section:t.section,address:t.address};
  // accepted span: try a full-history filtered query, then shrink
  for(const span of [head,20e6,5e6,1e6,1e5,1e4]){const from=Math.max(0,head-span);const t0=Date.now();
   try{const logs=await rpc('eth_getLogs',[{address:t.address,topics:[T],fromBlock:hex(from),toBlock:hex(head)}]);r.span=span;r.logs=logs.length;r.ms=Date.now()-t0;r.firstLogBlock=logs.length?Number(BigInt(logs[0].blockNumber)):null;break;}
   catch(e){r['err@'+span]=e.message.slice(0,90);}}
  try{const s=await rpc('eth_call',[{to:t.address,data:'0x18160ddd'},'latest']);r.totalSupply=BigInt(s).toString();}catch(e){r.totalSupply=e.message.slice(0,60);}
  try{const b=await fetch('https://robinhoodchain.blockscout.com/api/v2/tokens/'+t.address+'/counters',{signal:AbortSignal.timeout(15000)});r.blockscoutCounters=b.ok?await b.json():'HTTP '+b.status;}catch(e){r.blockscoutCounters=e.message.slice(0,60);}
  console.log('CAP_TOKEN '+JSON.stringify(r));
 }
 console.log('CAP_CALLS '+calls);
})().catch(e=>{console.error(e);process.exitCode=1;});
