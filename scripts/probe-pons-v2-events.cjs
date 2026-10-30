'use strict';
// CI-only: learn the V2 factory's non-launch event topics from chain evidence (factory logs that mention a known V2 token), no guessing.
const RPC=process.env.ROBINHOOD_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
const V2='0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';
const TOKENS=['0xe4119a9bfcc86915368502b598bbed4745f7051d','0xdf7227611860d3f89342a326c4960ad5fbdd1c72','0x4cbc3416d58dd9e9681d5e45fbe2cd07e5da5bdd'];
const lines=[];const log=m=>{lines.push(m);console.log(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(method,params){for(let i=0;i<5;i++){await sleep(500+i*3000);const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});if(r.status===429)continue;return r.json();}return {error:{message:'429'}};}
(async()=>{
 const B=Number(BigInt((await rpc('eth_blockNumber',[])).result));
 const pad=t=>'0x'+t.slice(2).padStart(64,'0');
 for(const t of TOKENS){
  for(const pos of [1,2,3]){
   const topics=[null,null,null,null].slice(0,pos+1);topics[pos]=pad(t);
   const r=await rpc('eth_getLogs',[{address:V2,fromBlock:'0x'+(B-9500000).toString(16),toBlock:'0x'+B.toString(16),topics}]);
   if(r.error){log(t.slice(0,8)+' pos'+pos+' ERR '+String(r.error.message).slice(0,50));continue;}
   const seen={};for(const l of r.result){const k=l.topics[0]+'|t'+l.topics.length+'|d'+((l.data.length-2)/64);seen[k]=(seen[k]||0)+1;}
   log(t.slice(0,8)+' pos'+pos+' logs='+r.result.length+' '+JSON.stringify(seen));
  }
 }
 console.log('::notice title=pons-v2-events::'+lines.join('\n').replace(/%/g,'%25').replace(/\n/g,'%0A'));
})().catch(e=>console.log('::notice title=pons-v2-events::FAIL '+e.message));
