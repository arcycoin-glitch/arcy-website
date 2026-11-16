'use strict';
// #262 read-only benchmark for a HOLDER_RPC_DISCOVERY_SPAN_EXCEEDED token (CI only, public Arc RPC, no writes).
// Reproduces the evidence standard of lib/holder-rpc-discovery.js BENCHMARKED_SPANS: deployment block by eth_getCode
// binary search, FULL Transfer-log scan from deployBlock-1 to a pinned head, live balanceOf of every candidate at that same
// pinned block, and EXACT equality sum(balances) == totalSupply(). Anything less is reported as not reconciled.
const TOKEN=String(process.env.BENCH_TOKEN||'0x178b01f61cbea1d2a5581fe1621be607835ec349').toLowerCase();
const RPCS=['https://rpc.mainnet.arc.io','https://rpc.quicknode.mainnet.arc.io'];
const TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',WINDOW=2000,CONC=4;
const hex=n=>'0x'+n.toString(16),sleep=ms=>new Promise(r=>setTimeout(r,ms));
let calls=0;
async function rpc(method,params){
 for(let attempt=0;attempt<6;attempt++){
  const url=RPCS[attempt%RPCS.length];calls++;
  try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20000)});
   const d=await r.json();if(d.error)throw Error(JSON.stringify(d.error).slice(0,120));return d.result;}
  catch(e){if(attempt===5)throw e;await sleep(400*(attempt+1));}
 }
}
const log=(k,v)=>console.log('BENCH '+k+' '+JSON.stringify(v));
(async()=>{
 const t0=Date.now(),head=Number(BigInt(await rpc('eth_blockNumber',[]))),pin=hex(head);
 let lo=0,hi=head;while(hi-lo>1){const mid=Math.floor((lo+hi)/2),c=await rpc('eth_getCode',[TOKEN,hex(mid)]);if(c&&c!=='0x')hi=mid;else lo=mid;}
 const deployBlock=hi,span=head-deployBlock+1;log('DEPLOY',{token:TOKEN,deployBlock,pinned:head,span});
 const supply=BigInt(await rpc('eth_call',[{to:TOKEN,data:'0x18160ddd'},pin]));
 const decimals=Number(BigInt(await rpc('eth_call',[{to:TOKEN,data:'0x313ce567'},pin])));
 const cands=new Set();let transfers=0,windows=0,next=deployBlock-1;
 const worker=async()=>{for(;;){const from=next;if(from>head)return;next+=WINDOW;const to=Math.min(head,from+WINDOW-1);
  const logs=await rpc('eth_getLogs',[{address:TOKEN,topics:[TRANSFER],fromBlock:hex(from),toBlock:hex(to)}]);windows++;
  for(const l of logs){if(l.removed)continue;transfers++;for(const t of [l.topics[1],l.topics[2]])if(t)cands.add('0x'+t.slice(26).toLowerCase());}
  if(windows%2000===0)log('PROGRESS',{windows,transfers,candidates:cands.size,ms:Date.now()-t0});}};
 await Promise.all(Array.from({length:CONC},worker));
 const list=[...cands];let sum=0n,i=0;const anchorBefore=await rpc('eth_getBlockByNumber',[pin,false]);
 const bal=async()=>{for(;;){const a=list[i++];if(!a)return;const r=await rpc('eth_call',[{to:TOKEN,data:'0x70a08231'+a.slice(2).padStart(64,'0')},pin]);sum+=BigInt(r);}};
 await Promise.all(Array.from({length:CONC},bal));
 const anchorAfter=await rpc('eth_getBlockByNumber',[pin,false]);
 log('RESULT',{token:TOKEN,decimals,deployBlock,pinned:head,span,windows,windowBlocks:WINDOW,transfers,candidates:list.length,
  sum:sum.toString(),totalSupply:supply.toString(),exact:sum===supply,anchorStable:anchorBefore?.hash===anchorAfter?.hash,rpcCalls:calls,ms:Date.now()-t0});
})().catch(e=>{log('ERROR',{error:String(e.message).slice(0,200),rpcCalls:calls});process.exitCode=1;});
