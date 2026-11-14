'use strict';
// Worker / probe side of the Risk Engine: runs the reviewed producers for one token at one block, persists the records to
// the Evidence Ledger and returns the full result. Never required by Search request-path code (lib/risk-engine/shadow.js),
// so producer code is not bundled into the Vercel functions (test/risk-bundle-boundary.test.js).
const authority=require('./producers/authority');
const poolProducer=require('./producers/pool');
const concentrationProducer=require('./producers/concentration');
const evidenceLedger=require('../verification/evidence-ledger');
const {chain}=require('../../search/server/lib/chains');
const {LIMITS,SCHEMA_VERSION,evaluate,withTimeout}=require('./shadow');
const ADDRESS=/^0x[0-9a-f]{40}$/i,BLOCK_HEX=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const fail=code=>Object.assign(Error(code),{code});
const recent=new Map(),written=new Map();
function remember(key,value){recent.delete(key);recent.set(key,value);if(recent.size>LIMITS.buffer)recent.delete(recent.keys().next().value);}
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

const latest=(network,token)=>{const v=recent.get(network+'|'+String(token).toLowerCase());return v?structuredClone(v):null;};
module.exports={analyze,run,latest,_reset:()=>{recent.clear();written.clear();}};
