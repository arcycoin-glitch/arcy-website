'use strict';
// Read-only real-network probe for the Autonomous Verification Runtime (lib/verification/runtime.js).
// Builds REAL Search reports through the production code path (search/server/lib/multichain-service.js) for a fixed
// cohort on Arc, Ethereum and Robinhood, first with ARC_AUTONOMY_VERIFICATION_RUNTIME_ENABLED unset and then with it
// set to 1 in THIS process only. Public endpoints, no credentials, no ledger storage, nothing is written or sent.
// Market display gates are left as configured (default off), so market metrics show their licence state honestly.
//
// Hard failures (exit 1):
//  * flag OFF adds anything (a `verification` key appears)
//    (that flag ON never modifies a card is proven by test/verification-runtime.test.js; two live reports cannot be
//    compared byte-for-byte because chain and market state move between them)
//  * any published MetricEvidence fails the strict contract
//  * any metric is VERIFIED while its displayed value did not match the same-block reads
//  * the runtime FAILED for a report
//  * Ethereum USDC total supply is not VERIFIED_ONCHAIN (the two Ethereum operators are the reference pair)
const evidence=require('../lib/verification/metric-evidence');
const notice=(title,data)=>console.log('::notice title='+title+'::'+JSON.stringify(data).slice(0,3800));
const COHORT=[
 {network:'ethereum',name:'USDC',address:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',required:true},
 {network:'ethereum',name:'UNI',address:'0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'},
 {network:'ethereum',name:'ONDO',address:'0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3'},
 {network:'arc',name:'ARCY',address:'0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'},
 {network:'robinhood',name:'TSLA',address:'0x322f0929c4625ed5bad873c95208d54e1c003b2d'},
 {network:'robinhood',name:'PONS',address:'0x39dbed3a2bd333467115de45665cc57f813c4571'}
];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pct=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.ceil(s.length*p)-1)];};
async function timed(fn){const t=Date.now();try{return {value:await fn(),ms:Date.now()-t};}catch(e){return {error:String(e?.message||e).slice(0,120),ms:Date.now()-t};}}
(async()=>{
 delete process.env.ARC_AUTONOMY_VERIFICATION_RUNTIME_ENABLED;
 delete process.env.ARC_VERIFICATION_LEDGER_DIR;delete process.env.ARC_HOLDER_PUBLISHED_DIR;
 const service=require('../search/server/lib/multichain-service');
 const out={generatedAt:new Date().toISOString(),tokens:[]};let hard=[];const off=[],on=[],rpc=[];
 for(const t of COHORT){
  const row={network:t.network,name:t.name,address:t.address};
  delete process.env.ARC_AUTONOMY_VERIFICATION_RUNTIME_ENABLED;
  const a=await timed(()=>service.report({network:t.network,address:t.address}));
  row.offMs=a.ms;if(a.error)row.offError=a.error;else{off.push(a.ms);if('verification' in a.value)hard.push(t.name+': verification present with flag OFF');}
  await sleep(1500);
  process.env.ARC_AUTONOMY_VERIFICATION_RUNTIME_ENABLED='1';
  const b=await timed(()=>service.report({network:t.network,address:t.address}));
  delete process.env.ARC_AUTONOMY_VERIFICATION_RUNTIME_ENABLED;
  row.onMs=b.ms;
  if(b.error){row.onError=b.error;out.tokens.push(row);notice('verify-'+t.network+'-'+t.name,row);if(t.required)hard.push(t.name+': report failed '+b.error);await sleep(1500);continue;}
  on.push(b.ms);
  const v=b.value.verification;
  if(!v||v.state!=='COMPLETE'){hard.push(t.name+': runtime '+(v?.state||'missing')+' '+(v?.reasonCode||''));row.runtime=v?.state||null;out.tokens.push(row);notice('verify-'+t.network+'-'+t.name,row);continue;}
  rpc.push(v.budget.rpcCalls);
  for(const [id,m] of Object.entries(v.metrics)){
   try{evidence.parseMetricEvidence(m.evidence);}catch(e){hard.push(t.name+' '+id+': contract '+e.message);}
   if(m.verified&&m.display&&m.display.matches!==true)hard.push(t.name+' '+id+': verified without display match');
  }
  if(t.required&&v.metrics['supply.total_supply'].state!=='VERIFIED_ONCHAIN')hard.push(t.name+' total supply: '+v.metrics['supply.total_supply'].state+' '+v.metrics['supply.total_supply'].reasonCode);
  Object.assign(row,{block:v.block.number,blockHash:v.block.hash&&v.block.hash.slice(0,18),independence:v.independence,
   providers:v.providers.map(p=>({role:p.role,operator:p.operator,state:p.state,reason:p.reasonCode,watchdog:p.watchdogState,calls:p.rpcCalls,ms:p.ms})),
   budget:v.budget,summary:Object.fromEntries(Object.entries(v.summary).filter(([,n])=>n)),verified:v.verifiedCount+'/'+v.metricCount,
   metrics:Object.fromEntries(Object.entries(v.metrics).map(([id,m])=>[id,[m.state,m.reasonCode,m.freshness?.state||null,m.display?.matches??null].join('|')])),
   ledger:v.ledger.state+'/'+v.ledger.history});
  out.tokens.push(row);notice('verify-'+t.network+'-'+t.name,row);
  await sleep(1500);
 }
 out.latency={reportsOff:off.length,offP50Ms:pct(off,.5),offP95Ms:pct(off,.95),reportsOn:on.length,onP50Ms:pct(on,.5),onP95Ms:pct(on,.95),
  verificationRpcCallsMin:rpc.length?Math.min(...rpc):null,verificationRpcCallsMax:rpc.length?Math.max(...rpc):null};
 notice('verify-latency',out.latency);
 const byNetwork={};for(const r of out.tokens){const n=byNetwork[r.network]||={tokens:0,verifiedOnchain:0,metrics:0};n.tokens++;
  if(r.summary){n.verifiedOnchain+=r.summary.VERIFIED_ONCHAIN||0;n.metrics+=20;}}
 notice('verify-by-network',byNetwork);
 console.log(JSON.stringify(out,null,1));
 if(hard.length){for(const h of hard)console.error('::error::'+h.slice(0,300));process.exit(1);}
})().catch(e=>{console.error('::error::probe crashed: '+String(e&&e.stack||e).slice(0,400));process.exit(1);});
