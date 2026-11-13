'use strict';
// Read-only real-network acceptance probe for the reviewed authority producer + shadow-mode risk engine (issue #226).
// Public endpoints only; eth_call simulations only (nothing is signed or sent); no ledger storage; production flags
// untouched (ARC_AUTONOMY_RISK_ENGINE_ENABLED is set only inside this process for the shadow check).
//
// Hard failures (exit 1):
//  * the public engine returns NOT_CONFIRMED for any rule (no reviewed negative producer exists)
//  * a CONFIRMED finding outside the reviewed routes (Ethereum upgrade, registry review id on every operator)
//  * a CONFIRMED finding whose record is not VERIFIED_ONCHAIN from >= 2 registered operators at one block hash
//  * any producer record fails the strict MetricEvidence contract
//  * a shadow-mode Search report differs in its keys from the flag-OFF report, or shadow mode did not run
const authority=require('../lib/risk-engine/producers/authority');
const reviewed=require('../lib/risk-engine/reviewed-code');
const {evaluateRisk}=require('../lib/risk-engine');
const evidence=require('../lib/verification/metric-evidence');
const observer=require('../lib/verification/onchain-observer');
const notice=(title,data)=>console.log('::notice title='+title+'::'+JSON.stringify(data).slice(0,3800));
const COHORT=[
 {network:'ethereum',name:'AAVE',address:'0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'},
 {network:'ethereum',name:'USDC',address:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'},
 {network:'ethereum',name:'USDT',address:'0xdac17f958d2ee523a2206206994597c13d831ec7'},
 {network:'ethereum',name:'PYUSD',address:'0x6c3ea9036406852006290770bedfcaba0e23a0e8'},
 {network:'ethereum',name:'ONDO',address:'0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3'},
 {network:'ethereum',name:'UNI',address:'0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'},
 {network:'ethereum',name:'USDY',address:'0x96f6ef951840721adbf46ac996b59e0235cb985c'},
 {network:'ethereum',name:'OUSG',address:'0x1b19c19393e2d034d8ff31ff34c81252fcbbee92'},
 {network:'ethereum',name:'USDon',address:'0xace8e719899f6e91831b18ae746c9a965c2119f1'},
 {network:'arc',name:'ARCY',address:'0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'},
 {network:'arc',name:'snapshot-171a',address:'0x171a4217b86a807a64eb94757db6849fb4bdbaa0'},
 {network:'arc',name:'snapshot-1ed9',address:'0x1ed9306725b8b4ca1a1a56d32970e49e64c51dde'},
 {network:'robinhood',name:'TSLA',address:'0x322f0929c4625ed5bad873c95208d54e1c003b2d'},
 {network:'robinhood',name:'AAPL',address:'0xaf3d76f1834a1d425780943c99ea8a608f8a93f9'},
 {network:'robinhood',name:'LINK',address:'0x492641f648a4986844848e0befe66d14817bce34'},
 {network:'robinhood',name:'PONS',address:'0x39dbed3a2bd333467115de45665cc57f813c4571'}
];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pct=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.ceil(s.length*p)-1)];};
async function head(network){
 const url=observer.endpoints(network,{}).endpoints[0].url;
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]}),signal:AbortSignal.timeout(10000)});
 const b=await r.json();return '0x'+(BigInt(b.result)-2n).toString(16);
}
(async()=>{
 delete process.env.ARC_AUTONOMY_RISK_ENGINE_ENABLED;delete process.env.ARC_VERIFICATION_LEDGER_DIR;delete process.env.ARC_HOLDER_PUBLISHED_DIR;
 const hard=[],ms=[],calls=[],table={};
 for(const t of COHORT){
  const row={network:t.network,name:t.name,address:t.address};
  try{
   const block=await head(t.network),r=await authority.produce({network:t.network,token:t.address,block});
   ms.push(r.cost.ms);calls.push(r.cost.rpcCalls);
   const risk=evaluateRisk({network:t.network,chainId:evidence.NETWORKS[t.network],token:t.address,scope:null,evidence:r.records,now:Date.now()});
   for(const x of r.records){try{evidence.parseMetricEvidence(x);}catch(e){hard.push(t.name+' '+x.metricId+' contract '+e.message);}}
   for(const f of risk.findings){
    if(f.status==='NOT_CONFIRMED')hard.push(t.name+' '+f.ruleId+' NOT_CONFIRMED without a reviewed negative producer');
    if(f.status==='CONFIRMED'){
     // Reviewed routes exist only for Ethereum upgrades; a confirmation anywhere else, or without a registry review id
     // shared by every operator, is a defect.
     const ids=new Set(r.operators.map(o=>o.outcome?.[f.ruleId==='privileged-minting'?'mint':'upgrade']?.reviewId||''));
     if(t.network!=='ethereum'||f.ruleId!=='admin-upgrade-authority'||ids.size!==1||!reviewed.REGISTRY.entries.some(e=>ids.has(e.id)))hard.push(t.name+' '+f.ruleId+' CONFIRMED outside the reviewed routes');
     const x=r.records.find(y=>y.metricId===(f.ruleId==='privileged-minting'?'risk.mint-authority':'risk.upgrade-authority'));
     if(!x||x.state!=='VERIFIED_ONCHAIN'||new Set(x.observations.map(o=>o.source.operator)).size<2||new Set(x.observations.map(o=>o.block.hash)).size!==1)hard.push(t.name+' '+f.ruleId+' CONFIRMED without two-operator anchor');
    }
   }
   Object.assign(row,{block:r.block.number,independence:r.independence.independent?'INDEPENDENT':r.independence.reasonCode,
    operators:r.operators.map(o=>({role:o.role,operator:o.operator,state:o.state,reason:o.reasonCode,calls:o.rpcCalls,ms:o.ms,
     implementation:o.outcome?.implementation||null,proxyCode:(o.outcome?.proxyCodeHash||'').slice(0,18),implCode:(o.outcome?.implementationCodeHash||'').slice(0,18),beacon:o.outcome?.beacon||null,
     upgrade:o.outcome?.upgrade&&[o.outcome.upgrade.state,o.outcome.upgrade.reasonCode||'',o.outcome.upgrade.actorRole||'',o.outcome.upgrade.selector||'',o.outcome.upgrade.reviewId||''].join('|'),
     mint:o.outcome?.mint&&[o.outcome.mint.state,o.outcome.mint.reasonCode||'',o.outcome.mint.actorRole||'',o.outcome.mint.reviewId||''].join('|')})),
    records:Object.fromEntries(r.records.map(x=>[x.metricId,x.state+'|'+x.reasonCode])),
    findings:Object.fromEntries(risk.findings.map(f=>[f.ruleId,f.status+'|'+f.reasonCode])),rpcCalls:r.cost.rpcCalls,ms:r.cost.ms});
   const n=table[t.network]||={tokens:0,CONFIRMED:0,NOT_CONFIRMED:0,UNKNOWN:0,STALE:0,CONFLICTING:0,UNSUPPORTED:0};
   n.tokens++;for(const f of risk.findings)n[f.status]++;
  }catch(e){row.error=String(e?.message||e).slice(0,160);}
  notice('risk-'+t.network+'-'+t.name,row);
  await sleep(t.network==='arc'?2500:1000);
 }
 notice('risk-coverage-by-network (6 rules x tokens)',table);
 notice('risk-cost',{analyses:ms.length,p50Ms:pct(ms,.5),p95Ms:pct(ms,.95),maxMs:ms.length?Math.max(...ms):null,rpcCallsMin:calls.length?Math.min(...calls):null,rpcCallsMax:calls.length?Math.max(...calls):null});
 // Shadow mode through the real Search report path: identical response keys, shadow evaluation recorded.
 const service=require('../search/server/lib/multichain-service'),shadow=require('../lib/risk-engine/shadow');
 for(const t of ['AAVE','ARCY','TSLA'].map(n=>COHORT.find(c=>c.name===n))){
  const row={network:t.network,name:t.name};
  try{
   delete process.env.ARC_AUTONOMY_RISK_ENGINE_ENABLED;
   const off=await service.report({network:t.network,address:t.address});
   process.env.ARC_AUTONOMY_RISK_ENGINE_ENABLED='1';
   // The analysis cache only shares IN-FLIGHT work, so this second call builds a fresh report with the flag ON.
   const on=await service.report({network:t.network,address:t.address});
   delete process.env.ARC_AUTONOMY_RISK_ENGINE_ENABLED;
   const s=shadow.latest(t.network,t.address);
   row.sameKeys=JSON.stringify(Object.keys(off))===JSON.stringify(Object.keys(on));
   row.sameCardKeys=JSON.stringify(Object.keys(off.cards))===JSON.stringify(Object.keys(on.cards));
   row.shadow=s?{state:s.state,ledger:s.ledger.state+'/'+s.ledger.history,findings:Object.fromEntries(s.findings.map(f=>[f.ruleId,f.status])),ms:s.cost.totalMs}:null;
   if(!row.sameKeys||!row.sameCardKeys)hard.push(t.name+' shadow changed the report shape');
   if(!s)hard.push(t.name+' shadow did not run');
  }catch(e){row.error=String(e?.message||e).slice(0,160);}
  notice('risk-shadow-'+t.network+'-'+t.name,row);
 }
 if(hard.length){for(const h of hard)console.error('::error::'+h.slice(0,300));process.exit(1);}
})().catch(e=>{console.error('::error::probe crashed: '+String(e&&e.stack||e).slice(0,400));process.exit(1);});
