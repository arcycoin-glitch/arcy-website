const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveClonePath}=require('../search/server/lib/mechanics-v8-path');
const [address,target,next]=['1','2','3'].map(x=>'0x'+x.repeat(40));
const clone=a=>'0x363d3d373d3d3d363d73'+a.slice(2)+'5af43d82803e903d91602b57fd5bf3';
test('follows a nested immutable clone to deployed code',async()=>{
 assert.deepEqual(await resolveClonePath({address,target,targetCode:clone(next),deployed:async a=>a===next?'0x6000':null}),{addresses:[address,target,next],status:'NO_FURTHER_STANDARD_CLONE'});
});
test('does not claim a cyclic or missing target resolved',async()=>{
 for(const [candidate,status] of [[address,'CYCLE'],[next,'TARGET_CODE_UNAVAILABLE']]){
  assert.deepEqual(await resolveClonePath({address,target,targetCode:clone(candidate),deployed:async()=>null}),{addresses:[address,target],status,candidate});
 }
});
