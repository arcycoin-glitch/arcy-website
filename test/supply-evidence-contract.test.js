const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('unlock API reports absent locked and unlocked totals without inventing them',()=>{
 const code=fs.readFileSync(require.resolve('../api/unlock'),'utf8');
 for(const key of ['lockedSupply','unlockedSupply'])assert.match(code,new RegExp(key+':\\{value:null,status:\\x27NOT_VERIFIED\\x27'));
 assert.match(code,/COMPLETE_VESTING_COVERAGE_NOT_ESTABLISHED/);
 assert.match(code,/UNLOCKED_SUPPLY_NOT_ESTABLISHED/);
 assert.match(code,/verifiedBurned:burnResult/);
 assert.match(code,/safelyVerifiedSupplyBurned/);
});
