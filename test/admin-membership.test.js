const {test}=require('node:test'), assert=require('node:assert/strict');
const c=require('../lib/core'), admin=require('../lib/admin-membership');
const address='0x'+'a'.repeat(40), member='0x'+'b'.repeat(40);
const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
function fixture(){
  const signatures=['DEFAULT_ADMIN_ROLE()','getRoleMemberCount(bytes32)','getRoleMember(bytes32,uint256)','hasRole(bytes32,address)'];
  const inputs=[[],['bytes32'],['bytes32','uint256'],['bytes32','address']],outputs=['bytes32','uint256','address','bool'];
  return {dataState:'DATA_FOUND',sourceDigest:'matched',abi:signatures.map((s,i)=>({type:'function',name:s.split('(')[0],stateMutability:'view',inputs:inputs[i].map(type=>({type})),outputs:[{type:outputs[i]}]})),signatures:{function:signatures.map((signature,i)=>({signature,signatureHash4:'0x'+String(i+1).padStart(8,'0')}))}};
}
test('enumerable admin requires positive membership at the same pinned block and preserves proof',async()=>{
  const old=c.call, calls=[];
  try {const replies=[word(0),word(2),'0x'+member.slice(2).padStart(64,'0'),word(1)];c.call=async(a,data,block)=>{calls.push({a,data,block});return replies.shift();};
    const r=await admin.inspect(address,fixture(),'0x123');assert.equal(r.value,member);assert.equal(r.evidence[0].reportedMemberCount,'2');assert.equal(r.evidence[0].sourceDigest,'matched');assert.match(r.scope,/One contract-reported/);assert.ok(calls.every(x=>x.a===address&&x.block==='0x123'));assert.equal(calls[3].data.slice(-64),member.slice(2).padStart(64,'0'));
  }finally{c.call=old;}
});
test('missing or mismatched verified ABI never makes role calls',async()=>{
  const old=c.call;try{c.call=async()=>{throw Error('must not call');};for(const modify of [s=>s.dataState='SOURCE_HAS_NO_DATA',s=>s.abi[3].outputs[0].type='uint256',s=>s.abi[2].inputs.pop(),s=>s.abi[0].stateMutability='nonpayable']){const s=fixture();modify(s);assert.equal(await admin.inspect(address,s,'0x1'),null);}}finally{c.call=old;}
});
test('generic contract analysis forwards the witnessed admin and its evidence',async()=>{
  const old=c.call;try{const replies=[word(0),word(2),'0x'+member.slice(2).padStart(64,'0'),word(1)];c.call=async(a,data)=>data.startsWith('0x00000004')&&data.slice(-64)===address.slice(2).padStart(64,'0')?word(0):replies.shift();
    const result=await require('../lib/generic-contract').inspect(address,fixture(),'0x123');assert.equal(result.roleState.enumerableAdmin.value,member);assert.equal(result.roleState.enumerableAdmin.evidence[0].block,'0x123');
  }finally{c.call=old;}
});
test('empty roles, malformed words, burn members, disagreement and provider failures remain unverified',async()=>{
  const old=c.call;try{for(const replies of [[word(1)],[word(0),word(0)],[word(0),word(1),word(0)],[word(0),word(1),'0x'+member.slice(2).padStart(64,'0'),word(0)],[word(0),word(1),'0x'+member.slice(2).padStart(64,'0'),word(2)],['0x00']]){c.call=async()=>replies.shift();assert.equal((await admin.inspect(address,fixture(),'0x1')).value,null);}c.call=async()=>{throw Object.assign(Error('provider unavailable'),{httpStatus:503});};const r=await admin.inspect(address,fixture(),'0x1');assert.equal(r.value,null);assert.ok(r.failure);}finally{c.call=old;}
});
