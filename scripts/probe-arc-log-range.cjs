'use strict';
// Evidence probe (read-only): largest accepted eth_getLogs block span and Transfer log density on Arc mainnet. Output = CI annotations.
const URL=process.env.ARC_RPC_URL||'https://rpc.mainnet.arc.io',ARCY='0x73e5F588d27d6B5EC89C89c82692D1E7fECBd38b';
const TOPIC='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const rpc=async(m,p)=>{const r=await fetch(URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:m,params:p}),signal:AbortSignal.timeout(15000)});return r.json();};
(async()=>{
 const head=parseInt((await rpc('eth_blockNumber',[])).result,16);console.log('::notice::arc head',head);
 for(const span of [1000,2000,5000,10000,25000,50000,100000]){
  const to=head,from=head-span,d=await rpc('eth_getLogs',[{address:ARCY,fromBlock:'0x'+from.toString(16),toBlock:'0x'+to.toString(16),topics:[TOPIC]}]);
  console.log(`::notice::span ${span}: ${d.error?'REJECTED '+String(d.error.message).slice(0,80):'ok logs='+d.result.length}`);
  if(d.error)break;
 }
})().catch(e=>{console.log('::warning::probe failed '+e.message);});
