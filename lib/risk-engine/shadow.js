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
const {evaluateRisk}=require('./index');
const authority=require('./producers/authority');
const poolProducer=require('./producers/pool');
const concentrationProducer=require('./producers/concentration');
const evidenceLedger=require('../verification/evidence-ledger');
const {chain}=require('../../search/server/lib/chains');

const FLAG='ARC_AUTONOMY_RISK_ENGINE_ENABLED',PUBLIC_FLAG='ARC_AUTONOMY_RISK_PUBLIC_ENABLED';
const SCHEMA_VERSION=2;
const LIMITS=Object.freeze({ledgerTimeoutMs:1500,minRewriteMs:60000,buffer:200,requestPathMs:300});
const ADDRESS=/^0x[0-9a-f]{40}$/i,BLOCK_HEX=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const fail=code=>Object.assign(Error(code),{code});
const enabled=(env=process.env)=>env[FLAG]==='1';
const publicEnabled=(env=process.env)=>enabled(env)&&env[PUBLIC_FLAG]==='1';
const recent=new Map(),written=new Map();
function remember(key,value){recent.delete(key);recent.set(key,value);if(recent.size>LIMITS.buffer)recent.delete(recent.keys().next().value);}
function withTimeout(promise,ms,code='EVIDENCE_LEDGER_TIMEOUT'){let timer;return Promise.race([promise,new Promise((_,r)=>{timer=setTimeout(()=>r(fail(code)),ms);})]).finally(()=>clearTimeout(timer));}

async function persist(records,{env,ledger,now}){
 try{ledger.directory(env);}catch(e){return {state:'UNAVAILABLE',reasonCode:e.code||'EVIDENCE_LEDGER_STORAGE_UNCONFIGURED',history:'NOT_PRESERVED',written:0};}
 let count=0,throttled=0;const errors={};
 for(const record of records){
  const key=evidenceLedger.keyFor({metricId:record.metricId,network:record.network,token:record.token,scope:record.scope});
  const sig=record.state+'|'+record.reasonCode+'|'+record.value,last=written.get(key);
  if(last&&last.sig===sig&&now-last.at<LIMITS.minRewriteMs){throttled++;continue;}
  try{await withTimeout(ledger.record(record,{env}),LIMITS.ledgerTimeoutMs);count++;written.set(key,{sig,at:now});if(written.size>4096)written.delete(written.keys().next().value);}
  catch(e){const code=e.code||'EVIDENCE_LEDGER_WRITE_FAILED';errors[code]=(errors[code]||0)+1;}
 }
 const failed=Object.values(errors).reduce((a,b)=>a+b,0);
 return {state:failed?(count?'PARTIAL':'FAILED'):'RECORDED',reasonCode:failed?Object.keys(errors)[0]:null,history:failed&&!count?'NOT_PRESERVED':'PRESERVED',written:count,throttled,errors};
}

// Read-time evaluation of stored records. Freshness is always judged against `now`, so an old snapshot becomes STALE;
// it is never re-labelled as a fresh verdict.
function evaluate({network,token,scope,records,now}){
 const cfg=chain(network);
 const risk=evaluateRisk({network:cfg.id,chainId:cfg.chainId,token,scope:scope||null,evidence:records,now});
 return risk;
}
function gapsFor(risk,{records,producerReasons,network}){
 const blockers=require('./capability-matrix').blockers(network)||{},byMetric=new Map(records.map(r=>[r.metricId,r.reasonCode]));
 const rules=new Map(require('./rules').RULES.map(r=>[r.id,r]));
 return Object.fromEntries(risk.findings.filter(f=>f.status==='UNKNOWN').map(f=>{
  const rule=rules.get(f.ruleId),own=byMetric.get(rule.metricId),producer=producerReasons[f.ruleId];
  // A record exists but the gate refused it (e.g. a positive-only producer and a below-threshold value): say so.
  return [f.ruleId,own&&f.reasonCode!=='PRODUCER_NOT_REVIEWED'?own:f.reasonCode==='PRODUCER_NOT_REVIEWED'&&own?'VERDICT_POLARITY_NOT_REVIEWED':producer||blockers[f.ruleId]||f.reasonCode];
 }));
}

// Runs the reviewed producers for one token at one block. Used by the background worker and by probes, never by the
// Search request path. `producers` may be injected; the legacy `produce` option replaces the authority producer only.
async function analyze({network,token,block,env=process.env,fetcher=fetch,now=Date.now,producers,produce,ledger=evidenceLedger,log=line=>console.log(line)}){
 const cfg=chain(network);
 if(!ADDRESS.test(token||'')||!BLOCK_HEX.test(block||''))throw fail('RISK_SHADOW_REPORT_INVALID');
 const address=token.toLowerCase(),started=now();
 const p=producers||(produce?{authority:produce}:{authority:authority.produce,pool:poolProducer.produce,concentration:concentrationProducer.produce});
 const args={network:cfg.id,token:address,block,env,fetcher,now};
 const settle=async fn=>{if(!fn)return null;try{return await fn(args);}catch(e){return {records:[],reasonCode:/^[A-Z][A-Z0-9_]{0,63}$/.test(e?.code||'')?e.code:'RISK_PRODUCER_FAILED',cost:{rpcCalls:0,ms:0}};}};
 // Sequential, not parallel: the producers share the same two operators per network, and a burst of three producers
 // trips public-endpoint rate limits (observed: 429 -> watchdog cooldown -> every later analysis UNKNOWN).
 const auth=await settle(p.authority),pool=await settle(p.pool),conc=await settle(p.concentration);
 const records=[...(auth?.records||[]),...(pool?.records||[]),...(conc?.records||[])];
 const scope=pool?.pool||null,evaluatedAt=now();
 const risk=evaluate({network:cfg.id,token:address,scope,records,now:evaluatedAt});
 const stored=await persist(records,{env,ledger,now:evaluatedAt});
 const producerReasons={'low-pool-liquidity':pool?.reasonCode||null,'high-exit-impact':pool?.reasonCode||null,'top-ten-holder-concentration':conc?.reasonCode||null};
 const evidenceGaps=gapsFor(risk,{records,producerReasons,network:cfg.id});
 const rpcCalls=[auth,pool,conc].reduce((n,x)=>n+(x?.cost?.rpcCalls||0),0);
 const result={schemaVersion:SCHEMA_VERSION,mode:'SHADOW',state:'COMPLETE',network:cfg.id,chainId:cfg.chainId,token:address,block:auth?.block||pool?.block||conc?.block||{number:BigInt(block).toString(),hex:block},
  scope,producers:{authority:auth?.producer||null,pool:pool?.producer||null,concentration:conc?.producer||null},independence:auth?.independence||null,
  operators:{authority:auth?.operators||[],pool:(pool?.operators||[]).map(({outcome,...o})=>o),concentration:conc?.operators||[]},
  records,findings:risk.findings,evidenceGaps,dataQuality:risk.dataQuality,ledger:stored,
  cost:{rpcCalls,byProducer:{authority:auth?.cost?.rpcCalls||0,pool:pool?.cost?.rpcCalls||0,concentration:conc?.cost?.rpcCalls||0},totalMs:now()-started},generatedAt:new Date(evaluatedAt).toISOString()};
 remember(cfg.id+'|'+address,result);
 log(JSON.stringify({event:'RISK_SHADOW',network:cfg.id,token:address,block:result.block.number,scope,
  findings:Object.fromEntries(risk.findings.map(f=>[f.ruleId,f.status+'/'+f.reasonCode])),coverage:risk.dataQuality.coverage,gaps:evidenceGaps,
  rpcCalls,ms:result.cost.totalMs,ledger:stored.state}));
 return result;
}
// Probe / test entry: analyze at a report's exact block.
async function run(report,options={}){
 const network=options.network||report?.network;chain(network);
 if(!report||!ADDRESS.test(report.address||'')||!BLOCK_HEX.test(report.block||''))throw fail('RISK_SHADOW_REPORT_INVALID');
 return analyze({...options,network,token:report.address,block:report.block});
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
const latest=(network,token)=>{const v=recent.get(network+'|'+String(token).toLowerCase());return v?structuredClone(v):null;};
module.exports={FLAG,PUBLIC_FLAG,LIMITS,enabled,publicEnabled,analyze,run,runIfEnabled,present,evaluate,latest,_reset:()=>{recent.clear();written.clear();}};
