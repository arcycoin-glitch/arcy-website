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
// handles the call has a reviewed execution-route entry (lib/risk-engine/reviewed-code) stating that it performs the operation. Both
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

// v2: an ACCEPTED privileged call is access, not capability (no-op / privileged fallback look identical).
// v3 (second security review of #227):
//  * a positive record needs a reviewed entry for the exact EXECUTION ROUTE (lib/risk-engine/reviewed-code): network +
//    capability + proxy code hash + implementation code hash where the logic executes + actor role + selector. A
//    reviewed implementation is useless behind an unreviewed proxy that could intercept the selector;
//  * both operators must agree on the whole execution identity (proxy code hash, implementation ADDRESS and code
//    hash, admin, beacon, actor, selector, calldata, review id) at one block hash;
//  * beacon proxies are unsupported; the pinned block is re-checked after the reads.
// v4: role-based minting. AccessControlEnumerable MINTER_ROLE members are a distinct actor role ('minter-role'); the
//  recipient is part of the calldata identity; a delegated mint actor may never be the proxy admin (a transparent proxy
//  answers admin calls itself, so that call never reaches the reviewed implementation).
const PRODUCER=Object.freeze({id:'arcy-risk-authority-producer',version:4});
const reviewedCode=require('../reviewed-code');
const codeHash=code=>typeof code==='string'&&/^0x(?:[0-9a-f]{2})+$/i.test(code)?keccak(Buffer.from(code.slice(2),'hex')):null;
const SLOTS=Object.freeze({implementation:'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
 admin:'0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
 beacon:'0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'});
const SEL=Object.freeze({owner:'0x8da5cb5b',upgradeTo:'0x3659cfe6',upgradeToAndCall:'0x4f1ef286',mint:'0x40c10f19',getRoleMemberCount:'0xca15c873',getRoleMember:'0x9010d07c'});
const MINTER_ROLE='0x'+keccak(Buffer.from('MINTER_ROLE')).slice(2),MAX_ROLE_MEMBERS=3;
// Deterministic unprivileged control address: keccak256("arcy-risk-control-v1")[12:]. No key exists for it.
const CONTROL='0x'+keccak(Buffer.from('arcy-risk-control-v1')).slice(-40);
const LIMITS=Object.freeze({callsPerEndpoint:34,timeoutMs:3000,deadlineMs:6000,maxBodyBytes:256*1024});
const ADDRESS=/^0x[0-9a-f]{40}$/,BLOCK_HEX=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i,WORD=/^0x[0-9a-f]{64}$/i,HASH=/^0x[0-9a-f]{64}$/i,QTY=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const ZERO='0x'+'0'.repeat(40);
const fail=code=>Object.assign(Error(code),{code});
const pad=a=>a.slice(2).padStart(64,'0');
const slotAddress=raw=>{if(!WORD.test(raw||''))throw fail('RPC_MALFORMED_RESPONSE');return /^0x0{24}/i.test(raw)?'0x'+raw.slice(-40).toLowerCase():null;};
const upgradeCalls=impl=>[{selector:'upgradeToAndCall',data:SEL.upgradeToAndCall+pad(impl)+(64).toString(16).padStart(64,'0')+'0'.repeat(64)},
 {selector:'upgradeTo',data:SEL.upgradeTo+pad(impl)}];
const mintCall=(recipient=CONTROL)=>({selector:'mint',recipient,data:SEL.mint+pad(recipient)+(1).toString(16).padStart(64,'0')});
// PUSH4 <selector> appears in the dispatcher of any Solidity/Vyper contract that implements the function.
const hasSelector=(code,selector)=>typeof code==='string'&&code.toLowerCase().includes('63'+selector.slice(2));
// A call "succeeds" only if it does not revert and does not return false.
const accepted=raw=>raw==='0x'||(typeof raw==='string'&&/^0x[0-9a-f]*$/i.test(raw)&&!(raw.length===66&&/^0x0{64}$/.test(raw)));

async function readEndpoint(e,{network,token,block,fetcher,deadlineAt,now,registry}){
 const cfg=chain(network),rpc=client({url:e.url,fetcher,deadlineAt,now,timeoutMs:LIMITS.timeoutMs,maxCalls:LIMITS.callsPerEndpoint,maxBodyBytes:LIMITS.maxBodyBytes});
 const started=now();let failure=null;
 const call=async(method,params)=>{try{return {ok:true,result:await rpc.call(method,params)};}
  catch(error){if(error.code==='CALL_REVERTED')return {ok:false,reverted:true};if(!failure)failure=error;return {ok:false,error:error.code||'RPC_FAILED'};}};
 const done=(state,extra={})=>({state,reasonCode:failure?.code||extra.reasonCode||null,failure,cost:{rpcCalls:rpc.cost.rpcCalls,ms:now()-started},...extra});
 const malformed=()=>{if(!failure)failure=Object.assign(fail('RPC_MALFORMED_RESPONSE'),{kind:'MALFORMED'});return done('FAILED');};
 const id=await call('eth_chainId',[]);
 if(!id.ok)return done('FAILED');
 if(!QTY.test(id.result||'')||Number(BigInt(id.result))!==cfg.chainId){failure=Object.assign(fail('RPC_WRONG_CHAIN'),{kind:'WRONG_CHAIN'});return done('FAILED');}
 const readHeader=async()=>{const h=await call('eth_getBlockByNumber',[block,false]);
  return h.ok&&h.result&&h.result.number?.toLowerCase()===block&&HASH.test(h.result.hash||'')&&QTY.test(h.result.timestamp||'')?{hash:h.result.hash.toLowerCase(),timestamp:Number(BigInt(h.result.timestamp))}:null;};
 const anchor=await readHeader();
 if(!anchor)return malformed();
 const [implRaw,adminRaw,beaconRaw,ownerRaw,tokenCode]=await Promise.all([call('eth_getStorageAt',[token,SLOTS.implementation,block]),call('eth_getStorageAt',[token,SLOTS.admin,block]),
  call('eth_getStorageAt',[token,SLOTS.beacon,block]),call('eth_call',[{to:token,data:SEL.owner},block]),call('eth_getCode',[token,block])]);
 // A provider error on any read fails the endpoint; only a revert (e.g. no owner()) is a contract property.
 if(!implRaw.ok||!adminRaw.ok||!beaconRaw.ok||ownerRaw.error||!tokenCode.ok)return done('FAILED');
 let implementation,admin,beacon,owner=null;
 try{implementation=slotAddress(implRaw.result);admin=slotAddress(adminRaw.result);beacon=slotAddress(beaconRaw.result);
  if(ownerRaw.ok&&WORD.test(ownerRaw.result||'')&&/^0x0{24}/i.test(ownerRaw.result))owner='0x'+ownerRaw.result.slice(-40).toLowerCase();}
 catch{return malformed();}
 const set=a=>a&&a!==ZERO?a:null;
 implementation=set(implementation);admin=set(admin);beacon=set(beacon);
 const proxyCodeHash=codeHash(tokenCode.result);
 if(!proxyCodeHash)return malformed();
 // Execution identity shared by both capabilities. Every field is part of the two-operator agreement.
 const identity={proxyCodeHash,implementation,implementationCodeHash:null,admin,beacon};
 let implCode=null;
 if(implementation){
  const c=await call('eth_getCode',[implementation,block]);
  if(!c.ok)return done('FAILED');
  identity.implementationCodeHash=codeHash(c.result);implCode=c.result;
  if(!identity.implementationCodeHash)return malformed();      // an implementation slot pointing at no code is not a route
 }
 const actors=[['eip1967-admin',admin],['owner',owner]].filter(([,a])=>a&&a!==ZERO&&a!==CONTROL);
 // MINTER_ROLE members (AccessControlEnumerable). A revert means "not enumerable" (no role actors); a provider error
 // fails the endpoint. Bounded to the first MAX_ROLE_MEMBERS members in the contract's own set order.
 const minters=[];
 const count=await call('eth_call',[{to:token,data:SEL.getRoleMemberCount+MINTER_ROLE.slice(2)},block]);
 if(count.error)return done('FAILED');
 if(count.ok&&WORD.test(count.result||'')){
  const n=BigInt(count.result);
  for(let i=0n;i<n&&i<BigInt(MAX_ROLE_MEMBERS);i++){
   const m=await call('eth_call',[{to:token,data:SEL.getRoleMember+MINTER_ROLE.slice(2)+i.toString(16).padStart(64,'0')},block]);
   if(m.error)return done('FAILED');
   if(!m.ok||!WORD.test(m.result||'')||!/^0x0{24}/i.test(m.result))return malformed();
   const a='0x'+m.result.slice(-40).toLowerCase();if(a!==ZERO&&a!==CONTROL)minters.push(a);
  }
 }
 const outcome={...identity,upgrade:null,mint:null};
 const none=(state,reasonCode,extra={})=>({state,reasonCode,...extra});
 // The differential (privileged accepted, control reverts) is ACCESS evidence. A capability additionally needs a
 // reviewed entry for this exact route: network + capability + proxy code + (where it executes) implementation code
 // + actor role + selector.
 const decide=(capability,role,actor,c,controlReverted)=>{
  const access={actorRole:role,actor,selector:c.selector,recipient:c.recipient||null,calldataHash:keccak(Buffer.from(c.data.slice(2),'hex'))};
  if(!controlReverted)return none('NOT_DEMONSTRATED','UNPRIVILEGED_CALL_ALSO_ACCEPTED');
  // A transparent proxy intercepts every call from its admin: such a call is never a delegated mint.
  if(capability==='mint'&&implementation&&actor===admin)return none('NOT_DEMONSTRATED','OPERATION_SEMANTICS_UNREVIEWED',access);
  const review=registry.match({network,capability,isProxy:Boolean(implementation),proxyCodeHash,implementationCodeHash:identity.implementationCodeHash,actorRole:role,selector:c.selector});
  return review?{state:'DEMONSTRATED',...access,reviewId:review.id,architecture:review.architecture}:none('NOT_DEMONSTRATED','OPERATION_SEMANTICS_UNREVIEWED',access);
 };
 // A beacon proxy resolves its implementation through another contract; that route is not reviewed.
 if(beacon){outcome.upgrade=none('NOT_APPLICABLE','BEACON_PROXY_UNSUPPORTED');outcome.mint=none('NOT_APPLICABLE','BEACON_PROXY_UNSUPPORTED');}
 else{
  if(implementation){
   outcome.upgrade=none('NOT_DEMONSTRATED',actors.length?'NO_PRIVILEGED_UPGRADE_CALL_ACCEPTED':'NO_PRIVILEGED_ACTOR');
   search:for(const [role,actor] of actors)for(const c of upgradeCalls(implementation)){
    const r=await call('eth_call',[{from:actor,to:token,data:c.data},block]);
    if(r.error)return done('FAILED');
    if(r.ok&&accepted(r.result)){
     const control=await call('eth_call',[{from:CONTROL,to:token,data:c.data},block]);
     if(control.error)return done('FAILED');
     outcome.upgrade=decide('upgrade',role,actor,c,Boolean(control.reverted));
     break search;
    }
   }
  }else outcome.upgrade=none('NOT_APPLICABLE','NO_EIP1967_IMPLEMENTATION');
  // Mint. The selector must at least exist in the code that would execute it; that is a cheap pre-filter only.
  if(!hasSelector(implementation?implCode:tokenCode.result,SEL.mint))outcome.mint=none('NOT_APPLICABLE','STANDARD_MINT_SELECTOR_ABSENT');
  else{
   outcome.mint=none('NOT_DEMONSTRATED','NO_PRIVILEGED_ACTOR');
   // Actors: owner, then MINTER_ROLE members, then the proxy admin (kept only so its acceptance is reported, never
   // reviewed for a delegated route). Recipients: the control address, then the actor itself (allowlist / KYC tokens
   // only accept registered recipients). The first accepted call decides; the same calldata is replayed from CONTROL.
   const mintActors=[...actors.filter(([r])=>r==='owner'),...minters.map(m=>['minter-role',m]),...actors.filter(([r])=>r==='eip1967-admin')];
   if(mintActors.length)outcome.mint=none('NOT_DEMONSTRATED','NO_PRIVILEGED_MINT_CALL_ACCEPTED');
   mint:for(const [role,actor] of mintActors)for(const recipient of [CONTROL,actor]){
    const c=mintCall(recipient);
    const r=await call('eth_call',[{from:actor,to:token,data:c.data},block]);
    if(r.error)return done('FAILED');
    if(r.ok&&accepted(r.result)){
     const control=await call('eth_call',[{from:CONTROL,to:token,data:c.data},block]);
     if(control.error)return done('FAILED');
     outcome.mint=decide('mint',role,actor,c,Boolean(control.reverted));
     break mint;
    }
   }
  }
 }
 // The pinned block must still be canonical on this operator after all reads.
 const after=await readHeader();
 if(!after)return failure?done('FAILED'):malformed();
 if(after.hash!==anchor.hash){failure=Object.assign(fail('PINNED_BLOCK_CHANGED'),{kind:'PROVIDER_ERROR'});return done('FAILED');}
 return done('OK',{anchor,outcome});
}

// ---- MetricEvidence records ---------------------------------------------------------------------------------
const RULE=Object.freeze({upgrade:{metricId:'risk.upgrade-authority',method:'reachable-upgrade-authority'},mint:{metricId:'risk.mint-authority',method:'reachable-mint-authority'}});
// Everything two operators must agree on. `o` is the endpoint outcome, `kind` the capability.
function signature(o,kind){
 const k=o?.[kind];
 return JSON.stringify(k?{state:k.state,reasonCode:k.state==='DEMONSTRATED'?null:k.reasonCode||null,actorRole:k.actorRole||null,actor:k.actor||null,selector:k.selector||null,recipient:k.recipient||null,
  calldataHash:k.calldataHash||null,reviewId:k.reviewId||null,proxyCodeHash:o.proxyCodeHash,implementation:o.implementation,implementationCodeHash:o.implementationCodeHash,
  admin:o.admin,beacon:o.beacon}:null);
}
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
  const hashes=new Set(ok.map(r=>r.anchor.hash)),sigs=new Set(ok.map(r=>signature(r.outcome,kind)));
  const demonstrated=ok.filter(r=>r.outcome[kind].state==='DEMONSTRATED');
  if(ok.length>=2&&hashes.size>1)record=empty(evidence.STATES.CONFLICTING,'BLOCK_HASH_MISMATCH',ok.map(obs),{kind:'BLOCK_HASH_MISMATCH',sources:ok.map(r=>obs(r).source.id)});
  else if(ok.length>=2&&sigs.size>1){
   // Operators disagree about the same simulation at the same block: a conflict, never a chosen answer.
   // (Same boolean on both sides but a different implementation, code hash, actor or calldata is still a mismatch:
   // the contract schema can only express a value conflict, so that case is NOT_VERIFIED with its own reason.)
   record=demonstrated.length&&demonstrated.length<ok.length?
    empty(evidence.STATES.CONFLICTING,'AUTHORITY_OUTCOME_MISMATCH',ok.map(obs),{kind:'VALUE_MISMATCH',sources:ok.map(r=>obs(r).source.id)}):
    empty(evidence.STATES.NOT_VERIFIED,'EXECUTION_IDENTITY_MISMATCH');
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

async function produce({network,token,block,env=process.env,fetcher=fetch,now=Date.now,deadlineMs=LIMITS.deadlineMs,registry=reviewedCode.REGISTRY}={}){
 const cfg=chain(network),address=String(token||'').toLowerCase();
 if(!ADDRESS.test(address)||address===ZERO)throw fail('RISK_PRODUCER_INVALID_TOKEN');
 if(!BLOCK_HEX.test(block||''))throw fail('RISK_PRODUCER_INVALID_BLOCK');
 const started=now(),deadlineAt=started+deadlineMs,blockHex=block.toLowerCase(),{endpoints,independence}=observer.endpoints(cfg.id,env);
 const rows=await Promise.all(endpoints.map(async e=>{
  const state=await loadHealth(cfg.id,e.providerId,env),gate=watchdog.eligibility(state,now());
  const base={role:e.role,operator:e.operator,operatorBasis:e.basis};
  if(gate.mode==='SKIP')return {...base,state:'SKIPPED',reasonCode:gate.reasonCode,cost:{rpcCalls:0,ms:0}};
  const r=await readEndpoint(e,{network:cfg.id,token:address,block:blockHex,fetcher,deadlineAt,now,registry});
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
   outcome:r.outcome||null})),
  cost:{rpcCalls:rows.reduce((n,r)=>n+r.cost.rpcCalls,0),ms:now()-started,deadlineMs}};
}
module.exports={PRODUCER,produce,buildRecord,codeHash,CONTROL,SLOTS,SEL,LIMITS,hasSelector,accepted};
