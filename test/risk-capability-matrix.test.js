'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {MATRIX,NETWORKS,blockers}=require('../lib/risk-engine/capability-matrix');
const {RULES}=require('../lib/risk-engine/rules');
const {evaluateRisk}=require('../lib/risk-engine');
const shadow=require('../lib/risk-engine/shadow');
const authority=require('../lib/risk-engine/producers/authority');

test('matrix covers exactly the six rules on the three networks and never disagrees with the review gate',()=>{
 assert.deepEqual(Object.keys(MATRIX).sort(),RULES.map(r=>r.id).sort());assert.equal(RULES.length,6);assert.deepEqual([...NETWORKS],['arc','ethereum','robinhood']);
 for(const rule of RULES){
  const row=MATRIX[rule.id];assert.equal(row.metricId,rule.metricId);assert.deepEqual(Object.keys(row.networks),[...NETWORKS]);assert.ok(row.requires.length>=2&&row.note.length>40);
  if(rule.producers.length){
   // A producer exists: positive-only, and with an empty reviewed-code registry there is no route it can confirm.
   assert.equal(row.producer,rule.producers[0].id);assert.equal(row.minVersion,rule.producers[0].minVersion);assert.deepEqual([...rule.producers[0].values],[true]);assert.equal(row.polarity,'CONFIRM_ONLY');
   for(const n of NETWORKS)assert.deepEqual({...row.networks[n]},{state:'POSITIVE_ONLY',reviewedRoutes:0,reasonCode:'NO_REVIEWED_EXECUTION_ROUTE'});
  }else{
   assert.equal(row.producer,null);assert.equal(row.polarity,'NONE');
   for(const n of NETWORKS){assert.equal(row.networks[n].state,'BLOCKED');assert.match(row.networks[n].reasonCode,/^[A-Z_]{8,}$/);}
  }
 }
 assert.deepEqual(RULES.filter(r=>r.producers.length).map(r=>r.id).sort(),['admin-upgrade-authority','privileged-minting']);
 assert.equal(blockers('ethereum')['high-exit-impact'],'PRICE_ANCHOR_NOT_REVIEWED');assert.equal(blockers('arc')['top-ten-holder-concentration'],'HOLDER_CENSUS_SINGLE_OPERATOR');
 assert.equal(blockers('polygon'),null);assert.ok(Object.isFrozen(MATRIX)&&Object.isFrozen(MATRIX['sell-transfer-tax'].networks.arc));
});

test('high-exit-impact v2 uses a fixed USD probe: the old 1%-of-reserve method is no longer evidence',()=>{
 const rule=RULES.find(r=>r.id==='high-exit-impact');
 assert.equal(rule.version,2);assert.equal(rule.probeUsdCents,100000);assert.equal(rule.method(0),'pinned-fixed-usd-1000-exit-replay');assert.deepEqual([...rule.producers],[]);
 for(const r of RULES)if(r.id!=='high-exit-impact')assert.equal(r.version,1,r.id);
 assert.ok(!RULES.some(r=>/one-percent-reserve-exit/.test(r.method(1))));
});

test('with no evidence every rule is UNKNOWN on every network, and docs carry every blocker code',()=>{
 for(const network of NETWORKS){
  const chainId={arc:5042,ethereum:1,robinhood:4663}[network],r=evaluateRisk({network,chainId,token:'0x'+'ab'.repeat(20),scope:null,evidence:[],now:Date.now()});
  assert.equal(r.findings.length,6);assert.ok(r.findings.every(f=>f.status==='UNKNOWN'),network);
 }
 const doc=fs.readFileSync(path.join(__dirname,'..','docs','RISK_EVIDENCE_PRODUCERS.md'),'utf8');
 for(const row of Object.values(MATRIX))for(const n of NETWORKS)assert.ok(doc.includes(row.networks[n].reasonCode),row.networks[n].reasonCode);
});

test('shadow output names the real evidence gap for each UNKNOWN rule',async()=>{
 shadow._reset();
 const token='0x'+'ab'.repeat(20),records=[];
 const produce=async()=>({producer:authority.PRODUCER,block:{number:'100',hash:'0x'+'11'.repeat(32)},independence:{independent:true,reasonCode:null},operators:[],records,cost:{rpcCalls:0,ms:0}});
 const out=await shadow.run({address:token,block:'0x64',network:'robinhood'},{network:'robinhood',env:{},produce,now:()=>Date.parse('2026-11-13T00:00:00Z'),log:()=>{}});
 assert.equal(out.state,'COMPLETE');
 assert.deepEqual(out.evidenceGaps,{'admin-upgrade-authority':'NO_REVIEWED_EXECUTION_ROUTE','high-exit-impact':'PRICE_ANCHOR_NOT_REVIEWED','low-pool-liquidity':'RESERVE_VALUATION_NOT_REVIEWED',
  'privileged-minting':'NO_REVIEWED_EXECUTION_ROUTE','sell-transfer-tax':'TRANSFER_DEDUCTION_NOT_ISOLATED','top-ten-holder-concentration':'HOLDER_CENSUS_UNAVAILABLE'});
});
