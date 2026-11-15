'use strict';
// Read-only real-network probe for the sell-transfer-tax producer (eth_simulateV1, state overrides only).
// Hard failures: a NOT_CONFIRMED tax verdict; a CONFIRMED tax without a two-operator VERIFIED_ONCHAIN record; a strict
// contract failure; any record on Arc (no simulation method there).
const tax=require('../lib/risk-engine/producers/transfer-tax');
const observer=require('../lib/verification/onchain-observer');
const {evaluateRisk}=require('../lib/risk-engine');
const evidence=require('../lib/verification/metric-evidence');
const notice=(t,d)=>console.log('::notice title='+t+'::'+JSON.stringify(d).slice(0,3800));
const COHORT=[
 ['ethereum','PAXG (0.02% fee)','0x45804880de22913dafe09f4980848ece6ecbaf78'],
 ['ethereum','STA (1% burn)','0xa7de087329bfcda5639247f96140f9dabe3deed1'],
 ['ethereum','AAVE','0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'],['ethereum','UNI','0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'],
 ['ethereum','PEPE','0x6982508145454ce325ddbe47a25d4ec3d2311933'],['ethereum','SHIB','0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce'],
 ['ethereum','USDT','0xdac17f958d2ee523a2206206994597c13d831ec7'],['ethereum','ONDO','0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3'],
 ['robinhood','LINK','0x492641f648a4986844848e0befe66d14817bce34'],['robinhood','PONS','0x39dbed3a2bd333467115de45665cc57f813c4571'],
 ['robinhood','TSLA','0x322f0929c4625ed5bad873c95208d54e1c003b2d'],['arc','ARCY','0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b']
];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function head(network){const url=observer.endpoints(network,{}).endpoints[0].url;
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]}),signal:AbortSignal.timeout(10000)});
 return '0x'+(BigInt((await r.json()).result)-6n).toString(16);}
(async()=>{
 const hard=[],counts={};
 for(const [network,name,address] of COHORT){
  const row={network,name};
  try{
   const block=await head(network),r=await tax.produce({network,token:address,block});
   const f=evaluateRisk({network,chainId:evidence.NETWORKS[network],token:address,scope:r.pool,evidence:r.records,now:Date.now()}).findings.find(x=>x.ruleId==='sell-transfer-tax');
   const x=r.records[0];
   for(const y of r.records){try{evidence.parseMetricEvidence(y);}catch(e){hard.push(name+' contract '+e.message);}}
   if(f.status==='NOT_CONFIRMED')hard.push(name+' NOT_CONFIRMED tax');
   if(f.status==='CONFIRMED'&&(!x||x.state!=='VERIFIED_ONCHAIN'||new Set(x.observations.map(o=>o.source.operator)).size<2))hard.push(name+' CONFIRMED without two operators');
   if(network==='arc'&&r.records.length)hard.push('record on Arc');
   counts[network]=counts[network]||{};counts[network][f.status]=(counts[network][f.status]||0)+1;
   Object.assign(row,{pool:r.pool,finding:f.status+'|'+f.reasonCode,record:x?x.state+'|'+(x.value??'')+'|'+x.reasonCode:r.reasonCode,
    ops:r.operators.map(o=>({op:o.operator,state:o.state,reason:o.outcome?.reasonCode||o.reasonCode,failedAt:o.failedAt,rpcError:o.rpcError,slot:o.outcome?.slot,dest:o.outcome?.destination?.protocol,
     result:o.outcome?.result&&{bps:o.outcome.result.deductionBps??null,debited:o.outcome.result.debited,credited:o.outcome.result.credited,burned:o.outcome.result.burned,events:o.outcome.result.transferEvents,to:o.outcome.result.destination},calls:o.rpcCalls,ms:o.ms})),
    rpcCalls:r.cost.rpcCalls,ms:r.cost.ms});
  }catch(e){row.error=String(e.message).slice(0,160);}
  notice('tax-'+network+'-'+name,row);await sleep(network==='ethereum'?15000:3000);
 }
 notice('tax-counts',counts);
 if(hard.length){for(const h of hard)console.error('::error::'+h);process.exit(1);}
})().catch(e=>{console.error('::error::'+e.message);process.exit(1);});
