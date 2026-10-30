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
 // one-off CI validation of the event itself: walk back in 9.5M-block chunks (the RPC's documented per-request cap is 10M) to the factory deploy block
 for(const f of FACT){
  const start=f===FACT[0]?8991118:8600612;let total=0;const rows=[];
  for(let to=B;to>start;to-=9500000){
   const from=Math.max(start,to-9500000+1);
   const r=await rpc('eth_getLogs',[{address:f,fromBlock:'0x'+from.toString(16),toBlock:'0x'+to.toString(16),topics:[TOPIC]}]);
   if(r.error){rows.push('ERR '+String(r.error.message).slice(0,60));continue;}
   total+=r.result.length;
   rows.push(((B-to)/bps/86400).toFixed(0)+'-'+((B-from)/bps/86400).toFixed(0)+'d ago: '+r.result.length+(r.result.length?' (newest '+((B-Number(BigInt(r.result[r.result.length-1].blockNumber)))/bps/86400).toFixed(1)+'d ago)':''));
  }
  log('factory '+f.slice(0,8)+' TokenLaunched total='+total+' | '+rows.join(' | '));
 }
 // sample decode of the newest log of the active factory
 {const r=await rpc('eth_getLogs',[{address:FACT[0],fromBlock:'0x'+(B-9500000).toString(16),toBlock:'0x'+B.toString(16),topics:[TOPIC]}]);
  const l=r.result&&r.result[r.result.length-1];if(l)log('sample log topics='+l.topics.length+' data words='+((l.data.length-2)/64)+' token='+('0x'+l.topics[1].slice(-40)).slice(0,10)+' pool='+('0x'+l.data.slice(2+64+24,2+128)).slice(0,10));}
 console.log('::notice title=pons-logs-probe::'+lines.join('\n').replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,'%0A'));
})().catch(e=>{console.log('::notice title=pons-logs-probe::FAIL '+e.message);});
