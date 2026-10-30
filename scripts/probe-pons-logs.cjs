'use strict';
// CI-only probe: can the public Robinhood Chain RPC answer a BOUNDED, recent, topic-filtered eth_getLogs on the pons factories?
// Used to decide whether Radar V3 may discover recent Pons launches from the factory's own TokenLaunched event
// (stateless, no index, no storage) instead of only from the data providers' top/new/trending windows.
const RPC=process.env.ROBINHOOD_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
const FACT=['0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb','0x0c37a24f5d23a486fa692d1500881d698b1f77a4'];
const TOPIC='0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a';
const lines=[];const log=m=>{lines.push(m);console.log(m);};
let id=0;
async function rpc(method,params){
 const t=Date.now();
 const res=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(20000)});
 const txt=await res.text();let j;try{j=JSON.parse(txt);}catch{j={error:{message:'non-JSON HTTP '+res.status+' '+txt.slice(0,80)}};}
 return {ms:Date.now()-t,status:res.status,...j};
}
(async()=>{
 const b=await rpc('eth_blockNumber',[]);const B=Number(BigInt(b.result));log('latest block '+B);
 const [hi,lo]=await Promise.all([rpc('eth_getBlockByNumber',['0x'+B.toString(16),false]),rpc('eth_getBlockByNumber',['0x'+(B-100000).toString(16),false])]);
 const dt=Number(BigInt(hi.result.timestamp))-Number(BigInt(lo.result.timestamp));
 const bps=100000/dt;log('blocks per second ~'+bps.toFixed(2)+' ('+(dt/100000*1000).toFixed(0)+' ms/block); 24h ~ '+Math.round(bps*86400)+' blocks');
 for(const w of [5000,25000,100000,400000,1000000]){
  for(const f of FACT){
   const r=await rpc('eth_getLogs',[{address:f,fromBlock:'0x'+(B-w).toString(16),toBlock:'0x'+B.toString(16),topics:[TOPIC]}]);
   log('getLogs window='+w+' ('+(w/bps/3600).toFixed(1)+'h) factory='+f.slice(0,8)+' -> '+(r.error?'ERROR '+String(r.error.message).slice(0,100):(r.result.length+' TokenLaunched logs'))+' in '+r.ms+'ms');
  }
 }
 console.log('::notice title=pons-logs-probe::'+lines.join('\n').replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,'%0A'));
})().catch(e=>{console.log('::notice title=pons-logs-probe::FAIL '+e.message);});
