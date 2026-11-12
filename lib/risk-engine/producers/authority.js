'use strict';
// Reviewed risk-evidence producer: privileged UPGRADE and MINT authority (positive findings only).
//
// Claim proven, per rule, at ONE pinned block:
//   risk.upgrade-authority = true   an EIP-1967 proxy (implementation slot set) accepts
//                                   upgradeToAndCall(currentImplementation, "") or upgradeTo(currentImplementation)
//                                   from a privileged actor (the EIP-1967 admin slot or owner()), while the same call
//                                   from an unprivileged control address reverts
//   risk.mint-authority = true      the standard mint(address,uint256) entry point exists in the executing bytecode and
//                                   accepts mint(control, 1) from a privileged actor (owner() or the EIP-1967 admin),
//                                   while the same call from the unprivileged control address reverts
// The differential (privileged succeeds, control reverts) shows ACCESS only: an owner-only no-op or a privileged
// fallback produces the same observation. Since v2 the record is positive only when, in addition, the code that
// handles the call has a reviewed entry in REVIEWED_CODE stating that it really performs the operation. Both
// registered operators must observe the identical outcome (including code hash) at the identical block hash.
//
// What this producer NEVER does:
//  * emit `false` / a negative audit: failing to demonstrate a path is NOT_VERIFIED, never "no mint risk";
//  * treat a missing getter, an empty slot, a selector, or a GoPlus label as a finding;
//  * send a transaction: every call is eth_call (simulation) and nothing is persisted on chain.
// A successful eth_call shows the authorization check passes for that actor at that block; it is not proof that a
// transaction would be included, nor that the actor's key or multisig is live.
const keccak=require('../../keccak');
const evidence=require('../../verification/metric-evidence');
const {chain}=require('../../../search/server/lib/chains');
const observer=require('../../verification/onchain-observer');
const watchdog=require('../../verification/provider-watchdog');
const {client,loadHealth,saveHealth}=observer.internals;

// v2 (security review of #227): a privileged call that is ACCEPTED is no longer enough. An owner-only no-op or a
// privileged fallback accepts the same calldata without changing any slot or balance. A positive record now also
// requires that the exact runtime code handling the call is in REVIEWED_CODE, whose entries document (from reviewed,
// bytecode-matched source) that the function really writes the EIP-1967 slot / increases supply. V2 ships with an
// EMPTY registry: until a code hash is reviewed, every case is UNKNOWN / OPERATION_SEMANTICS_UNREVIEWED.
const PRODUCER=Object.freeze({id:'arcy-risk-authority-producer',version:2});
// { [network]: { [keccak256(runtime code)]: { upgrade?: true, mint?: true, reference: '<reviewed source>' } } }
const REVIEWED_CODE=Object.freeze({arc:Object.freeze({}),ethereum:Object.freeze({}),robinhood:Object.freeze({})});
const codeHash=code=>typeof code==='string'&&/^0x(?:[0-9a-f]{2})+$/i.test(code)?keccak(Buffer.from(code.slice(2),'hex')):null;
const SLOTS=Object.freeze({implementation:'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
 admin:'0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103'});
const SEL=Object.freeze({owner:'0x8da5cb5b',upgradeTo:'0x3659cfe6',upgradeToAndCall:'0x4f1ef286',mint:'0x40c10f19'});
// Deterministic unprivileged control address: keccak256("arcy-risk-control-v1")[12:]. No key exists for it.
const CONTROL='0x'+keccak(Buffer.from('arcy-risk-control-v1')).slice(-40);
const LIMITS=Object.freeze({callsPerEndpoint:18,timeoutMs:3000,deadlineMs:6000,maxBodyBytes:256*1024});
const ADDRESS=/^0x[0-9a-f]{40}$/,BLOCK_HEX=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i,WORD=/^0x[0-9a-f]{64}$/i,HASH=/^0x[0-9a-f]{64}$/i,QTY=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const ZERO='0x'+'0'.repeat(40);
const fail=code=>Object.assign(Error(code),{code});
const pad=a=>a.slice(2).padStart(64,'0');
const slotAddress=raw=>{if(!WORD.test(raw||''))throw fail('RPC_MALFORMED_RESPONSE');return /^0x0{24}/i.test(raw)?'0x'+raw.slice(-40).toLowerCase():null;};
const upgradeCalls=impl=>[{selector:'upgradeToAndCall',data:SEL.upgradeToAndCall+pad(impl)+(64).toString(16).padStart(64,'0')+'0'.repeat(64)},
 {selector:'upgradeTo',data:SEL.upgradeTo+pad(impl)}];
const mintCall=()=>({selector:'mint',data:SEL.mint+pad(CONTROL)+(1).toString(16).padStart(64,'0')});
// PUSH4 <selector> appears in the dispatcher of any Solidity/Vyper contract that implements the function.
const hasSelector=(code,selector)=>typeof code==='string'&&code.toLowerCase().includes('63'+selector.slice(2));
// A call "succeeds" only if it does not revert and does not return false.
const accepted=raw=>raw==='0x'||(typeof raw==='string'&&/^0x[0-9a-f]*$/i.test(raw)&&!(raw.length===66&&/^0x0{64}$/.test(raw)));

async function readEndpoint(e,{network,token,block,fetcher,deadlineAt,now,reviewed}){
 const cfg=chain(network),rpc=client({url:e.url,fetcher,deadlineAt,now,timeoutMs:LIMITS.timeoutMs,maxCalls:LIMITS.callsPerEndpoint,maxBodyBytes:LIMITS.maxBodyBytes});
 const started=now();let failure=null;
 const call=async(method,params)=>{try{return {ok:true,result:await rpc.call(method,params)};}
  catch(error){if(error.code==='CALL_REVERTED')return {ok:false,reverted:true};if(!failure)failure=error;return {ok:false,error:error.code||'RPC_FAILED'};}};
 const done=(state,extra={})=>({state,reasonCode:failure?.code||extra.reasonCode||null,failure,cost:{rpcCalls:rpc.cost.rpcCalls,ms:now()-started},...extra});
 const id=await call('eth_chainId',[]);
 if(!id.ok)return done('FAILED');
 if(!QTY.test(id.result||'')||Number(BigInt(id.result))!==cfg.chainId){failure=Object.assign(fail('RPC_WRONG_CHAIN'),{kind:'WRONG_CHAIN'});return done('FAILED');}
 const header=await call('eth_getBlockByNumber',[block,false]);
 if(!header.ok||!header.result||header.result.number?.toLowerCase()!==block||!HASH.test(header.result.hash||'')||!QTY.test(header.result.timestamp||'')){
  if(!failure)failure=Object.assign(fail('RPC_MALFORMED_RESPONSE'),{kind:'MALFORMED'});return done('FAILED');}
 const anchor={hash:header.result.hash.toLowerCase(),timestamp:Number(BigInt(header.result.timestamp))};
 const [implRaw,adminRaw,ownerRaw]=await Promise.all([call('eth_getStorageAt',[token,SLOTS.implementation,block]),call('eth_getStorageAt',[token,SLOTS.admin,block]),
  call('eth_call',[{to:token,data:SEL.owner},block])]);
 // A provider error on any read fails the endpoint; only a revert (e.g. no owner()) is a contract property.
 if(!implRaw.ok||!adminRaw.ok||ownerRaw.error)return done('FAILED');
 let implementation,admin,owner=null;
 try{implementation=slotAddress(implRaw.result);admin=slotAddress(adminRaw.result);if(ownerRaw.ok&&WORD.test(ownerRaw.result||'')&&/^0x0{24}/i.test(ownerRaw.result))owner='0x'+ownerRaw.result.slice(-40).toLowerCase();}
 catch{failure=Object.assign(fail('RPC_MALFORMED_RESPONSE'),{kind:'MALFORMED'});return done('FAILED');}
 const actors=[['eip1967-admin',admin],['owner',owner]].filter(([,a])=>a&&a!==ZERO&&a!==CONTROL);
 // The code that handles each call: the token/proxy itself for upgrade calls, the implementation for mint on a proxy.
 const tokenCode=await call('eth_getCode',[token,block]);
 if(tokenCode.error)return done('FAILED');
 const registry=reviewed[network]||{};
 const semantics=(hash,kind)=>hash&&registry[hash]&&registry[hash][kind]===true;
 const outcome={implementation:implementation&&implementation!==ZERO?implementation:null,upgrade:null,mint:null};
 // Upgrade: only meaningful for an EIP-1967 proxy; the target implementation is the CURRENT one, so even the
 // simulated call changes nothing.
 if(outcome.implementation){
  outcome.upgrade={state:'NOT_DEMONSTRATED',reasonCode:actors.length?'NO_PRIVILEGED_UPGRADE_CALL_ACCEPTED':'NO_PRIVILEGED_ACTOR'};
  search:for(const [role,actor] of actors)for(const c of upgradeCalls(outcome.implementation)){
   const r=await call('eth_call',[{from:actor,to:token,data:c.data},block]);
   if(r.error)return done('FAILED');
   if(r.ok&&accepted(r.result)){
    const control=await call('eth_call',[{from:CONTROL,to:token,data:c.data},block]);
    if(control.error)return done('FAILED');
    const hash=codeHash(tokenCode.result);
    // Accepted from the privileged actor and rejected from the control is an ACCESS observation only. It becomes a
    // capability only when the handling code is reviewed as really writing the implementation slot.
    outcome.upgrade=!control.reverted?{state:'NOT_DEMONSTRATED',reasonCode:'UNPRIVILEGED_CALL_ALSO_ACCEPTED'}:
     semantics(hash,'upgrade')?{state:'DEMONSTRATED',actorRole:role,actor,selector:c.selector,codeHash:hash}:
     {state:'NOT_DEMONSTRATED',reasonCode:'OPERATION_SEMANTICS_UNREVIEWED',actorRole:role,selector:c.selector,codeHash:hash};
    break search;
   }
  }
 }else outcome.upgrade={state:'NOT_APPLICABLE',reasonCode:'NO_EIP1967_IMPLEMENTATION'};
 // Mint: the selector must exist in the code that executes (implementation for a proxy).
 const code=outcome.implementation?await call('eth_getCode',[outcome.implementation,block]):tokenCode;
 if(code.error)return done('FAILED');
 if(!hasSelector(code.result,SEL.mint))outcome.mint={state:'NOT_APPLICABLE',reasonCode:'STANDARD_MINT_SELECTOR_ABSENT'};
 else{
  outcome.mint={state:'NOT_DEMONSTRATED',reasonCode:actors.length?'NO_PRIVILEGED_MINT_CALL_ACCEPTED':'NO_PRIVILEGED_ACTOR'};
  const c=mintCall();
  for(const [role,actor] of [...actors].reverse()){ // owner first: mint is usually owner/role-gated, not admin-gated
   const r=await call('eth_call',[{from:actor,to:token,data:c.data},block]);
   if(r.error)return done('FAILED');
   if(r.ok&&accepted(r.result)){
    const control=await call('eth_call',[{from:CONTROL,to:token,data:c.data},block]);
    if(control.error)return done('FAILED');
    const hash=codeHash(code.result);
    // A PUSH4 match and an accepted call do not prove that supply increases; the executing code must be reviewed.
    outcome.mint=!control.reverted?{state:'NOT_DEMONSTRATED',reasonCode:'UNPRIVILEGED_CALL_ALSO_ACCEPTED'}:
     semantics(hash,'mint')?{state:'DEMONSTRATED',actorRole:role,actor,selector:'mint',codeHash:hash}:
     {state:'NOT_DEMONSTRATED',reasonCode:'OPERATION_SEMANTICS_UNREVIEWED',actorRole:role,selector:'mint',codeHash:hash};
    break;
   }
  }
 }
 return done('OK',{anchor,outcome});
}

// ---- MetricEvidence records ---------------------------------------------------------------------------------
const RULE=Object.freeze({upgrade:{metricId:'risk.upgrade-authority',method:'reachable-upgrade-authority'},mint:{metricId:'risk.mint-authority',method:'reachable-mint-authority'}});
function signature(o){return JSON.stringify(o?{state:o.state,actorRole:o.actorRole||null,actor:o.actor||null,selector:o.selector||null,codeHash:o.codeHash||null}:null);}
function buildRecord(kind,{network,token,blockNumber,generatedAt,rows,independence}){
 const rule=RULE[kind],chainId=chain(network).chainId;
 const ok=rows.filter(r=>r.state==='OK'&&r.outcome?.[kind]);
 const base={schemaVersion:evidence.SCHEMA_VERSION,metricId:rule.metricId,network,token,scope:null,unit:'boolean',generatedAt,disagreement:null,engine:{...PRODUCER}};
 const empty=(state,reasonCode,observations=[],disagreement=null)=>({...base,value:null,observedAt:null,block:null,source:null,state,reasonCode,dataAgeMs:null,observations,disagreement});
 const obs=r=>{const demonstrated=r.outcome[kind].state==='DEMONSTRATED';return {source:{id:(network+'-rpc-'+r.operator).slice(0,64),class:'ONCHAIN_RPC',operator:r.operator},
  value:demonstrated,unit:'boolean',token,scope:null,observedAt:new Date(Math.min(r.anchor.timestamp*1000,Date.parse(generatedAt))).toISOString(),
  block:{number:blockNumber,hash:r.anchor.hash},chainId,
  // `false` here means "not demonstrated at this block", never an audit result.
  provenance:{method:demonstrated?rule.method:'privileged-path-not-demonstrated',reference:token}};};
 let record;
 if(!ok.length)record=empty(evidence.STATES.UNAVAILABLE,(rows.find(r=>r.reasonCode)?.reasonCode)||'NO_USABLE_OPERATOR_READ');
 else{
  const hashes=new Set(ok.map(r=>r.anchor.hash)),sigs=new Set(ok.map(r=>signature(r.outcome[kind])));
  const demonstrated=ok.filter(r=>r.outcome[kind].state==='DEMONSTRATED');
  if(ok.length>=2&&hashes.size>1)record=empty(evidence.STATES.CONFLICTING,'BLOCK_HASH_MISMATCH',ok.map(obs),{kind:'BLOCK_HASH_MISMATCH',sources:ok.map(r=>obs(r).source.id)});
  else if(ok.length>=2&&sigs.size>1){
   // Operators disagree about the same simulation at the same block: a conflict, never a chosen answer.
   record=demonstrated.length&&demonstrated.length<ok.length?
    empty(evidence.STATES.CONFLICTING,'AUTHORITY_OUTCOME_MISMATCH',ok.map(obs),{kind:'VALUE_MISMATCH',sources:ok.map(r=>obs(r).source.id)}):
    empty(evidence.STATES.NOT_VERIFIED,'AUTHORITY_PATH_MISMATCH');
  }
  else if(!demonstrated.length)record=empty(evidence.STATES.NOT_VERIFIED,ok[0].outcome[kind].reasonCode||'PRIVILEGED_PATH_NOT_DEMONSTRATED');
  else{
   const o=demonstrated.map(obs),first=o[0];
   const trusted=independence.independent&&demonstrated.length>=2&&new Set(o.map(x=>x.source.operator)).size>=2;
   record={...base,value:true,observedAt:first.observedAt,block:{...first.block},source:{...first.source},
    state:trusted?evidence.STATES.VERIFIED_ONCHAIN:evidence.STATES.SINGLE_SOURCE,
    reasonCode:trusted?'EXACT_ONCHAIN_AGREEMENT':independence.independent?'INDEPENDENT_OPERATOR_UNAVAILABLE':(independence.reasonCode||'NO_INDEPENDENT_OPERATOR'),
    dataAgeMs:Date.parse(generatedAt)-Date.parse(first.observedAt),observations:trusted?o:[first]};
  }
 }
 // Every record passes the strict contract or is replaced by an explicit NOT_VERIFIED.
 try{return evidence.parseMetricEvidence(record);}catch{return evidence.parseMetricEvidence(empty(evidence.STATES.NOT_VERIFIED,'EVIDENCE_CONTRACT_REJECTED'));}
}

async function produce({network,token,block,env=process.env,fetcher=fetch,now=Date.now,deadlineMs=LIMITS.deadlineMs,reviewedCode=REVIEWED_CODE}={}){
 const cfg=chain(network),address=String(token||'').toLowerCase();
 if(!ADDRESS.test(address)||address===ZERO)throw fail('RISK_PRODUCER_INVALID_TOKEN');
 if(!BLOCK_HEX.test(block||''))throw fail('RISK_PRODUCER_INVALID_BLOCK');
 const started=now(),deadlineAt=started+deadlineMs,blockHex=block.toLowerCase(),{endpoints,independence}=observer.endpoints(cfg.id,env);
 const rows=await Promise.all(endpoints.map(async e=>{
  const state=await loadHealth(cfg.id,e.providerId,env),gate=watchdog.eligibility(state,now());
  const base={role:e.role,operator:e.operator,operatorBasis:e.basis};
  if(gate.mode==='SKIP')return {...base,state:'SKIPPED',reasonCode:gate.reasonCode,cost:{rpcCalls:0,ms:0}};
  const r=await readEndpoint(e,{network:cfg.id,token:address,block:blockHex,fetcher,deadlineAt,now,reviewed:reviewedCode});
  const at=now();
  const health=r.failure?await saveHealth(cfg.id,e.providerId,{kind:r.failure.kind||'PROVIDER_ERROR',httpStatus:r.failure.httpStatus??null,retryAfterMs:r.failure.retryAfterMs||0,at},env):
   await saveHealth(cfg.id,e.providerId,{kind:'SUCCESS',reason:gate.mode==='PROBE'?'RECOVERY_PROBE_OK':'SUCCESS',latencyMs:Math.min(r.cost.ms,120000),at},env);
  const {failure,...rest}=r;return {...base,...rest,watchdogState:health.state};
 }));
 const generatedAt=new Date(now()).toISOString(),blockNumber=BigInt(blockHex).toString();
 const ctx={network:cfg.id,token:address,blockNumber,generatedAt,rows,independence};
 return {producer:{...PRODUCER},network:cfg.id,chainId:cfg.chainId,token:address,block:{hex:blockHex,number:blockNumber},independence,
  records:[buildRecord('upgrade',ctx),buildRecord('mint',ctx)],
  operators:rows.map(r=>({role:r.role,operator:r.operator,state:r.state,reasonCode:r.reasonCode||null,watchdogState:r.watchdogState||null,rpcCalls:r.cost.rpcCalls,ms:r.cost.ms,
   outcome:r.outcome?{implementation:r.outcome.implementation,upgrade:r.outcome.upgrade,mint:r.outcome.mint}:null})),
  cost:{rpcCalls:rows.reduce((n,r)=>n+r.cost.rpcCalls,0),ms:now()-started,deadlineMs}};
}
module.exports={PRODUCER,REVIEWED_CODE,produce,buildRecord,codeHash,CONTROL,SLOTS,SEL,LIMITS,hasSelector,accepted};
