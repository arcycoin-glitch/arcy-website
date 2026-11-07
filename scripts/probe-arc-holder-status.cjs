#!/usr/bin/env node
'use strict';
// Read-only repeated observation for issue #187: public job status of the five contracts + public operational status
// (deployed commits) every STATUS_INTERVAL_S for STATUS_ITER iterations, plus one pinned Uniswap-V3-pool interface check of
// the two GETTER_REVERTED contracts. Never queues, never writes.
const RPC=process.env.ARC_RPC_URL||'https://rpc.mainnet.arc.io',BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const FIVE=['0x425ecb63957c78bec278d71cffd49a873dba7777','0x0dc6b79f3c3854e4d74514fd4d29be6c96beee39','0xbbe6aab0ed76e90aea0d1cd978ec231c8adcdf8b','0x5bc5ced48bec9260c8d626269f44e22808b8d2c1','0xf89005ccf237a59eeee1521e74b15c7d8d022ab7'];
const POOLS=FIVE.slice(3),sleep=ms=>new Promise(r=>setTimeout(r,ms));
let id=0;async function rpc(method,params){for(let i=0;i<5;i++){const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(20000)});if(r.status===429){await sleep(2000*2**i);continue;}const d=await r.json();if(d.error)return {error:d.error.message};return {result:d.result};}return {error:'429'};}
async function get(p){try{const r=await fetch(BASE+p,{headers:{accept:'application/json'},signal:AbortSignal.timeout(30000)});return {http:r.status,d:await r.json().catch(()=>null)};}catch(e){return {http:null,error:e.name};}}
const word=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
(async()=>{
 const head=(await rpc('eth_blockNumber',[])).result,pools={};
 for(const p of POOLS){const out={};for(const [k,sel] of Object.entries({token0:'0x0dfe1681',token1:'0xd21220a7',fee:'0xddca3f43',tickSpacing:'0xd0c93a7c',factory:'0xc45a0155',liquidity:'0x1a686502',totalSupply:'0x18160ddd',decimals:'0x313ce567'})){const r=await rpc('eth_call',[{to:p,data:sel},head]);out[k]=r.error?'REVERT:'+r.error:word(r.result)?(['token0','token1','factory'].includes(k)?'0x'+r.result.slice(-40):BigInt(r.result).toString()):'MALFORMED';await sleep(150);}
  for(const t of ['token0','token1'])if(/^0x[0-9a-f]{40}$/.test(out[t])){const s=await rpc('eth_call',[{to:out[t],data:'0x95d89b41'},head]);try{const h=s.result.slice(2);out[t+'Symbol']=Buffer.from(h.slice(128,128+Number(BigInt('0x'+h.slice(64,128)))*2),'hex').toString();}catch{out[t+'Symbol']=null;}}
  pools[p]=out;}
 console.log('::notice title=pool-interface::'+JSON.stringify({block:head,pools}));
 const iter=Number(process.env.STATUS_ITER)||13,interval=(Number(process.env.STATUS_INTERVAL_S)||300)*1000;
 for(let i=0;i<iter;i++){
  const st=await get('/api/search?action=status');await sleep(2000);
  const row={at:new Date().toISOString(),runtime:st.d?.runtime||null,worker:st.d?.components?.holderWorker?.runtime||st.d?.worker?.runtime||null,holderWorker:st.d?.components?.holderWorker?{status:st.d.components.holderWorker.status,tokensTracked:st.d.components.holderWorker.tokensTracked,complete:st.d.components.holderWorker.complete,failing:st.d.components.holderWorker.failing}:null,overall:st.d?.overall||null,jobs:{}};
  if(i===0)console.log('::notice title=status-shape::'+JSON.stringify(st.d).slice(0,3500));
  for(const a of FIVE){const j=await get('/api/holders?address='+a+'&action=status');await sleep(2500);const x=j.d?.job;row.jobs[a.slice(0,8)]=x?[x.state,x.reasonCode,x.updatedAt,x.retryAt,x.progress?.phase,x.progress?.candidateAddresses,x.progress?.balancesChecked,x.progress?.block,x.hasCompleteSnapshot]:('HTTP '+j.http);}
  console.log('::notice title=status-'+i+'::'+JSON.stringify(row));
  if(i<iter-1)await sleep(interval);
 }
})().catch(e=>{console.log('::error title=status-probe::'+e.message);process.exitCode=1;});
