'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const mechanics=require('../search/server/lib/mechanics-deep');
const reviewed=require('../search/server/lib/mechanics-reviewed-tokens');
const policy=require('../search/mechanics-policy');
const keccak=require('../lib/keccak');
const sel=s=>keccak(Buffer.from(s)).slice(0,10);
const word=v=>'0x'+BigInt(v).toString(16).padStart(64,'0');
const addr=a=>'0x'+a.slice(2).toLowerCase().padStart(64,'0');
const block='0x1234',code='0x600160005500',TOKEN='0x1111111111111111111111111111111111111111';
const digestOf=name=>Object.entries(reviewed.PROFILES).find(([,v])=>v===name)[0];
const OWNER='0x42f7c51be14cac4c7fe70dcbef7ceff62e130137',ROUTER='0x2222222222222222222222222222222222222222';
function fixture(digest,{calls={},slots={},runtime=code,abi=[]}={}){
 const log=[];
 const rpc=async(method,params)=>{
  log.push({method,params});assert.equal(params.at(-1),block,'every read is pinned');
  if(method==='eth_getCode')return runtime;
  if(method==='eth_getStorageAt'){const v=slots[Number(BigInt(params[1]))];return v===undefined?word(0):v;}
  if(method==='eth_call'){const v=calls[params[0].data.slice(0,10)];return v===undefined?word(0):v;}
  throw Error('Unexpected '+method);
 };
 return {log,options:{network:'ethereum',address:TOKEN,block,rpc,sourceLoader:async()=>({digest,abi,runtimeMatch:'exact_match',url:'https://sourcify.dev/server/v2/contract/1/'+TOKEN,retrievedAt:'2026-11-06T09:00:00Z'})}};
}
const fn=(name,inputs,out,mut='view')=>({type:'function',name,stateMutability:mut,inputs:inputs.map(type=>({type})),outputs:out?[{type:out}]:[]});
const ctx={chainId:1,network:'ethereum',address:TOKEN,block};
test('every reviewed token profile is keyed by a full 64-hex source digest and registered in mechanics-deep',()=>{
 assert.equal(Object.keys(reviewed.PROFILES).length,6);
 for(const [digest,name] of Object.entries(reviewed.PROFILES)){assert.match(digest,/^[0-9a-f]{64}$/);assert.equal(mechanics.PROFILES[digest],name);}
});
test('PEPE-style source: renounced owner freezes blacklist/rules; constructor-only mint; transfer-only tax claim',async()=>{
 const x=fixture(digestOf('OWNER_RULES_BLACKLIST_FIXED_SUPPLY'),{abi:[fn('owner',[],'address')],calls:{[sel('owner()')]:word(0)}});
 const r=await mechanics.inspect(x.options);
 assert.equal(r.fields.mintCapability.value,'NONE DETECTED ✓');
 assert.equal(r.fields.ownerAdmin.value,'Ownership renounced · blacklist and trading rules frozen');
 assert.equal(r.fields.ownerAdmin.status,'VERIFIED_SOURCE_AND_STATE');
 assert.match(r.fields.tradingTaxes.value,/DEX\/hook fees NOT VERIFIED/);
 assert.equal(x.log.filter(c=>c.method==='eth_getStorageAt'&&BigInt(c.params[1])<64n).length,0,'no extra storage reads');
 const pol=policy.assess({fields:r.fields},ctx);assert.deepEqual(pol.rows,[false,true,true,true]);
});
test('PEPE-style source with a live owner reports owner-governed blacklist instead of renouncement',async()=>{
 const x=fixture(digestOf('OWNER_RULES_BLACKLIST_FIXED_SUPPLY'),{abi:[fn('owner',[],'address')],calls:{[sel('owner()')]:addr(OWNER)}});
 const r=await mechanics.inspect(x.options);
 assert.equal(r.fields.ownerAdmin.value,'Owner-governed (blacklist, setRule) · '+OWNER);
});
const spxSlots=(over={})=>({6:word(BigInt('0x'+'ab'.repeat(20))<<8n),7:word(15),8:word(70),9:word(0),10:word(0),11:word(20),12:word(20),14:word(5000),...over});
test('SPX-style source: settled counter + renounced owner yields fixed 0% buy/sell/transfer from pinned storage',async()=>{
 const x=fixture(digestOf('LAUNCH_TAX_DECAY_FIXED_SUPPLY'),{abi:[fn('owner',[],'address')],calls:{[sel('owner()')]:word(0)},slots:spxSlots()});
 const r=await mechanics.inspect(x.options);
 assert.equal(r.fields.tradingTaxes.value,'Buy 0% · Sell 0% · Transfer 0%');
 assert.equal(r.fields.tradingTaxes.status,'VERIFIED_SOURCE_AND_STATE');
 assert.equal(r.fields.tradingTaxes.evidence[0].mutable,false);
 assert.match(r.fields.tradingTaxes.evidence[0].scope,/pool \(LP\) fees are separate/);
 assert.match(r.fields.ownerAdmin.value,/Ownership renounced/);
 assert.equal(r.fields.ownerAdmin.evidence[0].taxWallet,'0x'+'ab'.repeat(20));
 assert.equal(r.fields.mintCapability.value,'NONE DETECTED ✓');
 const reads=x.log.filter(c=>c.method==='eth_getStorageAt'&&BigInt(c.params[1])<64n);
 assert.equal(reads.length,Object.keys(reviewed.SPX_SLOTS).length);assert.ok(reads.length<=reviewed.REVIEWED_BUDGET);
 assert.deepEqual(policy.assess({fields:r.fields},ctx).rows,[true,true,true,true]);
});
test('SPX-style source during launch window reports the launch rates and mutability honestly',async()=>{
 const x=fixture(digestOf('LAUNCH_TAX_DECAY_FIXED_SUPPLY'),{abi:[fn('owner',[],'address')],calls:{[sel('owner()')]:addr(OWNER)},slots:spxSlots({11:word(69),12:word(420),14:word(100)})});
 const r=await mechanics.inspect(x.options);
 assert.equal(r.fields.tradingTaxes.value,'Buy 0% · Sell 70% · Transfer 0%');
 assert.equal(r.fields.tradingTaxes.evidence[0].mutable,true);
 assert.match(r.fields.ownerAdmin.value,/^Owner-governed/);
});
test('SPX-style storage that does not match the reviewed layout publishes no tax (fail closed)',async()=>{
 for(const bad of [{7:word(14)},{9:word(1)},{11:word(21)},{6:word(2)},{8:'0x'}]){
  const x=fixture(digestOf('LAUNCH_TAX_DECAY_FIXED_SUPPLY'),{abi:[fn('owner',[],'address')],calls:{[sel('owner()')]:word(0)},slots:spxSlots(bad)});
  const r=await mechanics.inspect(x.options);
  assert.equal(r.fields.tradingTaxes,undefined,'no tax on '+JSON.stringify(bad));assert.equal(r.fields.ownerAdmin,undefined);
 }
});
test('SUPER-style source: live owner can mint up to the cap; owner and cap come from the shared getter pass',async()=>{
 const abi=[fn('owner',[],'address'),fn('cap',[],'uint256')];
 const x=fixture(digestOf('OWNER_CAPPED_MINT_VOTES'),{abi,calls:{[sel('owner()')]:addr(OWNER),[sel('cap()')]:word(10n**27n)}});
 const r=await mechanics.inspect(x.options);
 assert.equal(r.fields.mintCapability.value,'Owner-authorized mint · capped');
 assert.equal(r.fields.mintCapability.evidence[0].capRaw,(10n**27n).toString());
 assert.equal(r.fields.ownerAdmin.value,'Owner-governed (mint) · '+OWNER);
 assert.equal(x.log.filter(c=>c.method==='eth_call'&&c.params[0].data===sel('owner()')).length,1,'owner() read once (cached)');
});
test('BEAM-style source: role counts reuse the bounded AccessControlEnumerable enumeration; burner power is disclosed',async()=>{
 const ADMIN='0x7e9e4c0876b2102f33a1d82117cc73b7fddd0032',MINTER_ROLE='0x'+keccak(Buffer.from('MINTER_ROLE')).slice(2);
 const abi=[fn('hasRole',['bytes32','address'],'bool'),fn('getRoleMemberCount',['bytes32'],'uint256'),fn('getRoleMember',['bytes32','uint256'],'address'),fn('MINTER_ROLE',[],'bytes32')];
 const calls={[sel('MINTER_ROLE()')]:MINTER_ROLE,[sel('hasRole(bytes32,address)')]:word(1)};
 const rpc0=fixture(digestOf('ROLE_MINTER_BURNER_VOTES'),{abi,calls});
 const base=rpc0.options.rpc;
 rpc0.options.rpc=async(method,params)=>{
  if(method==='eth_call'&&params[0].data.startsWith(sel('getRoleMemberCount(bytes32)')))return word(params[0].data.endsWith('0'.repeat(64))?1:0);
  if(method==='eth_call'&&params[0].data.startsWith(sel('getRoleMember(bytes32,uint256)')))return addr(ADMIN);
  return base(method,params);
 };
 const r=await mechanics.inspect(rpc0.options);
 assert.equal(r.fields.mintCapability.value,'No current minter · admin can grant MINTER_ROLE');
 assert.equal(r.fields.ownerAdmin.value,'Role-governed · DEFAULT_ADMIN_ROLE: '+ADMIN+' · burner can burn any wallet');
 assert.match(r.fields.ownerAdmin.evidence[0].scope,/ANY address without approval/);
 assert.equal(r.fields.ownerAdmin.status,'VERIFIED_SOURCE_AND_STATE');
});
test('MowCat-style source: fixed supply, no admin, transfer-only tax claim, zero extra reads',async()=>{
 const x=fixture(digestOf('FIXED_SUPPLY_NO_ADMIN'));
 const r=await mechanics.inspect(x.options);
 assert.equal(r.fields.mintCapability.value,'NONE DETECTED ✓');
 assert.equal(r.fields.ownerAdmin.value,'No token owner/admin');
 assert.equal(x.log.filter(c=>c.method==='eth_call').length,0);
});
test('Torch-style source: immutable pool buy tax read at the pinned block; anti-snipe window disclosed',async()=>{
 const calls=cur=>({[sel('BUY_TAX_BPS()')]:word(200),[sel('buyTaxBps()')]:word(cur),[sel('FEE_ROUTER()')]:addr(ROUTER)});
 let r=await mechanics.inspect(fixture(digestOf('IMMUTABLE_POOL_BUY_TAX'),{calls:calls(200)}).options);
 assert.equal(r.fields.tradingTaxes.value,'Buy 2% · Sell 0% · Transfer 0%');
 assert.equal(r.fields.tradingTaxes.evidence[0].feeRouter,ROUTER);
 assert.doesNotMatch(r.fields.tradingTaxes.evidence[0].scope,/anti-snipe/);
 r=await mechanics.inspect(fixture(digestOf('IMMUTABLE_POOL_BUY_TAX'),{calls:calls(5000)}).options);
 assert.equal(r.fields.tradingTaxes.value,'Buy 50% · Sell 0% · Transfer 0%');
 assert.match(r.fields.tradingTaxes.evidence[0].scope,/anti-snipe window/);
 for(const bad of [calls(100),{...calls(200),[sel('BUY_TAX_BPS()')]:word(0)},{...calls(9000)}]){
  r=await mechanics.inspect(fixture(digestOf('IMMUTABLE_POOL_BUY_TAX'),{calls:bad}).options);
  assert.equal(r.fields.tradingTaxes,undefined,'out-of-range rates publish nothing');
 }
 assert.equal(r.fields.ownerAdmin.value,'No token owner/admin · fixed fee router');
});
test('behind a delegating runtime only source-level transfer claims remain; unknown digests get nothing',async()=>{
 const delegating='0x363d3d373d3d3d363d73'+'33'.repeat(20)+'5af43d82803e903d91602b57fd5bf3';
 for(const name of Object.values(reviewed.PROFILES)){
  const r=await mechanics.inspect(fixture(digestOf(name),{runtime:delegating,abi:[fn('owner',[],'address')]}).options);
  assert.ok(!r.fields.mintCapability&&!r.fields.ownerAdmin,name+' absence/authority claims need a direct runtime');
  if(r.fields.tradingTaxes)assert.equal(r.fields.tradingTaxes.value,'Transfer 0% · DEX/hook fees NOT VERIFIED',name+' clone: only the source-level transfer claim may remain');
 }
 const r=await mechanics.inspect(fixture('b'.repeat(64)).options);
 assert.equal(r.fields.tradingTaxes,undefined);assert.equal(r.fields.mintCapability,undefined);
});
