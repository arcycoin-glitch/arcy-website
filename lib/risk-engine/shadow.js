'use strict';
// Risk Engine shadow integration (issues #226, #234).
//
// Flags (all default OFF):
//   ARC_AUTONOMY_RISK_ENGINE_ENABLED=1   Search enqueues the token for background verification and reads the latest
//                                        validated snapshot. It NEVER runs a producer in the request path.
//   ARC_AUTONOMY_RISK_WORKER_ENABLED=1   the Railway worker runs the reviewed producers (lib/risk-engine/worker.js).
//   ARC_AUTONOMY_RISK_PUBLIC_ENABLED=1   additionally attaches `riskFindings` to the Search report. Requires the engine
//                                        flag; must stay OFF until shadow acceptance AND an independent human security
//                                        review (docs/RISK_SHADOW_ACCEPTANCE.md).
// OFF => nothing runs, no request is made, the report is byte-identical.
// Request-path module: it must never require a producer (see lib/risk-engine/analyze.js and the bundle test).
const {evaluateRisk}=require('./index');
const {chain}=require('../../search/server/lib/chains');

const FLAG='ARC_AUTONOMY_RISK_ENGINE_ENABLED',PUBLIC_FLAG='ARC_AUTONOMY_RISK_PUBLIC_ENABLED';
const SCHEMA_VERSION=2;
const LIMITS=Object.freeze({ledgerTimeoutMs:1500,minRewriteMs:60000,buffer:200,requestPathMs:300});
const ADDRESS=/^0x[0-9a-f]{40}$/i,BLOCK_HEX=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const fail=code=>Object.assign(Error(code),{code});
const enabled=(env=process.env)=>env[FLAG]==='1';
const publicEnabled=(env=process.env)=>enabled(env)&&env[PUBLIC_FLAG]==='1';
function withTimeout(promise,ms,code='EVIDENCE_LEDGER_TIMEOUT'){let timer;return Promise.race([promise,new Promise((_,r)=>{timer=setTimeout(()=>r(fail(code)),ms);})]).finally(()=>clearTimeout(timer));}

// Read-time evaluation of stored records. Freshness is always judged against `now`, so an old snapshot becomes STALE;
// it is never re-labelled as a fresh verdict.
function evaluate({network,token,scope,records,now}){
 const cfg=chain(network);
 const risk=evaluateRisk({network:cfg.id,chainId:cfg.chainId,token,scope:scope||null,evidence:records,now});
 return risk;
}
// Public presentation of a re-evaluated snapshot (only used behind the public gate). Every finding says what was
// verified, why it matters, the source and chain, the contract, the block and observation time, and the limits.
const WHY=Object.freeze({
 'admin-upgrade-authority':'A privileged actor can replace the code this token runs.',
 'privileged-minting':'A privileged actor can create new supply.',
 'high-exit-impact':'Selling $1,000 in the main reviewed pool moves the price by at least 5%.',
 'low-pool-liquidity':'The main reviewed pool holds little value, so trades move the price.',
 'sell-transfer-tax':'Selling would lose part of the amount to a token-side deduction.',
 'top-ten-holder-concentration':'A few addresses control most of the circulating supply.'});
const LIMITS_TEXT=Object.freeze({
 'admin-upgrade-authority':'Shows the reviewed upgrade path at this block; not who controls the admin key or whether a timelock applies.',
 'privileged-minting':'Shows a reviewed mint path for one actor at this block; other mint paths are not enumerated.',
 'high-exit-impact':'Constant-product model of the deepest reviewed Uniswap/SushiSwap pool at one block; token taxes, gas, Curve/Balancer and centralized exchanges are not included.',
 'low-pool-liquidity':'The deepest reviewed Uniswap/SushiSwap pool at one block, valued with a reviewed USD feed; Curve/Balancer and centralized exchanges are not included.',
 'sell-transfer-tax':'Not measured.',
 'top-ten-holder-concentration':'Counts addresses without code only; custodial wallets (e.g. exchanges) count as holders.'});
function present(snapshot,now){
 if(!snapshot)return null;
 const risk=evaluate({network:snapshot.network,token:snapshot.token,scope:snapshot.scope,records:snapshot.records||[],now});
 const byMetric=new Map((snapshot.records||[]).map(r=>[r.metricId,r]));
 const rules=new Map(require('./rules').RULES.map(r=>[r.id,r]));
 return {schemaVersion:1,network:snapshot.network,chainId:snapshot.chainId,token:snapshot.token,evaluatedAt:new Date(now).toISOString(),analysedAt:snapshot.generatedAt||null,
  findings:risk.findings.map(f=>{const rule=rules.get(f.ruleId),r=byMetric.get(rule.metricId);
   return {ruleId:f.ruleId,status:f.status,severity:f.severity,verified:f.status==='CONFIRMED'||f.status==='NOT_CONFIRMED'?f.explanation:null,why:WHY[f.ruleId],
    source:r&&r.observations?.length?{chain:snapshot.network,operators:r.observations.map(o=>o.source.operator),producer:r.engine}:null,contract:f.scope||snapshot.token,
    block:r?.block||null,observedAt:r?.observedAt||null,reasonCode:f.reasonCode,limitations:LIMITS_TEXT[f.ruleId]};})};
}

// Called from the Search report builder. Never throws, never runs a producer, bounded to LIMITS.requestPathMs.
async function runIfEnabled(report,options={}){
 const env=options.env||process.env;
 if(!enabled(env))return null;
 const now=options.now||Date.now,log=options.log||(line=>console.log(line));
 try{
  const network=options.network||report?.network;chain(network);
  if(!report||!ADDRESS.test(report.address||''))throw fail('RISK_SHADOW_REPORT_INVALID');
  const token=report.address.toLowerCase(),store=(options.store||require('./store').open({env,fetcher:options.fetcher||fetch}));
  const [queued,snapshot]=await Promise.all([
   withTimeout(store.enqueue(network,token,now()),LIMITS.requestPathMs,'RISK_STORE_TIMEOUT').then(v=>v?'QUEUED':'QUEUE_FULL',e=>e.code||'RISK_STORE_UNAVAILABLE'),
   withTimeout(store.getSnapshot(network,token),LIMITS.requestPathMs,'RISK_STORE_TIMEOUT').catch(()=>null)]);
  const view=present(snapshot,now());
  if(publicEnabled(env)&&view)report.riskFindings=view;
  try{log(JSON.stringify({event:'RISK_SHADOW_REQUEST',network,token,queue:queued,snapshot:view?view.findings.map(f=>f.status[0]).join(''):null}));}catch{}
  return {schemaVersion:SCHEMA_VERSION,mode:'SHADOW',state:'READ',queue:queued,view};
 }catch(e){
  const reasonCode=/^[A-Z][A-Z0-9_]{0,63}$/.test(e?.code||'')?e.code:'RISK_SHADOW_FAILED';
  try{log(JSON.stringify({event:'RISK_SHADOW',state:'FAILED',reasonCode}));}catch{}
  return {schemaVersion:SCHEMA_VERSION,mode:'SHADOW',state:'FAILED',reasonCode};
 }
}
module.exports={FLAG,PUBLIC_FLAG,LIMITS,SCHEMA_VERSION,enabled,publicEnabled,runIfEnabled,present,evaluate,withTimeout};
