'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {formatTokenUnits}=require('../search/server/lib/mechanics-amount-format');
const deep=require('../search/server/lib/mechanics-deep');
const reviewed=require('../search/server/lib/mechanics-reviewed-tokens');
const keccak=require('../lib/keccak');
const selector=name=>keccak(Buffer.from(name)).slice(0,10);
const word=value=>'0x'+BigInt(value).toString(16).padStart(64,'0');
const address='0x'+'11'.repeat(20),authority='0x'+'22'.repeat(20),block='0x1234';
const addrWord=a=>'0x'+a.slice(2).padStart(64,'0');
const digestOf=name=>Object.entries(reviewed.PROFILES).find(([,v])=>v===name)?.[0];
function fixture(profile,calls){
 const digest=digestOf(profile),rpcCalls=[];
 return {rpcCalls,config:{network:'ethereum',address,block,sourceLoader:async()=>({digest,abi:[],runtimeMatch:'exact_match'}),
  rpc:async(method,params)=>{
   rpcCalls.push({method,params});assert.equal(params.at(-1),block);
   if(method==='eth_getCode')return '0x600160005500';
   if(method==='eth_getStorageAt')return word(0);
   if(method==='eth_call'){const v=calls[params[0].data.slice(0,10)];if(v===undefined)throw Object.assign(Error('execution reverted'),{code:3});return v;}
   throw Error('Unexpected RPC: '+method);
  }}};
}
test('Mechanics displays 256-bit amounts without Number precision loss or false zero',()=>{
 const e18=10n**18n;
 assert.equal(formatTokenUnits(1000n*e18,18),'1,000');
 assert.equal(formatTokenUnits(600n*e18,18),'600');
 assert.equal(formatTokenUnits(9007199254740993n*e18,18),'9,007,199,254,740,993');
 assert.equal(formatTokenUnits(100000000n*e18,18,3),'100,000,000');
 assert.equal(formatTokenUnits(1234n,3,2),'1.23');
 assert.equal(formatTokenUnits(1235n,3,2),'1.24');
 assert.equal(formatTokenUnits(1n,18,2),'<0.01');
 assert.equal(formatTokenUnits(1n,18,0),'<1');
 assert.equal(formatTokenUnits(0n,18),'0');
 assert.equal(formatTokenUnits(2n**256n-1n,18,2).startsWith('115,792,089,237'),true);
 assert.throws(()=>formatTokenUnits(-1n,18),RangeError);
 assert.throws(()=>formatTokenUnits(1n,37),RangeError);
});
test('CCIP mint cap/remaining show exact huge uint256 units, evidence stays raw and pinned',async()=>{
 const e18=10n**18n,cap=9007199254740993n*e18,remaining=1001n*e18;
 const c={
  [selector('MINTER_ROLE()')]:keccak(Buffer.from('MINTER_ROLE')),
  [selector('BURNER_ROLE()')]:keccak(Buffer.from('BURNER_ROLE')),
  [selector('maxSupply()')]:word(cap),
  [selector('totalSupply()')]:word(cap-remaining),
  [selector('decimals()')]:word(18),
  [selector('getCCIPAdmin()')]:addrWord(authority)
 };
 const x=fixture('CCIP_BURN_MINT_ROLE_TOKEN',c),r=await deep.inspect(x.config);
 assert.equal(r.fields.mintCapability.value,'Role-gated mint · cap 9,007,199,254,740,993 · 1,001 remaining');
 assert.equal(r.fields.mintCapability.evidence[0].maxSupplyRaw,cap.toString());
 assert.equal(r.fields.mintCapability.evidence[0].remainingRaw,remaining.toString());
 assert.equal(r.fields.mintCapability.evidence[0].mintAuthority.currentUsability,'NOT_VERIFIED');
 assert.equal(r.fields.mintCapability.dataState,'DATA_FOUND');
 const tiny=fixture('CCIP_BURN_MINT_ROLE_TOKEN',{...c,[selector('totalSupply()')]:word(cap-1n)});
 const t=await deep.inspect(tiny.config);
 assert.match(t.fields.mintCapability.value,/· <0\.01 remaining$/);
});
test('CVX scheduled mint never rounds a positive below-one-token remainder to zero',async()=>{
 const e18=10n**18n,cap=9007199254740993n*e18;
 const c={
  [selector('operator()')]:addrWord(authority),
  [selector('vecrvProxy()')]:addrWord('0x'+'33'.repeat(20)),
  [selector('maxSupply()')]:word(cap),
  [selector('totalSupply()')]:word(cap-1n)
 };
 const x=fixture('OPERATOR_SCHEDULED_CAPPED_MINT',c),r=await deep.inspect(x.config);
 assert.equal(r.fields.mintCapability.value,'Operator scheduled mint · cap 9,007,199,254,740,993 · <1 remaining');
 assert.equal(r.fields.mintCapability.evidence[0].mintAuthority.currentUsability,'NOT_VERIFIED');
 assert.equal(r.fields.mintCapability.evidence[0].mintAuthority.constraints.remainingRaw,'1');
});
