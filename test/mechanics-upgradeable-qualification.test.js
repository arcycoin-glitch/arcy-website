'use strict';
// Workstream B: an absence finding on the CURRENT implementation is never shown as a final "NONE ✓" behind an upgradeable proxy.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {qualifyUpgradeable}=require('../search/server/lib/mechanics-upgrade-caveat');
const fact=value=>({value,status:'VERIFIED_SOURCE',dataState:'DATA_FOUND',source:'x',evidence:[{scope:'s'}]});
const ADMIN='0x'+'ad'.repeat(20);
test('upgradeable EIP-1967 / legacy / beacon proxies qualify mint-absence and renounced-owner findings',()=>{
 for(const kind of ['EIP-1967 implementation','Legacy implementation slot','EIP-1967 beacon']){
  const f=qualifyUpgradeable({mintCapability:fact('NONE DETECTED ✓'),ownerAdmin:fact('Ownership renounced · owner 0x0'),tradingTaxes:fact('Transfer 0% · DEX/hook fees NOT VERIFIED')},kind,{admin:ADMIN});
  assert.equal(f.mintCapability.value,'No direct mint · upgradeable',kind);
  assert.equal(f.ownerAdmin.value,'Ownership renounced · upgradeable proxy');
  assert.equal(f.mintCapability.status,'VERIFIED_SOURCE','status unchanged: the current-implementation finding is still verified');
  const q=f.mintCapability.evidence.at(-1);assert.equal(q.originalValue,'NONE DETECTED ✓');assert.equal(q.upgradeAuthority,ADMIN);assert.match(q.upgradeCaveat,/current implementation only/);
  assert.equal(f.tradingTaxes.value,'Transfer 0% · DEX/hook fees NOT VERIFIED','other fields untouched');
 }
 assert.equal(qualifyUpgradeable({mintCapability:fact('NONE ACTIVE ✓ · owner renounced')},'EIP-1967 implementation').mintCapability.value,'No direct mint · upgradeable');
 assert.equal(qualifyUpgradeable({ownerAdmin:fact('No token owner/admin')},'EIP-1967 beacon').ownerAdmin.value,'No token owner/admin · upgradeable proxy');
});
test('non-proxy, EIP-1167 clones and reviewed immutable beacons are unchanged (known-good values preserved)',()=>{
 for(const kind of [null,'EIP-1167 minimal proxy','Reviewed immutable beacon proxy']){
  const f=qualifyUpgradeable({mintCapability:fact('NONE DETECTED ✓'),ownerAdmin:fact('No token owner/admin')},kind);
  assert.equal(f.mintCapability.value,'NONE DETECTED ✓');assert.equal(f.ownerAdmin.value,'No token owner/admin');
 }
});
test('positive capability findings and NOT_VERIFIED fields are never rewritten',()=>{
 const unknown={value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',evidence:[]};
 const f=qualifyUpgradeable({mintCapability:fact('Owner-authorized mint'),ownerAdmin:unknown},'EIP-1967 implementation');
 assert.equal(f.mintCapability.value,'Owner-authorized mint');assert.equal(f.ownerAdmin,unknown);
});
test('the qualified label is one the existing Mechanics presentation already renders',()=>{
 const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','search/server/lib/mechanics-reviewed-v4.js'),'utf8');
 assert.match(src,/No direct mint · upgradeable/);
});
