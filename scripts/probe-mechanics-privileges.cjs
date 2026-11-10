'use strict';
// Read-only live probe for Mechanics V2 privilege-state analysis. Public RPC endpoints only; no credentials; nothing is
// written. Runs the analysis on the repository's reviewed cross-network cohort and prints one line per contract plus
// per-network totals, so coverage is measured on real contracts rather than fixtures.
const privilege=require('../search/server/lib/mechanics-privilege-state');
const cohort=new Map();
for(const [network,symbol,address] of [...require('../test/fixtures/search-v4-contracts.json'),...require('../test/fixtures/search-v5-contracts.json')])cohort.set(network+':'+address.toLowerCase(),[network,symbol,address.toLowerCase()]);
for(const c of require('../search/server/lib/prefix-catalog.js').CANDIDATES||[])cohort.set(c.network+':'+c.address,[c.network,c.symbol,c.address]);
const notice=(title,data)=>console.log('::notice title='+title+'::'+JSON.stringify(data).slice(0,3800));
(async()=>{
 const totals={},rows=[];
 for(const [network,symbol,address] of cohort.values()){
  const t=totals[network]||(totals[network]={contracts:0,analysed:0,unavailable:0,noCode:0,withDetectedFunction:0,functionsDetected:0,executable:0,confirmed:0,revoked:0,unknown:0,unrestricted:0,authorities:0,proxies:0,rpcCalls:0});
  t.contracts++;
  let r;
  try{r=await privilege.classify({network,address,paceMs:network==='arc'?700:150});}catch(e){r={status:'ERROR',reasonCode:String(e.message).slice(0,60),functions:[],authorities:[],cost:{rpcCalls:0}};}
  t.rpcCalls+=r.cost?.rpcCalls||0;
  if(r.status==='ANALYZED'){t.analysed++;if(r.functions.length)t.withDetectedFunction++;t.functionsDetected+=r.functions.length;t.executable+=r.summary.currentlyExecutable;t.confirmed+=r.summary.privilegeConfirmed;t.revoked+=r.summary.revoked;t.unknown+=r.summary.unknown;t.unrestricted+=r.summary.unrestrictedInSimulation;t.authorities+=r.authorities.length;if(r.proxy)t.proxies++;}
  else if(r.status==='NO_CONTRACT_CODE')t.noCode++;else t.unavailable++;
  const row={network,symbol,address,status:r.status,reason:r.reasonCode||null,block:r.block||null,proxy:r.proxy?.kind||null,
   authorities:(r.authorities||[]).map(a=>a.kind+':'+a.holderType+':'+a.state),functions:(r.functions||[]).map(f=>f.signature.split('(')[0]+'='+f.state+(f.unrestrictedInSimulation?'(unrestricted)':'')),rpcCalls:r.cost?.rpcCalls||0};
  rows.push(row);notice('privileges-'+network+'-'+symbol,row);
  await new Promise(resolve=>setTimeout(resolve,network==='arc'?2500:400));
 }
 for(const [network,t] of Object.entries(totals))notice('privileges-total-'+network,{...t,avgRpcCalls:t.contracts?Math.round(t.rpcCalls/t.contracts*10)/10:0});
 console.log(JSON.stringify({generatedAt:new Date().toISOString(),totals,rows},null,1));
})();
