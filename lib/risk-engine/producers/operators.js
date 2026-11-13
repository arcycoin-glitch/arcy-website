'use strict';
// Shared read harness for reviewed risk producers: the registered independent operators of one network read the SAME
// pinned block. Per operator: chain id check, header anchor, the producer's reads, then the header again (a changed hash
// fails that operator). Provider Watchdog cooldown is honoured and updated exactly like the authority producer.
// Read-only: the producer's `read` receives a bounded `call(method, params)`; only the observer client is used.
const evidence=require('../../verification/metric-evidence');
const observer=require('../../verification/onchain-observer');
const watchdog=require('../../verification/provider-watchdog');
const {client,loadHealth,saveHealth}=observer.internals;
const QTY=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i,HASH=/^0x[0-9a-f]{64}$/i,BLOCK_HEX=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const fail=(code,extra={})=>Object.assign(Error(code),{code,...extra});
async function readOperator(e,{network,block,fetcher,deadlineAt,now,limits,read,minIntervalMs}){
 const chainId=evidence.NETWORKS[network];
 const rpc=client({url:e.url,fetcher,deadlineAt,now,timeoutMs:limits.timeoutMs,maxCalls:limits.callsPerEndpoint,maxBodyBytes:limits.maxBodyBytes});
 const started=now();let failure=null,failedAt=null;
 // {ok,result} | {ok:false,reverted:true} (a contract property) | {ok:false,error} (a provider failure; fails the operator)
 // Optional pacing per operator (public endpoints rate-limit bursts; a 429 puts the provider in cooldown for every producer).
 // Wall clock on purpose: pacing is a transport property, independent of the (injectable) evaluation clock.
 const interval=Number.isSafeInteger(minIntervalMs)&&minIntervalMs>=0?minIntervalMs:limits.minIntervalMs||0;
 let nextAt=0;const pace=async()=>{if(!interval)return;const t=Date.now(),wait=nextAt-t;if(wait>0)await new Promise(r=>setTimeout(r,wait));nextAt=Math.max(t,nextAt)+interval;};
 const call=async(method,params)=>{await pace();try{return {ok:true,result:await rpc.call(method,params)};}
  catch(error){if(error.code==='CALL_REVERTED')return {ok:false,reverted:true};if(!failure){failure=error;failedAt=method+(method==='eth_call'?':'+String(params?.[0]?.data||'').slice(0,10):'');}return {ok:false,error:error.code||'RPC_FAILED'};}};
 // failedAt names the first failing call (method and selector only; no endpoint, no address) for diagnostics.
 const done=(state,extra={})=>({state,reasonCode:failure?.code||extra.reasonCode||null,failure,failedAt,rpcError:failure?.rpcCode??null,cost:{rpcCalls:rpc.cost.rpcCalls,ms:now()-started},...extra});
 const setFailure=(code,kind='MALFORMED')=>{if(!failure)failure=Object.assign(fail(code),{kind});};
 const id=await call('eth_chainId',[]);
 if(!id.ok)return done('FAILED');
 if(!QTY.test(id.result||'')||Number(BigInt(id.result))!==chainId){failure=Object.assign(fail('RPC_WRONG_CHAIN'),{kind:'WRONG_CHAIN'});return done('FAILED');}
 const header=async()=>{const h=await call('eth_getBlockByNumber',[block,false]);
  return h.ok&&h.result&&h.result.number?.toLowerCase()===block&&HASH.test(h.result.hash||'')&&QTY.test(h.result.timestamp||'')?{hash:h.result.hash.toLowerCase(),timestamp:Number(BigInt(h.result.timestamp))}:null;};
 const anchor=await header();
 if(!anchor){if(!failure)setFailure('RPC_MALFORMED_RESPONSE');return done('FAILED');}
 let outcome;
 try{outcome=await read({call,block,anchor,operator:e.operator});}
 catch(error){if(!failure)failure=error.code?error:Object.assign(fail('RPC_MALFORMED_RESPONSE'),{kind:'MALFORMED'});return done('FAILED');}
 if(failure)return done('FAILED');
 const after=await header();
 if(!after){if(!failure)setFailure('RPC_MALFORMED_RESPONSE');return done('FAILED');}
 if(after.hash!==anchor.hash){failure=Object.assign(fail('PINNED_BLOCK_CHANGED'),{kind:'PROVIDER_ERROR'});return done('FAILED');}
 return done('OK',{anchor,outcome});
}
async function runOperators({network,block,env=process.env,fetcher=fetch,now=Date.now,limits,read}){
 if(!Object.hasOwn(evidence.NETWORKS,network))throw fail('RISK_PRODUCER_UNSUPPORTED_NETWORK');
 if(!BLOCK_HEX.test(block||''))throw fail('RISK_PRODUCER_INVALID_BLOCK');
 const blockHex=block.toLowerCase(),started=now(),deadlineAt=started+limits.deadlineMs,{endpoints,independence}=observer.endpoints(network,env);
 const rows=await Promise.all(endpoints.map(async e=>{
  const state=await loadHealth(network,e.providerId,env),gate=watchdog.eligibility(state,now());
  const base={role:e.role,operator:e.operator,operatorBasis:e.basis};
  if(gate.mode==='SKIP')return {...base,state:'SKIPPED',reasonCode:gate.reasonCode,cost:{rpcCalls:0,ms:0}};
  const r=await readOperator(e,{network,block:blockHex,fetcher,deadlineAt,now,limits,read,minIntervalMs:env.ARC_RISK_RPC_MIN_INTERVAL_MS===undefined?undefined:Number(env.ARC_RISK_RPC_MIN_INTERVAL_MS)});
  const at=now();
  const health=r.failure?await saveHealth(network,e.providerId,{kind:r.failure.kind||'PROVIDER_ERROR',httpStatus:r.failure.httpStatus??null,retryAfterMs:r.failure.retryAfterMs||0,at},env):
   await saveHealth(network,e.providerId,{kind:'SUCCESS',reason:gate.mode==='PROBE'?'RECOVERY_PROBE_OK':'SUCCESS',latencyMs:Math.min(r.cost.ms,120000),at},env);
  const {failure,...rest}=r;return {...base,...rest,watchdogState:health.state};
 }));
 return {rows,independence,blockHex,blockNumber:BigInt(blockHex).toString(),started,
  cost:{rpcCalls:rows.reduce((n,r)=>n+r.cost.rpcCalls,0),ms:now()-started}};
}
// One MetricEvidence record (strict contract) from operator rows. `pick(outcome)` returns {value} for a determinable
// observation or {reasonCode} when this operator could not determine it. `signature(outcome)` is everything two operators
// must agree on beyond the value (pool, factory, anchor feed, candidate set ...): a differing signature with the same value
// is NOT_VERIFIED / EXECUTION_IDENTITY_MISMATCH, a differing value is CONFLICTING / VALUE_MISMATCH.
function buildRecord({metricId,unit,method,reference,network,token,scope,generatedAt,blockNumber,rows,independence,engine,pick,signature}){
 const chainId=evidence.NETWORKS[network],S=evidence.STATES;
 const base={schemaVersion:evidence.SCHEMA_VERSION,metricId,network,token,scope,unit,generatedAt,disagreement:null,engine:{...engine}};
 const empty=(state,reasonCode,observations=[],disagreement=null)=>({...base,value:null,observedAt:null,block:null,source:null,state,reasonCode,dataAgeMs:null,observations,disagreement});
 const obs=(r,value)=>({source:{id:(network+'-rpc-'+r.operator).slice(0,64),class:'ONCHAIN_RPC',operator:r.operator},value,unit,token,scope,
  observedAt:new Date(Math.min(r.anchor.timestamp*1000,Date.parse(generatedAt))).toISOString(),block:{number:blockNumber,hash:r.anchor.hash},chainId,provenance:{method,reference}});
 const ok=rows.filter(r=>r.state==='OK').map(r=>({r,p:pick(r.outcome)||{reasonCode:'NOT_DETERMINABLE'}}));
 if(!ok.length)return empty(S.UNAVAILABLE,rows.find(r=>r.reasonCode)?.reasonCode||'NO_USABLE_OPERATOR_READ');
 const hashes=new Set(ok.map(x=>x.r.anchor.hash));
 if(ok.length>=2&&hashes.size>1)return empty(S.CONFLICTING,'BLOCK_HASH_MISMATCH',[],{kind:'BLOCK_HASH_MISMATCH',sources:ok.map(x=>(network+'-rpc-'+x.r.operator).slice(0,64))});
 const det=ok.filter(x=>x.p.value!==undefined&&x.p.value!==null);
 if(ok.length>=2&&det.length===ok.length){
  const values=new Set(det.map(x=>JSON.stringify(x.p.value)));
  if(values.size>1)return empty(S.CONFLICTING,'VALUE_MISMATCH',det.map(x=>obs(x.r,x.p.value)),{kind:'VALUE_MISMATCH',sources:det.map(x=>(network+'-rpc-'+x.r.operator).slice(0,64))});
 }
 if(ok.length>=2&&new Set(ok.map(x=>signature(x.r.outcome))).size>1)return empty(S.NOT_VERIFIED,'EXECUTION_IDENTITY_MISMATCH');
 if(!det.length)return empty(S.NOT_VERIFIED,ok[0].p.reasonCode||'NOT_DETERMINABLE');
 if(det.length<ok.length)return empty(S.NOT_VERIFIED,'OPERATORS_DISAGREE_ON_DETERMINABILITY');
 const o=det.map(x=>obs(x.r,x.p.value)),first=o[0];
 const trusted=independence.independent&&det.length>=2&&new Set(o.map(x=>x.source.operator)).size>=2;
 return {...base,value:first.value,observedAt:first.observedAt,block:{...first.block},source:{...first.source},
  state:trusted?S.VERIFIED_ONCHAIN:S.SINGLE_SOURCE,
  reasonCode:trusted?'EXACT_ONCHAIN_AGREEMENT':independence.independent?'INDEPENDENT_OPERATOR_UNAVAILABLE':(independence.reasonCode||'NO_INDEPENDENT_OPERATOR'),
  dataAgeMs:Date.parse(generatedAt)-Date.parse(first.observedAt),observations:trusted?o:[first]};
}
module.exports={runOperators,buildRecord,fail};
