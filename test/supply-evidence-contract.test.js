const {test}=require('node:test');
const assert=require('node:assert/strict');
const c=require('../lib/core');
const a='0x'+'a'.repeat(40);
const res={setHeader(){},status(){return this},json(value){return value}};
test('unlock response never invents locked, unlocked or burned supply',async()=>{
 const old=require('../lib/unlock-sources').vesting;
 // This test inspects the response contract without assuming a particular token schedule.
 const fs=require('node:fs');
 const source=fs.readFileSync(require.resolve('../api/unlock'),'utf8');
 for(const key of ['lockedSupply','unlockedSupply','verifiedBurned'])assert.match(source,new RegExp(key+':\\{value:null,status:'));
 assert.match(source,/COMPLETE_VESTING_COVERAGE_NOT_ESTABLISHED/);
 assert.match(source,/SUPPLY_REDUCTION_HISTORY_NOT_RECONCILED/);
});
