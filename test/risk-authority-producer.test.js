'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const authority=require('../lib/risk-engine/producers/authority');
const reviewed=require('../lib/risk-engine/reviewed-code');
const shadow=require('../lib/risk-engine/shadow');
const {evaluateRisk}=require('../lib/risk-engine');
const evidence=require('../lib/verification/metric-evidence');
const ledger=require('../lib/verification/evidence-ledger');
const observer=require('../lib/verification/onchain-observer');

const NOW=Date.parse('2026-11-13T00:00:00.000Z');
const TOKEN='0x'+'ab'.repeat(20),IMPL='0x'+'ef'.repeat(20),IMPL2='0x'+'e2'.repeat(20),ADMIN='0x'+'ad'.repeat(20),OWNER='0x'+'0e'.repeat(20),BEACON='0x'+'be'.repeat(20);
const HASH='0x'+'11'.repeat(32),BLOCK='0x64',CONTROL=authority.CONTROL;
const CHAIN={ethereum:'0x1',arc:'0x13b2',robinhood:'0x1237'},CHAIN_ID={ethereum:1,arc:5042,robinhood:4663};
const word=a=>'0x'+a.slice(2).padStart(64,'0'),ZERO_WORD='0x'+'0'.repeat(64);
// The fake chain ACCEPTS privileged calldata and changes nothing: by itself it IS the adversarial no-op / fallback case.
const PROXY_CODE='0x6080604052363d3d3714',IMPL_CODE='0x60806040526340c10f1914',NOOP_CODE='0x60806040526340c10f195b00',INTERCEPT_PROXY='0x60806040526340c10f19335b00';
const h=authority.codeHash;
beforeEach(()=>{observer._resetHealth();shadow._reset();});

// A reviewed registry for fixtures, built through the SAME validation as the shipped one.
function entry(o){
 const e={id:o.id,network:o.network||'ethereum',capability:o.capability,architecture:o.architecture,selector:o.selector,actorRole:o.actorRole,
  proxyCodeHash:o.proxyCodeHash,implementationCodeHash:o.implementationCodeHash??null};
 const proof=codeHashValue=>({codeHash:codeHashValue,sourceMatch:'exact_match',verifiedRuntimeCodeHash:codeHashValue,
  onchain:[{operator:'allnodes',codeHash:codeHashValue,blockHash:HASH},{operator:'drpc',codeHash:codeHashValue,blockHash:HASH}],sources:[{path:'contracts/Fixture.sol',keccak256:HASH}]});
 e.artifact={schemaVersion:1,reviewId:e.id,network:e.network,chainId:CHAIN_ID[e.network],capability:e.capability,architecture:e.architecture,selector:e.selector,actorRole:e.actorRole,
  proxyCodeHash:e.proxyCodeHash,implementationCodeHash:e.implementationCodeHash,codeProofs:[e.proxyCodeHash,e.implementationCodeHash].filter(Boolean).map(proof),
  reviewedFunctions:[{name:o.selector,finding:'Fixture: the function writes the reviewed state for tests only.'}],conclusion:'Synthetic fixture entry used only by unit tests; it is not a real review.',...(o.artifact||{})};
 return e;
}
const UPGRADE=entry({id:'fixture-upgrade',capability:'upgrade',architecture:'eip1967-transparent-proxy',selector:'upgradeToAndCall',actorRole:'eip1967-admin',proxyCodeHash:h(PROXY_CODE)});
const MINT=entry({id:'fixture-mint',capability:'mint',architecture:'eip1967-delegated',selector:'mint',actorRole:'owner',proxyCodeHash:h(PROXY_CODE),implementationCodeHash:h(IMPL_CODE)});
const DIRECT_MINT=entry({id:'fixture-direct-mint',capability:'mint',architecture:'direct',selector:'mint',actorRole:'owner',proxyCodeHash:h(IMPL_CODE)});
const REGISTRY=reviewed.build([UPGRADE,MINT,DIRECT_MINT]);

function chainSim(over={},network='ethereum'){
 const calls=[];
 const base={chainId:CHAIN[network],hash:HASH,impl:IMPL,admin:ADMIN,owner:OWNER,beacon:null,canUpgrade:from=>from===ADMIN,canMint:from=>from===OWNER,
  mintReturns:'0x'+'0'.repeat(63)+'1',proxyCode:PROXY_CODE,implCode:IMPL_CODE,impl2Code:IMPL_CODE,...over};
 const fetcher=async(url,init)=>{
  const host=new URL(url).hostname,q=JSON.parse(init.body),b={...base,...(over.hosts?.[host]||{})};
  calls.push({host,method:q.method,params:q.params});
  if(b.http)return new Response('x',{status:b.http});
  const ok=result=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
  const revert=()=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:3,message:'execution reverted'}}));
  const err=()=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'internal'}}));
  if(q.method==='eth_chainId')return ok(b.chainId);
  if(q.method==='eth_getBlockByNumber'){const n=calls.filter(c=>c.host===host&&c.method==='eth_getBlockByNumber').length;
   return ok({number:q.params[0],hash:b.reorg&&n>1?'0x'+'99'.repeat(32):b.hash,timestamp:'0x'+Math.floor((NOW-60000)/1000).toString(16)});}
  if(q.method==='eth_getStorageAt'){const slot=q.params[1],v=slot===authority.SLOTS.implementation?b.impl:slot===authority.SLOTS.admin?b.admin:b.beacon;return ok(v?word(v):ZERO_WORD);}
  if(q.method==='eth_getCode'){const t=q.params[0];return ok(t===IMPL?b.implCode:t===IMPL2?b.impl2Code:b.proxyCode);}
  if(q.method==='eth_call'){
   const {from,to,data}=q.params[0];
   if(to!==TOKEN)return revert();
   if(data==='0x8da5cb5b')return b.ownerError?err():b.owner?ok(word(b.owner)):revert();
   if(data.startsWith('0x4f1ef286')||data.startsWith('0x3659cfe6'))return b.canUpgrade(from,data)?ok('0x'):revert();
   if(data.startsWith('0x40c10f19'))return b.canMint(from)?ok(b.mintReturns):revert();
   return revert();
  }
  return err();
 };
 return {fetcher,calls};
}
const produce=(sim,extra={})=>authority.produce({network:'ethereum',token:TOKEN,block:BLOCK,env:{},fetcher:sim.fetcher,now:()=>NOW,registry:REGISTRY,...extra});
const shipped=(sim,extra={})=>authority.produce({network:'ethereum',token:TOKEN,block:BLOCK,env:{},fetcher:sim.fetcher,now:()=>NOW,...extra});
const rec=(r,id)=>r.records.find(x=>x.metricId===id);
const finding=(records,ruleId,{network='ethereum',now=NOW}={})=>evaluateRisk({network,chainId:evidence.NETWORKS[network],token:TOKEN,scope:null,evidence:records,now}).findings.find(f=>f.ruleId===ruleId);
const never=r=>{for(const f of evaluateRisk({network:r.network,chainId:r.chainId,token:TOKEN,scope:null,evidence:r.records,now:NOW}).findings){assert.notEqual(f.status,'CONFIRMED',f.ruleId);assert.notEqual(f.status,'NOT_CONFIRMED',f.ruleId);}};

test('reviewed route + full two-operator identity agreement: the PUBLIC engine confirms upgrade and mint as HIGH',async()=>{
 const sim=chainSim(),r=await produce(sim);
 assert.equal(r.producer.version,3);
 for(const id of ['risk.upgrade-authority','risk.mint-authority']){
  const x=rec(r,id);assert.equal(x.state,'VERIFIED_ONCHAIN',id+' '+x.reasonCode);assert.equal(x.value,true);
  assert.doesNotThrow(()=>evidence.parseMetricEvidence(x));assert.deepEqual(x.block,{number:'100',hash:HASH});
  assert.deepEqual(new Set(x.observations.map(o=>o.source.operator)),new Set(['allnodes','drpc']));
 }
 const o=r.operators[0].outcome;
 assert.deepEqual({p:o.proxyCodeHash,i:o.implementation,ih:o.implementationCodeHash,a:o.admin,b:o.beacon},{p:h(PROXY_CODE),i:IMPL,ih:h(IMPL_CODE),a:ADMIN,b:null});
 assert.equal(o.upgrade.reviewId,'fixture-upgrade');assert.equal(o.mint.reviewId,'fixture-mint');assert.match(o.mint.calldataHash,/^0x[0-9a-f]{64}$/);
 for(const id of ['admin-upgrade-authority','privileged-minting']){const f=finding(r.records,id);assert.equal(f.status,'CONFIRMED',id+' '+f.reasonCode);assert.equal(f.severity,'HIGH');}
 assert.ok(sim.calls.every(c=>['eth_chainId','eth_getBlockByNumber','eth_getStorageAt','eth_getCode','eth_call'].includes(c.method)));
 assert.ok(sim.calls.some(c=>c.method==='eth_call'&&c.params[0].from===CONTROL));
 for(const op of r.operators)assert.ok(op.rpcCalls<=authority.LIMITS.callsPerEndpoint,String(op.rpcCalls));
 assert.ok(!JSON.stringify(r).includes('drpc.org')&&!JSON.stringify(r).includes('publicnode.com'));
 // Non-proxy token with a reviewed direct mint.
 const direct=await produce(chainSim({impl:null,admin:null,proxyCode:IMPL_CODE}));
 assert.equal(rec(direct,'risk.upgrade-authority').reasonCode,'NO_EIP1967_IMPLEMENTATION');assert.equal(finding(direct.records,'privileged-minting').status,'CONFIRMED');
});

test('the shipped registry reviews nothing: privileged no-op upgrade, owner-only fallback and no-op mint stay UNKNOWN',async()=>{
 assert.equal(reviewed.REGISTRY.entries.length,0);assert.ok(Object.isFrozen(reviewed.REGISTRY.entries));
 for(const r of [await shipped(chainSim()),await shipped(chainSim({implCode:NOOP_CODE})),await produce(chainSim({proxyCode:'0x60806040523373'+'ad'.repeat(20)+'145b00',implCode:NOOP_CODE}))]){
  for(const id of ['risk.upgrade-authority','risk.mint-authority']){const x=rec(r,id);assert.equal(x.state,'NOT_VERIFIED');assert.equal(x.reasonCode,'OPERATION_SEMANTICS_UNREVIEWED');assert.equal(x.value,null);}
  never(r);
  assert.equal(r.operators[0].outcome.upgrade.actorRole,'eip1967-admin'); // the access observation is kept for diagnostics
 }
});

test('proxy selector interception: a reviewed implementation behind an unreviewed proxy is not a mint route',async()=>{
 // Same reviewed implementation hash, but the proxy code is different (it could answer mint itself).
 const r=await produce(chainSim({proxyCode:INTERCEPT_PROXY}));
 assert.equal(rec(r,'risk.mint-authority').reasonCode,'OPERATION_SEMANTICS_UNREVIEWED');assert.equal(rec(r,'risk.upgrade-authority').reasonCode,'OPERATION_SEMANTICS_UNREVIEWED');never(r);
 // Reviewed proxy, different implementation code (upgraded since the review): mint is no longer a reviewed route.
 const upgraded=await produce(chainSim({implCode:NOOP_CODE}));
 assert.equal(rec(upgraded,'risk.mint-authority').reasonCode,'OPERATION_SEMANTICS_UNREVIEWED');assert.equal(finding(upgraded.records,'privileged-minting').status,'UNKNOWN');
 // A 'direct' review does not apply to the same code used as a proxy's own bytecode, and vice versa.
 const asProxy=await produce(chainSim({proxyCode:IMPL_CODE,implCode:NOOP_CODE}));
 assert.equal(rec(asProxy,'risk.mint-authority').reasonCode,'OPERATION_SEMANTICS_UNREVIEWED');
 // Mint accepted only from the proxy admin: a transparent proxy intercepts admin calls, so that is not a mint route.
 const adminMint=await produce(chainSim({owner:null,canMint:from=>from===ADMIN}));
 assert.equal(rec(adminMint,'risk.mint-authority').reasonCode,'OPERATION_SEMANTICS_UNREVIEWED');
 // Wrong selector for the reviewed upgrade route (review covers upgradeToAndCall only).
 const sel=await produce(chainSim({canUpgrade:(from,data)=>from===ADMIN&&data.startsWith('0x3659cfe6')}));
 assert.equal(rec(sel,'risk.upgrade-authority').reasonCode,'OPERATION_SEMANTICS_UNREVIEWED');
});

test('operators must agree on the whole execution identity, not just the outcome',async()=>{
 // Same block hash, actor, proxy bytecode and outcome — different implementation SLOT (both implementations reviewed-looking).
 const slots=await produce(chainSim({hosts:{'eth.drpc.org':{impl:IMPL2}}}));
 for(const id of ['risk.upgrade-authority','risk.mint-authority']){assert.equal(rec(slots,id).state,'NOT_VERIFIED',id);assert.equal(rec(slots,id).reasonCode,'EXECUTION_IDENTITY_MISMATCH');}
 never(slots);
 // Same implementation address, different implementation code (partial upgrade / inconsistent node).
 const code=await produce(chainSim({hosts:{'eth.drpc.org':{implCode:NOOP_CODE}}}));
 assert.notEqual(finding(code.records,'privileged-minting').status,'CONFIRMED');assert.notEqual(finding(code.records,'admin-upgrade-authority').status,'CONFIRMED');
 // Different admin on one operator.
 const admins=await produce(chainSim({hosts:{'eth.drpc.org':{admin:'0x'+'a2'.repeat(20),canUpgrade:from=>from==='0x'+'a2'.repeat(20)}}}));
 assert.equal(rec(admins,'risk.upgrade-authority').reasonCode,'EXECUTION_IDENTITY_MISMATCH');
 // Mint goes through the owner on both operators; only the proxy admin differs. The route identity still disagrees.
 assert.equal(rec(admins,'risk.mint-authority').reasonCode,'EXECUTION_IDENTITY_MISMATCH');
 // Same outcome (open to anyone) but different proxy bytecode: reported as an identity mismatch, not as agreement.
 const proxies=await produce(chainSim({canMint:()=>true,canUpgrade:()=>true,hosts:{'eth.drpc.org':{proxyCode:INTERCEPT_PROXY}}}));
 assert.equal(rec(proxies,'risk.mint-authority').reasonCode,'EXECUTION_IDENTITY_MISMATCH');never(proxies);
 // Authorization outcome differs: explicit conflict.
 const split=await produce(chainSim({hosts:{'eth.drpc.org':{canUpgrade:()=>false}}}));
 assert.equal(rec(split,'risk.upgrade-authority').state,'CONFLICTING');assert.equal(finding(split.records,'admin-upgrade-authority').status,'CONFLICTING');
 const fork=await produce(chainSim({hosts:{'eth.drpc.org':{hash:'0x'+'22'.repeat(32)}}}));
 assert.equal(rec(fork,'risk.mint-authority').reasonCode,'BLOCK_HASH_MISMATCH');assert.equal(finding(fork.records,'privileged-minting').status,'CONFLICTING');
 // The pinned block changed on one operator during the reads (reorg): that operator fails, so no two-operator proof.
 const reorg=await produce(chainSim({hosts:{'eth.drpc.org':{reorg:true}}}));
 assert.equal(reorg.operators[1].reasonCode,'PINNED_BLOCK_CHANGED');assert.equal(rec(reorg,'risk.mint-authority').state,'SINGLE_SOURCE');never(reorg);
});

test('beacon proxies, open functions, false returns and absent actors never confirm; absence is never safety',async()=>{
 const beacon=await produce(chainSim({beacon:BEACON}));
 for(const id of ['risk.upgrade-authority','risk.mint-authority'])assert.equal(rec(beacon,id).reasonCode,'BEACON_PROXY_UNSUPPORTED');
 const mismatch=await produce(chainSim({hosts:{'eth.drpc.org':{beacon:BEACON}}}));never(mismatch);
 const open=await produce(chainSim({canUpgrade:()=>true,canMint:()=>true}));
 for(const id of ['risk.upgrade-authority','risk.mint-authority'])assert.equal(rec(open,id).reasonCode,'UNPRIVILEGED_CALL_ALSO_ACCEPTED');
 assert.equal(rec(await produce(chainSim({mintReturns:ZERO_WORD})),'risk.mint-authority').reasonCode,'NO_PRIVILEGED_MINT_CALL_ACCEPTED');
 const noMint=await produce(chainSim({implCode:'0x60806040526000'}));
 assert.equal(rec(noMint,'risk.mint-authority').reasonCode,'STANDARD_MINT_SELECTOR_ABSENT');
 const renounced=await produce(chainSim({owner:null,admin:null}));
 for(const id of ['risk.upgrade-authority','risk.mint-authority'])assert.equal(rec(renounced,id).reasonCode,'NO_PRIVILEGED_ACTOR');
 // The transparent-proxy upgrade review does not depend on the implementation, so only the mint side is asserted for noMint.
 assert.equal(finding(noMint.records,'privileged-minting').status,'UNKNOWN');
 for(const r of [beacon,open,renounced])never(r);
});

test('wrong network, same-operator pseudo-independence, 429/503 and provider errors never produce a confirmation',async()=>{
 // Reviewed on Ethereum is not reviewed on Robinhood or Arc: the registry is per network.
 const rh=await authority.produce({network:'robinhood',token:TOKEN,block:BLOCK,env:{},fetcher:chainSim({},'robinhood').fetcher,now:()=>NOW,registry:REGISTRY});
 assert.equal(rec(rh,'risk.upgrade-authority').reasonCode,'OPERATION_SEMANTICS_UNREVIEWED');
 const wrongChain=await produce(chainSim({hosts:{'eth.drpc.org':{chainId:'0x89'}}}));
 assert.equal(wrongChain.operators[1].reasonCode,'RPC_WRONG_CHAIN');never(wrongChain);
 assert.notEqual(wrongChain.operators[1].watchdogState,'HEALTHY');observer._resetHealth();
 const arcRegistry=reviewed.build([entry({id:'fixture-arc-upgrade',network:'arc',capability:'upgrade',architecture:'eip1967-transparent-proxy',selector:'upgradeToAndCall',actorRole:'eip1967-admin',proxyCodeHash:h(PROXY_CODE)})]);
 const same=await authority.produce({network:'arc',token:TOKEN,block:BLOCK,env:{ARC_RPC_URL:'https://rpc.quicknode.mainnet.arc.io'},fetcher:chainSim({},'arc').fetcher,now:()=>NOW,registry:arcRegistry});
 assert.equal(same.independence.reasonCode,'SAME_OPERATOR');assert.equal(same.operators.length,1);assert.equal(rec(same,'risk.upgrade-authority').state,'SINGLE_SOURCE');
 assert.equal(finding(same.records,'admin-upgrade-authority',{network:'arc'}).reasonCode,'INDEPENDENT_ONCHAIN_PROOF_REQUIRED');
 const limited=chainSim({hosts:{'eth.drpc.org':{http:429}}}),first=await produce(limited);
 assert.equal(rec(first,'risk.mint-authority').state,'SINGLE_SOURCE');assert.equal(first.operators[1].watchdogState,'COOLDOWN');
 const before=limited.calls.length,second=await produce(limited);
 assert.equal(second.operators[1].state,'SKIPPED');assert.equal(limited.calls.slice(before).filter(c=>c.host==='eth.drpc.org').length,0);
 // Recovery: after the cooldown the provider is probed again and a healthy answer restores two-operator proof.
 const recovered=await produce(chainSim(),{now:()=>NOW+31*60*1000});assert.equal(recovered.operators[1].state,'OK');
 observer._resetHealth();
 const unavailable=await produce(chainSim({hosts:{'eth.drpc.org':{http:503}}}));assert.equal(unavailable.operators[1].state,'FAILED');never(unavailable);
 observer._resetHealth();
 const ownerDown=await produce(chainSim({hosts:{'ethereum-rpc.publicnode.com':{ownerError:true}}}));
 assert.equal(ownerDown.operators[0].state,'FAILED');assert.equal(rec(ownerDown,'risk.mint-authority').state,'SINGLE_SOURCE');
 await assert.rejects(authority.produce({network:'ethereum',token:'0x12',block:BLOCK,fetcher:chainSim().fetcher}),/RISK_PRODUCER_INVALID_TOKEN/);
 await assert.rejects(authority.produce({network:'ethereum',token:TOKEN,block:'latest',fetcher:chainSim().fetcher}),/RISK_PRODUCER_INVALID_BLOCK/);
});

test('registry is a real control: wrong capability, tampered, incomplete, non-exact or duplicate entries are dropped',()=>{
 const good=entry({id:'fixture-ok',capability:'upgrade',architecture:'eip1967-transparent-proxy',selector:'upgradeTo',actorRole:'eip1967-admin',proxyCodeHash:h(PROXY_CODE)});
 assert.equal(reviewed.build([good]).entries.length,1);
 const bad=(mutate,label)=>{const e=structuredClone(good);mutate(e);const r=reviewed.build([e]);assert.equal(r.entries.length,0,label);assert.equal(r.rejected,1,label);};
 bad(e=>{e.capability='mint';e.artifact.capability='mint';},'upgrade architecture cannot carry a mint capability');
 bad(e=>{e.actorRole='owner';e.artifact.actorRole='owner';},'transparent upgrade must be the admin');
 bad(e=>{for(const x of [e,e.artifact]){x.capability='mint';x.selector='mint';}},'a transparent-proxy review can never be a mint review');
 bad(e=>{e.artifact.codeProofs[0].sourceMatch='match';},'partial source match');
 bad(e=>{e.artifact.codeProofs[0].verifiedRuntimeCodeHash='0x'+'77'.repeat(32);},'verified bytecode is not the on-chain code');
 bad(e=>{e.artifact.codeProofs[0].onchain[1].operator='allnodes';},'one operator twice');
 bad(e=>{e.artifact.codeProofs[0].onchain[1].blockHash='0x'+'33'.repeat(32);},'operators at different blocks');
 bad(e=>{e.artifact.codeProofs=[];},'no code proof');
 bad(e=>{e.artifact.reviewedFunctions=[];},'no reviewed function');
 bad(e=>{e.artifact.chainId=4663;},'artifact for another chain');
 bad(e=>{e.proxyCodeHash='0x'+'55'.repeat(32);},'entry hash differs from its artifact');
 bad(e=>{e.artifact=null;},'missing artifact');
 bad(e=>{e.implementationCodeHash=h(IMPL_CODE);},'transparent upgrade entries carry no implementation hash');
 const mintNoImpl=entry({id:'fixture-bad-mint',capability:'mint',architecture:'eip1967-delegated',selector:'mint',actorRole:'owner',proxyCodeHash:h(PROXY_CODE)});
 assert.equal(reviewed.build([mintNoImpl]).entries.length,0,'delegated mint needs proxy AND implementation');
 // Two entries for one route are ambiguous: both dropped.
 assert.equal(reviewed.build([good,{...structuredClone(good),id:'fixture-dup',artifact:{...structuredClone(good.artifact),reviewId:'fixture-dup'}}]).entries.length,0);
 // A matching entry for the other capability on the same code does not help.
 const r=reviewed.build([good]);
 assert.equal(r.match({network:'ethereum',capability:'mint',isProxy:true,proxyCodeHash:h(PROXY_CODE),implementationCodeHash:h(IMPL_CODE),actorRole:'owner',selector:'mint'}),null);
 assert.equal(r.match({network:'arc',capability:'upgrade',isProxy:true,proxyCodeHash:h(PROXY_CODE),implementationCodeHash:null,actorRole:'eip1967-admin',selector:'upgradeTo'}),null);
});

test('gate: forged negatives, old producer versions, other engines, replayed and tampered records',async()=>{
 const r=await produce(chainSim()),good=rec(r,'risk.mint-authority');
 const forged=structuredClone(good);forged.value=false;for(const o of forged.observations){o.value=false;o.provenance.method='complete-mint-authority-audit';}
 assert.equal(finding([forged],'privileged-minting').reasonCode,'PRODUCER_NOT_REVIEWED');
 for(const version of [1,2]){const old=structuredClone(good);old.engine={id:'arcy-risk-authority-producer',version};assert.equal(finding([old],'privileged-minting').reasonCode,'PRODUCER_NOT_REVIEWED','v'+version);}
 const other=structuredClone(good);other.engine={id:'arcy-verification-runtime',version:9};assert.equal(finding([other],'privileged-minting').reasonCode,'PRODUCER_NOT_REVIEWED');
 // Replay: the same record an hour later is STALE; on another network it is not evidence at all.
 assert.equal(finding(r.records,'privileged-minting',{now:NOW+2*3600*1000}).status,'STALE');
 assert.equal(finding(r.records,'privileged-minting',{network:'arc'}).reasonCode,'EVIDENCE_MISSING');
 // Tampered: one observation's block hash or operator edited after the fact fails the contract.
 const t1=structuredClone(good);t1.observations[1].block.hash='0x'+'44'.repeat(32);assert.equal(finding([t1],'privileged-minting').reasonCode,'INVALID_MATCHING_EVIDENCE');
 const t2=structuredClone(good);t2.observations[1].source.operator=t2.observations[0].source.operator;assert.equal(finding([t2],'privileged-minting').reasonCode,'INVALID_MATCHING_EVIDENCE');
 // Conflicting positive evidence: two verified records with different values at one height.
 const flip=structuredClone(good);flip.value=false;for(const o of flip.observations)o.value=false;
 assert.equal(finding([good,flip],'privileged-minting').status,'CONFLICTING');
});

const report=(over={})=>({ok:true,network:'ethereum',chainId:1,address:TOKEN,block:BLOCK,cards:{supply:{fields:{totalSupply:{value:'1',dataState:'DATA_FOUND'}}}},...over});
test('shadow mode: OFF makes no request; ON never touches the report; shipped registry yields UNKNOWN',async()=>{
 const sim=chainSim(),r=report(),before=JSON.stringify(r);
 assert.equal(await shadow.runIfEnabled(r,{network:'ethereum',env:{},fetcher:sim.fetcher}),null);assert.equal(sim.calls.length,0);
 for(const v of ['0','true',''])assert.equal(shadow.enabled({ARC_AUTONOMY_RISK_ENGINE_ENABLED:v}),false);
 const lines=[],out=await shadow.runIfEnabled(r,{network:'ethereum',env:{ARC_AUTONOMY_RISK_ENGINE_ENABLED:'1'},fetcher:sim.fetcher,now:()=>NOW,log:l=>lines.push(l)});
 assert.equal(JSON.stringify(r),before);assert.equal(out.state,'COMPLETE');
 assert.ok(out.findings.every(f=>f.status==='UNKNOWN'));
 assert.equal(out.records.find(x=>x.metricId==='risk.mint-authority').reasonCode,'OPERATION_SEMANTICS_UNREVIEWED');
 assert.equal(out.ledger.history,'NOT_PRESERVED');assert.equal(lines.length,1);assert.ok(!/https?:\/\/|drpc\.org|publicnode/.test(lines[0]));
 const bad=await shadow.runIfEnabled({address:'nope'},{network:'ethereum',env:{ARC_AUTONOMY_RISK_ENGINE_ENABLED:'1'},log:()=>{}});
 assert.deepEqual(bad,{schemaVersion:1,mode:'SHADOW',state:'FAILED',reasonCode:'RISK_SHADOW_REPORT_INVALID'});
});

test('shadow ledger: durable records survive restart, reruns are throttled, concurrency is safe, a failing ledger is reported',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-risk-ledger-'));
 try{
  const env={ARC_AUTONOMY_RISK_ENGINE_ENABLED:'1',ARC_VERIFICATION_LEDGER_DIR:dir},sim=chainSim();
  const first=await shadow.run(report(),{network:'ethereum',env,fetcher:sim.fetcher,now:()=>NOW,log:()=>{}});
  assert.equal(first.ledger.state,'RECORDED');assert.equal(first.ledger.written,2);
  const again=await shadow.run(report(),{network:'ethereum',env,fetcher:sim.fetcher,now:()=>NOW+5000,log:()=>{}});assert.equal(again.ledger.throttled,2);
  shadow._reset();
  const id={metricId:'risk.mint-authority',network:'ethereum',token:TOKEN,scope:null},disk=await ledger.read(id,{env});
  assert.equal(disk.current.reasonCode,'OPERATION_SEMANTICS_UNREVIEWED');assert.equal(disk.lastTrusted,null);assert.ok(ledger.validRecord(disk,id));
  await Promise.all([1,2,3].map(i=>shadow.run(report(),{network:'ethereum',env,fetcher:chainSim().fetcher,now:()=>NOW+i*120000,log:()=>{}})));
  assert.ok(ledger.validRecord(await ledger.read(id,{env}),id));assert.ok(!(await fs.readdir(dir)).some(f=>f.endsWith('.tmp')||f.endsWith('.lock')));
  shadow._reset();
  const broken={directory:()=>dir,record:async()=>{throw Object.assign(Error('x'),{code:'EVIDENCE_LEDGER_WRITE_FAILED'});}};
  const failed=await shadow.run(report(),{network:'ethereum',env,fetcher:chainSim().fetcher,now:()=>NOW+10*120000,log:()=>{},ledger:broken});
  assert.deepEqual({s:failed.ledger.state,h:failed.ledger.history},{s:'FAILED',h:'NOT_PRESERVED'});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('the report builder runs shadow mode after the verification runtime and adds no response key',()=>{
 const text=require('node:fs').readFileSync(path.join(__dirname,'..','search','server','lib','multichain-service.js'),'utf8');
 const a=text.indexOf("lib/verification/runtime').annotateIfEnabled(result,{network})"),b=text.indexOf("lib/risk-engine/shadow').runIfEnabled(result,{network})");
 assert.ok(a>0&&b>a);assert.ok(!/result\.risk|result\.riskShadow/.test(text));
});
