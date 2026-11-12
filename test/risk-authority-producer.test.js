'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const authority=require('../lib/risk-engine/producers/authority');
const shadow=require('../lib/risk-engine/shadow');
const {evaluateRisk}=require('../lib/risk-engine');
const evidence=require('../lib/verification/metric-evidence');
const ledger=require('../lib/verification/evidence-ledger');
const observer=require('../lib/verification/onchain-observer');

const NOW=Date.parse('2026-11-13T00:00:00.000Z');
const TOKEN='0x'+'ab'.repeat(20),IMPL='0x'+'ef'.repeat(20),ADMIN='0x'+'ad'.repeat(20),OWNER='0x'+'0e'.repeat(20);
const HASH='0x'+'11'.repeat(32),BLOCK='0x64',CONTROL=authority.CONTROL;
const CHAIN={ethereum:'0x1',arc:'0x13b2',robinhood:'0x1237'};
const word=a=>'0x'+a.slice(2).padStart(64,'0'),ZERO_WORD='0x'+'0'.repeat(64);
// Runtime code of the fake proxy and implementation. The fake chain ACCEPTS the privileged calldata but changes
// nothing, so on its own it is exactly the adversarial case: an admin-only fallback / owner-only no-op.
const PROXY_CODE='0x6080604052'+'363d3d37'+'14',IMPL_CODE='0x6080604052'+'6340c10f19'+'14';
const NOOP_CODE='0x6080604052'+'6340c10f19'+'5b00'; // inert PUSH4 40c10f19, then STOP
// Reviewed registry used only by the tests that exercise the positive path.
const REVIEWED=Object.freeze({ethereum:{[authority.codeHash(PROXY_CODE)]:{upgrade:true,reference:'fixture'},[authority.codeHash(IMPL_CODE)]:{mint:true,reference:'fixture'}},
 arc:{[authority.codeHash(PROXY_CODE)]:{upgrade:true},[authority.codeHash(IMPL_CODE)]:{mint:true}},robinhood:{}});
beforeEach(()=>{observer._resetHealth();shadow._reset();});

// Fake chain. Defaults: an EIP-1967 proxy whose admin may upgrade, and whose implementation has an owner-gated mint.
function chainSim(over={},network='ethereum'){
 const calls=[];
 const base={chainId:CHAIN[network],hash:HASH,impl:IMPL,admin:ADMIN,owner:OWNER,mintSelector:true,
  canUpgrade:from=>from===ADMIN,canMint:from=>from===OWNER,mintReturns:'0x'+'0'.repeat(63)+'1',
  proxyCode:PROXY_CODE,implCode:over.mintSelector===false?'0x60806040526000':IMPL_CODE,...over};
 const fetcher=async(url,init)=>{
  const host=new URL(url).hostname,q=JSON.parse(init.body),b={...base,...(over.hosts?.[host]||{})};
  calls.push({host,method:q.method,params:q.params});
  if(b.http)return new Response('x',{status:b.http});
  const ok=result=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
  const revert=()=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:3,message:'execution reverted'}}));
  const err=()=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'internal'}}));
  if(q.method==='eth_chainId')return ok(b.chainId);
  if(q.method==='eth_getBlockByNumber')return ok({number:q.params[0],hash:b.hash,timestamp:'0x'+Math.floor((NOW-60000)/1000).toString(16)});
  if(q.method==='eth_getStorageAt'){const slot=q.params[1];return ok(slot===authority.SLOTS.implementation?(b.impl?word(b.impl):ZERO_WORD):b.admin?word(b.admin):ZERO_WORD);}
  if(q.method==='eth_getCode'){const target=q.params[0];return ok(target===IMPL?b.implCode:b.proxyCode);}
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
const produce=(sim,extra={})=>authority.produce({network:'ethereum',token:TOKEN,block:BLOCK,env:{},fetcher:sim.fetcher,now:()=>NOW,reviewedCode:REVIEWED,...extra});
const produceShipped=(sim,extra={})=>authority.produce({network:'ethereum',token:TOKEN,block:BLOCK,env:{},fetcher:sim.fetcher,now:()=>NOW,...extra});
const rec=(r,id)=>r.records.find(x=>x.metricId===id);
const finding=(records,ruleId,{network='ethereum',now=NOW}={})=>evaluateRisk({network,chainId:evidence.NETWORKS[network],token:TOKEN,scope:null,evidence:records,now}).findings.find(f=>f.ruleId===ruleId);

test('reviewed code semantics + two operators: the PUBLIC engine confirms admin upgrade and owner mint as HIGH',async()=>{
 const sim=chainSim(),r=await produce(sim);
 for(const id of ['risk.upgrade-authority','risk.mint-authority']){
  const x=rec(r,id);assert.equal(x.state,'VERIFIED_ONCHAIN',id+' '+x.reasonCode);assert.equal(x.value,true);
  assert.doesNotThrow(()=>evidence.parseMetricEvidence(x));assert.deepEqual(x.block,{number:'100',hash:HASH});
  assert.deepEqual(new Set(x.observations.map(o=>o.source.operator)),new Set(['allnodes','drpc']));assert.deepEqual(x.engine,authority.PRODUCER);
 }
 assert.equal(r.operators[0].outcome.upgrade.actorRole,'eip1967-admin');assert.equal(r.operators[0].outcome.mint.actorRole,'owner');
 for(const id of ['admin-upgrade-authority','privileged-minting']){const f=finding(r.records,id);assert.equal(f.status,'CONFIRMED',id+' '+f.reasonCode);assert.equal(f.severity,'HIGH');}
 // Every other rule stays UNKNOWN: this producer says nothing about them.
 const all=evaluateRisk({network:'ethereum',chainId:1,token:TOKEN,scope:null,evidence:r.records,now:NOW});
 assert.deepEqual(all.findings.filter(f=>!['admin-upgrade-authority','privileged-minting'].includes(f.ruleId)).map(f=>f.status),['UNKNOWN','UNKNOWN','UNKNOWN','UNKNOWN']);
 // Read-only, pinned, bounded: only simulations at the report block; the control address is part of every differential.
 assert.ok(sim.calls.every(c=>['eth_chainId','eth_getBlockByNumber','eth_getStorageAt','eth_getCode','eth_call'].includes(c.method)));
 for(const c of sim.calls.filter(c=>c.method!=='eth_chainId'))assert.equal(c.params.at(-1)===BLOCK||c.params[0]===BLOCK,true,c.method);
 assert.ok(sim.calls.some(c=>c.method==='eth_call'&&c.params[0].from===CONTROL));
 for(const op of r.operators)assert.ok(op.rpcCalls<=authority.LIMITS.callsPerEndpoint);
 assert.ok(!JSON.stringify(r).includes('drpc.org')&&!JSON.stringify(r).includes('publicnode.com'));
});

test('an open function (control also succeeds) is not authority, and a mint returning false is not a mint',async()=>{
 const open=await produce(chainSim({canUpgrade:()=>true,canMint:()=>true}));
 for(const id of ['risk.upgrade-authority','risk.mint-authority']){assert.equal(rec(open,id).state,'NOT_VERIFIED');assert.equal(rec(open,id).reasonCode,'UNPRIVILEGED_CALL_ALSO_ACCEPTED');}
 assert.equal(finding(open.records,'privileged-minting').status,'UNKNOWN');
 const falsy=await produce(chainSim({mintReturns:'0x'+'0'.repeat(64)}));
 assert.equal(rec(falsy,'risk.mint-authority').reasonCode,'NO_PRIVILEGED_MINT_CALL_ACCEPTED');
});

test('absence is never safety: non-proxy, missing selector, renounced owner all stay UNKNOWN, never NOT_CONFIRMED',async()=>{
 const plain=await produce(chainSim({impl:null,admin:null,proxyCode:IMPL_CODE}));
 assert.equal(rec(plain,'risk.upgrade-authority').reasonCode,'NO_EIP1967_IMPLEMENTATION');
 assert.equal(finding(plain.records,'admin-upgrade-authority').status,'UNKNOWN');
 // Owner mint still demonstrated on the non-proxy token.
 assert.equal(finding(plain.records,'privileged-minting').status,'CONFIRMED');
 const noMint=await produce(chainSim({mintSelector:false}));
 assert.equal(rec(noMint,'risk.mint-authority').reasonCode,'STANDARD_MINT_SELECTOR_ABSENT');
 assert.equal(finding(noMint.records,'privileged-minting').status,'UNKNOWN');
 const renounced=await produce(chainSim({owner:null,admin:null}));
 for(const id of ['risk.upgrade-authority','risk.mint-authority'])assert.equal(rec(renounced,id).reasonCode,'NO_PRIVILEGED_ACTOR');
 for(const r of [plain,noMint,renounced])for(const f of evaluateRisk({network:'ethereum',chainId:1,token:TOKEN,scope:null,evidence:r.records,now:NOW}).findings)
  assert.notEqual(f.status,'NOT_CONFIRMED',f.ruleId);
});

test('operators that disagree, or see different block hashes, give CONFLICTING; nothing is chosen',async()=>{
 const split=await produce(chainSim({hosts:{'eth.drpc.org':{canUpgrade:()=>false}}}));
 const x=rec(split,'risk.upgrade-authority');
 assert.equal(x.state,'CONFLICTING');assert.equal(x.reasonCode,'AUTHORITY_OUTCOME_MISMATCH');assert.deepEqual(x.observations.map(o=>o.value).sort(),[false,true]);
 assert.equal(finding(split.records,'admin-upgrade-authority').status,'CONFLICTING');
 const fork=await produce(chainSim({hosts:{'eth.drpc.org':{hash:'0x'+'22'.repeat(32)}}}));
 assert.equal(rec(fork,'risk.mint-authority').reasonCode,'BLOCK_HASH_MISMATCH');assert.equal(finding(fork.records,'privileged-minting').status,'CONFLICTING');
});

test('same-operator pseudo-independence, provider failures and cooldown never produce a confirmation',async()=>{
 const same=await authority.produce({network:'arc',token:TOKEN,block:BLOCK,env:{ARC_RPC_URL:'https://rpc.quicknode.mainnet.arc.io'},fetcher:chainSim({},'arc').fetcher,now:()=>NOW,reviewedCode:REVIEWED});
 assert.equal(same.independence.reasonCode,'SAME_OPERATOR');assert.equal(same.operators.length,1);
 assert.equal(rec(same,'risk.mint-authority').state,'SINGLE_SOURCE');
 assert.equal(finding(same.records,'privileged-minting',{network:'arc'}).reasonCode,'INDEPENDENT_ONCHAIN_PROOF_REQUIRED');
 const limited=chainSim({hosts:{'eth.drpc.org':{http:429}}}),first=await produce(limited);
 assert.equal(rec(first,'risk.mint-authority').state,'SINGLE_SOURCE');assert.equal(first.operators[1].watchdogState,'COOLDOWN');
 const before=limited.calls.length,second=await produce(limited);
 assert.equal(second.operators[1].state,'SKIPPED');assert.equal(limited.calls.slice(before).filter(c=>c.host==='eth.drpc.org').length,0);
 observer._resetHealth();
 // A provider error on owner() must fail that endpoint, not turn into "no privileged actor".
 const ownerDown=await produce(chainSim({hosts:{'ethereum-rpc.publicnode.com':{ownerError:true}}}));
 assert.equal(ownerDown.operators[0].state,'FAILED');assert.equal(rec(ownerDown,'risk.mint-authority').state,'SINGLE_SOURCE');
 observer._resetHealth();
 const wrong=await produce(chainSim({hosts:{'eth.drpc.org':{chainId:'0x89'}}}));
 assert.equal(wrong.operators[1].reasonCode,'RPC_WRONG_CHAIN');assert.notEqual(finding(wrong.records,'privileged-minting').status,'CONFIRMED');
 await assert.rejects(authority.produce({network:'ethereum',token:'0x12',block:BLOCK,fetcher:chainSim().fetcher}),/RISK_PRODUCER_INVALID_TOKEN/);
 await assert.rejects(authority.produce({network:'ethereum',token:TOKEN,block:'latest',fetcher:chainSim().fetcher}),/RISK_PRODUCER_INVALID_BLOCK/);
});

test('the review gate is positive-only: a forged false "complete audit" from this producer is never NOT_CONFIRMED',async()=>{
 const r=await produce(chainSim());
 assert.equal(r.producer.version,2);
 const forged=structuredClone(rec(r,'risk.mint-authority'));
 forged.value=false;for(const o of forged.observations){o.value=false;o.provenance.method='complete-mint-authority-audit';}
 assert.doesNotThrow(()=>evidence.parseMetricEvidence(forged));
 const f=finding([forged],'privileged-minting');
 assert.equal(f.status,'UNKNOWN');assert.equal(f.reasonCode,'PRODUCER_NOT_REVIEWED');
 // Another engine id with the same records is not reviewed either.
 const other=structuredClone(rec(r,'risk.mint-authority'));other.engine={id:'arcy-verification-runtime',version:1};
 assert.equal(finding([other],'privileged-minting').reasonCode,'PRODUCER_NOT_REVIEWED');
 // Older than the 1 h rule window: STALE.
 assert.equal(finding(r.records,'privileged-minting',{now:NOW+2*3600*1000}).status,'STALE');
 // Wrong chain: the records are Ethereum's and say nothing about the same address on Arc.
 assert.equal(finding(r.records,'privileged-minting',{network:'arc'}).reasonCode,'EVIDENCE_MISSING');
});

const report=(over={})=>({ok:true,network:'ethereum',chainId:1,address:TOKEN,block:BLOCK,cards:{supply:{fields:{totalSupply:{value:'1',dataState:'DATA_FOUND'}}}},...over});
test('shadow mode: OFF makes no request; ON never touches the report and logs one secret-free line',async()=>{
 const sim=chainSim(),r=report(),before=JSON.stringify(r);
 assert.equal(await shadow.runIfEnabled(r,{network:'ethereum',env:{},fetcher:sim.fetcher}),null);
 assert.equal(sim.calls.length,0);
 for(const v of ['0','true',''])assert.equal(shadow.enabled({ARC_AUTONOMY_RISK_ENGINE_ENABLED:v}),false);
 const lines=[],out=await shadow.runIfEnabled(r,{network:'ethereum',env:{ARC_AUTONOMY_RISK_ENGINE_ENABLED:'1'},fetcher:sim.fetcher,now:()=>NOW,log:l=>lines.push(l)});
 assert.equal(JSON.stringify(r),before,'the report is byte-identical');
 assert.equal(out.mode,'SHADOW');assert.equal(out.state,'COMPLETE');
 // Shadow mode uses the shipped registry, which reviews no code yet: an accepted privileged call is not a finding.
 assert.equal(out.findings.find(f=>f.ruleId==='privileged-minting').status,'UNKNOWN');
 assert.equal(out.records.find(x=>x.metricId==='risk.mint-authority').reasonCode,'OPERATION_SEMANTICS_UNREVIEWED');
 assert.equal(out.ledger.history,'NOT_PRESERVED');
 assert.equal(lines.length,1);const line=JSON.parse(lines[0]);
 assert.equal(line.event,'RISK_SHADOW');assert.equal(line.findings['admin-upgrade-authority'],'UNKNOWN/INDEPENDENT_ONCHAIN_PROOF_REQUIRED');
 assert.ok(!/https?:\/\/|drpc\.org|publicnode/.test(lines[0]));
 assert.deepEqual(shadow.latest('ethereum',TOKEN).findings,out.findings);
 const bad=await shadow.runIfEnabled({address:'nope'},{network:'ethereum',env:{ARC_AUTONOMY_RISK_ENGINE_ENABLED:'1'},log:()=>{}});
 assert.deepEqual(bad,{schemaVersion:1,mode:'SHADOW',state:'FAILED',reasonCode:'RISK_SHADOW_REPORT_INVALID'});
});

test('shadow mode with durable storage: records survive a restart, identical reruns are throttled, concurrency is safe',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-risk-ledger-'));
 try{
  const env={ARC_AUTONOMY_RISK_ENGINE_ENABLED:'1',ARC_VERIFICATION_LEDGER_DIR:dir},sim=chainSim();
  const first=await shadow.run(report(),{network:'ethereum',env,fetcher:sim.fetcher,now:()=>NOW,log:()=>{}});
  assert.equal(first.ledger.state,'RECORDED');assert.equal(first.ledger.written,2);
  const again=await shadow.run(report(),{network:'ethereum',env,fetcher:sim.fetcher,now:()=>NOW+5000,log:()=>{}});
  assert.equal(again.ledger.written,0);assert.equal(again.ledger.throttled,2);
  shadow._reset(); // restart: memory is gone, the ledger is not
  const id={metricId:'risk.mint-authority',network:'ethereum',token:TOKEN,scope:null},disk=await ledger.read(id,{env});
  assert.equal(disk.current.state,'NOT_VERIFIED');assert.equal(disk.current.reasonCode,'OPERATION_SEMANTICS_UNREVIEWED');assert.equal(disk.lastTrusted,null);assert.ok(ledger.validRecord(disk,id));
  // Concurrent shadow runs for the same token at different times serialise on the ledger.
  const runs=await Promise.all([1,2,3].map(i=>shadow.run(report(),{network:'ethereum',env,fetcher:chainSim().fetcher,now:()=>NOW+i*120000,log:()=>{}})));
  assert.ok(runs.every(r=>['RECORDED','PARTIAL','FAILED'].includes(r.ledger.state)));
  assert.ok(ledger.validRecord(await ledger.read(id,{env}),id));
  assert.ok(!(await fs.readdir(dir)).some(f=>f.endsWith('.tmp')||f.endsWith('.lock')));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('the report builder runs shadow mode after the verification runtime and does not add a response key',()=>{
 const text=require('node:fs').readFileSync(path.join(__dirname,'..','search','server','lib','multichain-service.js'),'utf8');
 const a=text.indexOf("lib/verification/runtime').annotateIfEnabled(result,{network})"),b=text.indexOf("lib/risk-engine/shadow').runIfEnabled(result,{network})");
 assert.ok(a>0&&b>a);
 assert.ok(!/result\.risk|result\.riskShadow|=await require\('\.\.\/\.\.\/\.\.\/lib\/risk-engine\/shadow'\)/.test(text));
});

test('adversarial: an admin-only fallback and an owner-only no-op mint (inert PUSH4) are never CONFIRMED',async()=>{
 // Same access pattern as a real upgrade/mint (privileged accepted, control reverts), but the code is unreviewed.
 const fallback=chainSim({proxyCode:'0x6080604052'+'3373'+'ad'.repeat(20)+'14'+'5b00',implCode:NOOP_CODE});
 for(const r of [await produce(fallback),await produceShipped(chainSim())]){
  for(const id of ['risk.upgrade-authority','risk.mint-authority']){
   const x=rec(r,id);assert.equal(x.state,'NOT_VERIFIED',id);assert.equal(x.reasonCode,'OPERATION_SEMANTICS_UNREVIEWED',id);assert.equal(x.value,null);
  }
  for(const f of evaluateRisk({network:'ethereum',chainId:1,token:TOKEN,scope:null,evidence:r.records,now:NOW}).findings){
   assert.notEqual(f.status,'CONFIRMED',f.ruleId);assert.notEqual(f.status,'NOT_CONFIRMED',f.ruleId);
  }
  // The access observation is kept for diagnostics, with the code hash that would need review.
  const o=r.operators[0].outcome;assert.equal(o.upgrade.actorRole,'eip1967-admin');assert.match(o.upgrade.codeHash,/^0x[0-9a-f]{64}$/);
  assert.equal(o.mint.actorRole,'owner');assert.match(o.mint.codeHash,/^0x[0-9a-f]{64}$/);
 }
 // A registry entry for the wrong capability, or for other code, does not help.
 const wrongKind={ethereum:{[authority.codeHash(PROXY_CODE)]:{mint:true},[authority.codeHash(IMPL_CODE)]:{upgrade:true}}};
 const crossed=await produce(chainSim(),{reviewedCode:wrongKind});
 for(const id of ['risk.upgrade-authority','risk.mint-authority'])assert.equal(rec(crossed,id).reasonCode,'OPERATION_SEMANTICS_UNREVIEWED');
 // Reviewed on Ethereum is not reviewed on Robinhood: the registry is per network.
 const rh=await authority.produce({network:'robinhood',token:TOKEN,block:BLOCK,env:{},fetcher:chainSim({},'robinhood').fetcher,now:()=>NOW,reviewedCode:REVIEWED});
 assert.equal(rec(rh,'risk.upgrade-authority').reasonCode,'OPERATION_SEMANTICS_UNREVIEWED');
 // The shipped registry is frozen and empty on every network; v1 records are no longer accepted by the gate.
 for(const n of ['arc','ethereum','robinhood']){assert.ok(Object.isFrozen(authority.REVIEWED_CODE[n]));assert.deepEqual(Object.keys(authority.REVIEWED_CODE[n]),[]);}
 const v1=structuredClone(rec(await produce(chainSim()),'risk.mint-authority'));v1.engine={id:'arcy-risk-authority-producer',version:1};
 assert.equal(finding([v1],'privileged-minting').reasonCode,'PRODUCER_NOT_REVIEWED');
});
