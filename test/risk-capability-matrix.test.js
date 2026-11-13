'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {MATRIX,NETWORKS,blockers}=require('../lib/risk-engine/capability-matrix');
const {RULES}=require('../lib/risk-engine/rules');
const {evaluateRisk}=require('../lib/risk-engine');
const shadow=require('../lib/risk-engine/shadow');
const authority=require('../lib/risk-engine/producers/authority');

test('matrix covers exactly the six rules on the three networks and agrees with the review gate',()=>{
 assert.deepEqual(Object.keys(MATRIX).sort(),RULES.map(r=>r.id).sort());assert.equal(RULES.length,6);assert.deepEqual([...NETWORKS],['arc','ethereum','robinhood']);
 const states=Object.fromEntries(Object.entries(MATRIX).map(([id,row])=>[id,Object.fromEntries(NETWORKS.map(n=>[n,row.networks[n].state+(row.networks[n].reasonCode?'/'+row.networks[n].reasonCode:'')]))]));
 assert.deepEqual(states,{
  'admin-upgrade-authority':{arc:'CONFIRM_ONLY/NO_REVIEWED_EXECUTION_ROUTE',ethereum:'CONFIRM_ONLY',robinhood:'CONFIRM_ONLY/NO_REVIEWED_EXECUTION_ROUTE'},
  'privileged-minting':{arc:'CONFIRM_ONLY/NO_REVIEWED_EXECUTION_ROUTE',ethereum:'CONFIRM_ONLY',robinhood:'CONFIRM_ONLY/NO_REVIEWED_EXECUTION_ROUTE'},
  'high-exit-impact':{arc:'BLOCKED/PRICE_ANCHOR_NOT_REVIEWED',ethereum:'CONFIRM_ONLY',robinhood:'BLOCKED/PRICE_ANCHOR_NOT_REVIEWED'},
  'low-pool-liquidity':{arc:'BLOCKED/PRICE_ANCHOR_NOT_REVIEWED',ethereum:'MEASURED',robinhood:'BLOCKED/PRICE_ANCHOR_NOT_REVIEWED'},
  'sell-transfer-tax':{arc:'BLOCKED/TRANSFER_DEDUCTION_NOT_ISOLATED',ethereum:'BLOCKED/TRANSFER_DEDUCTION_NOT_ISOLATED',robinhood:'BLOCKED/TRANSFER_DEDUCTION_NOT_ISOLATED'},
  'top-ten-holder-concentration':{arc:'CONFIRM_ONLY',ethereum:'CONFIRM_ONLY',robinhood:'CONFIRM_ONLY'}});
 assert.equal(MATRIX['admin-upgrade-authority'].networks.ethereum.reviewedRoutes,4);assert.equal(MATRIX['privileged-minting'].networks.ethereum.reviewedRoutes,2);
 for(const rule of RULES){const row=MATRIX[rule.id];assert.equal(row.producer,rule.producers[0]?.id||null);assert.equal(row.ruleVersion,rule.version);assert.ok(row.requires.length>=2&&row.note.length>40);}
 // NOT_CONFIRMED is possible only for the measured pool liquidity.
 assert.deepEqual(Object.entries(MATRIX).filter(([,r])=>r.polarity==='MEASURED').map(([id])=>id),['low-pool-liquidity']);
 assert.equal(blockers('polygon'),null);assert.ok(Object.isFrozen(MATRIX)&&Object.isFrozen(MATRIX['sell-transfer-tax'].networks.arc));
});

test('high-exit-impact v2 uses a fixed USD probe: the old 1%-of-reserve method is no longer evidence',()=>{
 const rule=RULES.find(r=>r.id==='high-exit-impact');
 assert.equal(rule.version,2);assert.equal(rule.probeUsdCents,100000);assert.equal(rule.method(0),'pinned-fixed-usd-1000-exit-replay');
 assert.ok(!RULES.some(r=>/one-percent-reserve-exit/.test(r.method(1))));
 const conc=RULES.find(r=>r.id==='top-ten-holder-concentration');assert.equal(conc.version,2);assert.equal(conc.method(6000),'pinned-verified-top-ten-eoa-share');
});

test('with no evidence every rule is UNKNOWN on every network, and docs carry every blocker code',()=>{
 for(const network of NETWORKS){
  const chainId={arc:5042,ethereum:1,robinhood:4663}[network],r=evaluateRisk({network,chainId,token:'0x'+'ab'.repeat(20),scope:null,evidence:[],now:Date.now()});
  assert.equal(r.findings.length,6);assert.ok(r.findings.every(f=>f.status==='UNKNOWN'),network);
 }
 const doc=fs.readFileSync(path.join(__dirname,'..','docs','RISK_EVIDENCE_PRODUCERS.md'),'utf8');
 for(const row of Object.values(MATRIX))for(const n of NETWORKS)if(row.networks[n].reasonCode)assert.ok(doc.includes(row.networks[n].reasonCode),row.networks[n].reasonCode);
});

test('shadow output names the real evidence gap for each UNKNOWN rule',async()=>{
 shadow._reset();
 const token='0x'+'ab'.repeat(20);
 const empty=async()=>({producer:authority.PRODUCER,block:{number:'100',hash:'0x'+'11'.repeat(32)},independence:{independent:true,reasonCode:null},operators:[],records:[],cost:{rpcCalls:0,ms:0}});
 const out=await shadow.run({address:token,block:'0x64',network:'robinhood'},{network:'robinhood',env:{},producers:{authority:empty,pool:async()=>({records:[],pool:null,reasonCode:'PRICE_ANCHOR_NOT_REVIEWED',cost:{rpcCalls:0,ms:0}}),concentration:async()=>({records:[],reasonCode:'CANDIDATE_SOURCE_HTTP_503',cost:{rpcCalls:0,ms:0}})},now:()=>Date.parse('2026-11-13T00:00:00Z'),log:()=>{}});
 assert.equal(out.state,'COMPLETE');
 assert.deepEqual(out.evidenceGaps,{'admin-upgrade-authority':'NO_REVIEWED_EXECUTION_ROUTE','high-exit-impact':'PRICE_ANCHOR_NOT_REVIEWED','low-pool-liquidity':'PRICE_ANCHOR_NOT_REVIEWED',
  'privileged-minting':'NO_REVIEWED_EXECUTION_ROUTE','sell-transfer-tax':'TRANSFER_DEDUCTION_NOT_ISOLATED','top-ten-holder-concentration':'CANDIDATE_SOURCE_HTTP_503'});
});
