'use strict';
// Exact reviewed executed-runtime absence proof tests. This is not an ABI-only
// assertion, an owner()=zero assumption, or a claim about separate pool/bridge contracts.
const test=require('node:test'),assert=require('node:assert/strict');
const deep=require('../search/server/lib/mechanics-deep');
const reviewed=require('../search/server/lib/mechanics-reviewed-tokens');
const v4=require('../search/server/lib/mechanics-reviewed-v4');
const TOKEN='0x'+'11'.repeat(20),BLOCK='0x1234',CODE='0x600160005500';
const digestOf=name=>Object.entries(deep.PROFILES).find(([,v])=>v===name)?.[0];
const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const addressWord=a=>'0x'+a.slice(2).padStart(64,'0');
function fixture(profile,{network='ethereum',direct=true,runtimeMatch='match',template=null,calls={},digest=null}={}){
 const callsMade=[];
 const data={network,address:TOKEN,block:BLOCK,
  sourceLoader:async()=>({digest:digest||digestOf(profile)||'f'.repeat(64),abi:[],runtimeMatch,
   sourceAssurance:'EXACT_DEPLOYED_BYTECODE_MATCH',...(template?{template}:{})}),
  rpc:async(method,params)=>{
   callsMade.push({method,params});
   assert.equal(params.at(-1),BLOCK);
   if(method==='eth_getCode')return direct?CODE:'0x6000f4';
   if(method==='eth_getStorageAt')return word(0);
   if(method==='eth_call'){const v=calls[params[0].data.slice(0,10)];if(v!==undefined)return v;throw Object.assign(Error('execution reverted'),{code:3});}
   throw Error(method);
  }};
 return {data,callsMade};
}
test('full source + pinned direct runtime prove immutable no mint and no token admin',async()=>{
 for(const profile of ['FIXED_SUPPLY_LEGACY_ALLOCATION','FIXED_SUPPLY_OZ_BURNABLE','FIXED_SUPPLY_NO_ADMIN','UNISWAP_UERC20_FIXED_SUPPLY']){
  const f=fixture(profile),r=await deep.inspect(f.data);
  for(const [k,absenceProofClass] of [['mintCapability','REVIEWED_RUNTIME_NO_MINT_EXECUTION_PATH'],['ownerAdmin','REVIEWED_RUNTIME_NO_TOKEN_ADMIN_PATH']]){
   const field=r.fields[k];
   assert.equal(field.status,'VERIFIED_SOURCE_AND_STATE',profile+'/'+k);
   assert.equal(field.evidence[0].absenceProofClass,absenceProofClass,profile+'/'+k);
   assert.equal(field.evidence[0].directRuntime,true);
   assert.equal(field.evidence[0].sourceDigest,digestOf(profile));
  }
 }
});
test('full-source digest without direct execution proof does not gain immutable absence VERIFIED',async()=>{
 for(const match of ['UNREVIEWED','ABI_ONLY']){
  const f=fixture('FIXED_SUPPLY_OZ_BURNABLE',{runtimeMatch:match}),r=await deep.inspect(f.data);
  assert.equal(r.fields.mintCapability.status,'VERIFIED_SOURCE');
  assert.equal(r.fields.ownerAdmin.status,'VERIFIED_SOURCE');
  assert.equal(r.fields.mintCapability.evidence[0].absenceProofClass,undefined);
 }
 const unknown=fixture('FIXED_SUPPLY_OZ_BURNABLE',{direct:false});
 const r=await deep.inspect(unknown.data);
 assert.equal(r.fields.mintCapability,undefined);
 assert.equal(r.fields.ownerAdmin,undefined);
});
test('nonenumerable AccessControl role-gated mint is NOT converted into a no-mint absence',async()=>{
 const profile='CCIP_BURN_MINT_ROLE_TOKEN',f=fixture(profile);
 const result=await deep.inspect(f.data);
 assert.notEqual(result.fields.mintCapability?.value,'NONE DETECTED ✓');
});
test('SHA-pinned, direct OZ source without privileges confirms no mint and no token admin',async()=>{
 const t={libraries:['ERC20'],contract:'FixedToken',ownerOnlyFunctions:[],roleOnlyFunctions:[],
  ungatedFunctions:[],unprovenGates:[],ownable:false,accessControl:false,
  mint:'CONSTRUCTOR_ONLY',burnable:false,escalation:false,transferUnmodified:true};
 const f=fixture('OZ_ERC20_TEMPLATE',{template:t}),r=await deep.inspect(f.data);
 for(const k of ['mintCapability','ownerAdmin']){
  assert.equal(r.fields[k].status,'VERIFIED_SOURCE_AND_STATE',k);
  assert.equal(r.fields[k].evidence[0].directRuntime,true);
 }
 const degraded=await deep.inspect(fixture('OZ_ERC20_TEMPLATE',{template:t,runtimeMatch:'UNREVIEWED'}).data);
 for(const k of ['mintCapability','ownerAdmin'])assert.equal(degraded.fields[k].status,'VERIFIED_SOURCE');
});
test('both source-reviewed Pons launcher digests prove constructor-only mint for direct runtime',async()=>{
 const digests=Object.entries(v4.PROFILES).filter(([,p])=>p==='FIXED_LAUNCH_RESTRICTIONS').map(([d])=>d);
 assert.equal(digests.length,2);
 for(const digest of digests){
  const r=await deep.inspect(fixture('FIXED_LAUNCH_RESTRICTIONS',{network:'robinhood',digest}).data);
  assert.equal(r.fields.mintCapability.status,'VERIFIED_SOURCE_AND_STATE');
  assert.equal(r.fields.mintCapability.evidence[0].absenceProofClass,'REVIEWED_RUNTIME_NO_MINT_EXECUTION_PATH');
  assert.equal(r.fields.mintCapability.evidence[0].directRuntime,true);
 }
});
test('Arc fixed source no-mint is independent of whether a token-only tax proof can override a verified pool-hook tax',async()=>{
 const f=fixture('FIXED_SUPPLY_POOL_SETUP',{network:'arc'}),r=await deep.inspect(f.data);
 assert.equal(r.fields.mintCapability.status,'VERIFIED_SOURCE_AND_STATE');
 assert.equal(r.fields.mintCapability.evidence[0].absenceProofClass,'REVIEWED_RUNTIME_NO_MINT_EXECUTION_PATH');
});
