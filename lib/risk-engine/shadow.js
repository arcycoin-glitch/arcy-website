'use strict';
// Shadow-mode integration of the Autonomous Risk Engine with Search reports (issue #226).
//
// Flag: ARC_AUTONOMY_RISK_ENGINE_ENABLED=1 (default OFF). OFF => nothing runs, no request is made.
// ON  => after a report is built, the reviewed authority producer re-reads the token at the report's exact block on
//        two registered operators, the public risk engine evaluates those records, and the result is
//          * persisted as MetricEvidence in the Evidence Ledger when durable storage exists (history is reported as
//            NOT_PRESERVED otherwise — e.g. on Vercel, whose filesystem is not shared or durable),
//          * emitted as ONE structured, secret-free log line (event RISK_SHADOW),
//          * kept in a small bounded in-process buffer for probes and tests.
//        It is NEVER attached to the report: cards, fields, statuses and every API response stay exactly as they are.
const {evaluateRisk}=require('./index');
const authority=require('./producers/authority');
const evidenceLedger=require('../verification/evidence-ledger');
const {chain}=require('../../search/server/lib/chains');

const FLAG='ARC_AUTONOMY_RISK_ENGINE_ENABLED';
const SCHEMA_VERSION=1;
const LIMITS=Object.freeze({ledgerTimeoutMs:1500,minRewriteMs:60000,buffer:200});
const ADDRESS=/^0x[0-9a-f]{40}$/i,BLOCK_HEX=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const fail=code=>Object.assign(Error(code),{code});
const enabled=(env=process.env)=>env[FLAG]==='1';
const recent=new Map(),written=new Map();
function remember(key,value){recent.delete(key);recent.set(key,value);if(recent.size>LIMITS.buffer)recent.delete(recent.keys().next().value);}
function withTimeout(promise,ms){let timer;return Promise.race([promise,new Promise((_,r)=>{timer=setTimeout(()=>r(fail('EVIDENCE_LEDGER_TIMEOUT')),ms);})]).finally(()=>clearTimeout(timer));}

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

async function run(report,{network=report?.network,env=process.env,fetcher=fetch,now=Date.now,produce=authority.produce,ledger=evidenceLedger,log=line=>console.log(line)}={}){
 const cfg=chain(network);
 if(!report||!ADDRESS.test(report.address||'')||!BLOCK_HEX.test(report.block||''))throw fail('RISK_SHADOW_REPORT_INVALID');
 const token=report.address.toLowerCase(),started=now();
 const produced=await produce({network:cfg.id,token,block:report.block,env,fetcher,now});
 const evaluatedAt=now();
 const risk=evaluateRisk({network:cfg.id,chainId:cfg.chainId,token,scope:null,evidence:produced.records,now:evaluatedAt});
 const stored=await persist(produced.records,{env,ledger,now:evaluatedAt});
 const shadow={schemaVersion:SCHEMA_VERSION,mode:'SHADOW',state:'COMPLETE',network:cfg.id,chainId:cfg.chainId,token,block:produced.block,
  producer:produced.producer,independence:produced.independence,operators:produced.operators,
  records:produced.records.map(r=>({metricId:r.metricId,state:r.state,reasonCode:r.reasonCode,value:r.value,block:r.block})),
  findings:risk.findings,dataQuality:risk.dataQuality,ledger:stored,cost:{...produced.cost,totalMs:now()-started}};
 remember(cfg.id+'|'+token,shadow);
 log(JSON.stringify({event:'RISK_SHADOW',network:cfg.id,token,block:produced.block.number,
  findings:Object.fromEntries(risk.findings.map(f=>[f.ruleId,f.status+'/'+f.reasonCode])),coverage:risk.dataQuality.coverage,
  rpcCalls:produced.cost.rpcCalls,ms:shadow.cost.totalMs,ledger:stored.state}));
 return shadow;
}
// Called from the Search report builder. Never throws, never mutates the report, returns the shadow result (or null).
async function runIfEnabled(report,options={}){
 const env=options.env||process.env;
 if(!enabled(env))return null;
 try{return await run(report,{...options,env});}
 catch(e){
  const reasonCode=/^[A-Z][A-Z0-9_]{0,63}$/.test(e?.code||'')?e.code:'RISK_SHADOW_FAILED';
  try{(options.log||(line=>console.log(line)))(JSON.stringify({event:'RISK_SHADOW',state:'FAILED',reasonCode}));}catch{}
  return {schemaVersion:SCHEMA_VERSION,mode:'SHADOW',state:'FAILED',reasonCode};
 }
}
const latest=(network,token)=>{const v=recent.get(network+'|'+String(token).toLowerCase());return v?structuredClone(v):null;};
module.exports={FLAG,LIMITS,enabled,run,runIfEnabled,latest,_reset:()=>{recent.clear();written.clear();}};
