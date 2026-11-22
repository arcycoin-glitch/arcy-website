'use strict';
// Contract & Mechanics V6: reviewed-source profiles for EXECUTION_PATH_UNREVIEWED contracts (FoboToken, CCIP BurnMintERC20,
// YFI, ConvexToken, MiniMeToken, MakerDAO-style ward token, second PonsLauncherToken digest). Every value needs the exact
// source digest; absence claims need a direct runtime; state-derived values fail closed when a pinned getter is missing.
const test=require('node:test'),assert=require('node:assert/strict');
const deep=require('../search/server/lib/mechanics-deep');
const reviewed=require('../search/server/lib/mechanics-reviewed-tokens');
const v4=require('../search/server/lib/mechanics-reviewed-v4');
const keccak=require('../lib/keccak');
const sel=s=>keccak(Buffer.from(s)).slice(0,10);
const word=v=>'0x'+BigInt(v).toString(16).padStart(64,'0');
const addr=a=>'0x'+a.slice(2).toLowerCase().padStart(64,'0');
const block='0x1234',code='0x600160005500',TOKEN='0x1111111111111111111111111111111111111111';
const A='0x2222222222222222222222222222222222222222',B='0x3333333333333333333333333333333333333333';
const E18=10n**18n;
const digestOf=name=>Object.entries(deep.PROFILES).find(([,v])=>v===name)[0];
function fixture(digest,{calls={},runtime=code,network='ethereum'}={}){
 const log=[];
 const rpc=async(method,params)=>{
  log.push({method,params});assert.equal(params.at(-1),block,'every read is pinned');
  if(method==='eth_getCode')return runtime;
  if(method==='eth_getStorageAt')return word(0);
  if(method==='eth_call'){const v=calls[params[0].data.slice(0,10)];if(v===undefined)throw Object.assign(Error('execution reverted'),{code:3});return v;}
  throw Error('Unexpected '+method);
 };
 return {log,options:{network,address:TOKEN,block,rpc,sourceLoader:async()=>({digest,abi:[],runtimeMatch:'exact_match',url:'https://sourcify.dev/server/v2/contract/1/'+TOKEN,retrievedAt:'2026-11-22T09:00:00Z'})}};
}
async function inspect(x){let extra=null;const r=await deep.inspect({...x.options,onSupplementary:s=>{extra=s;}});return {...r,restriction:extra?.transferRestrictions||null};}
const calls=x=>x.log.filter(c=>c.method==='eth_call').map(c=>c.params[0].data.slice(0,10));
const V6=['FIXED_SUPPLY_OZ_BURNABLE','CCIP_BURN_MINT_ROLE_TOKEN','GOVERNANCE_MINTER_SET','OPERATOR_SCHEDULED_CAPPED_MINT','MINIME_CONTROLLED'];

test('V6 profiles are full-digest keyed, registered, and only read argument-free reviewed getters',()=>{
 for(const name of V6){const d=digestOf(name);assert.match(d,/^[0-9a-f]{64}$/);assert.equal(reviewed.PROFILES[d],name);}
 assert.equal(deep.PROFILES[digestOf('WARD_AUTH_TOKEN')],'WARD_AUTH_TOKEN');
 const pons=Object.entries(v4.PROFILES).filter(([,v])=>v==='FIXED_LAUNCH_RESTRICTIONS').map(([k])=>k);
 assert.ok(pons.includes('78a58d1192140e67892478e86766f47f697d05203b32bf4c042a4e05808c5825'));
 for(const g of ['MINTER_ROLE()','maxSupply()','governance()','operator()','controller()','transfersEnabled()','restrictionEndBlock()'])assert.ok(reviewed.REVIEWED_GETTERS.includes(g));
 assert.equal(reviewed.REVIEWED_BUDGET,8);
});
test('FOBO (OZ burnable fixed supply): transfer-only tax, no mint, no admin, no restrictions; zero reviewed reads',async()=>{
 const x=fixture(digestOf('FIXED_SUPPLY_OZ_BURNABLE'),{network:'robinhood'});const r=await inspect(x);
 assert.match(r.fields.tradingTaxes.value,/^Transfer 0% · DEX\/hook fees NOT VERIFIED/);
 assert.equal(r.fields.tradingTaxes.evidence[0].coverage,'TOKEN_TRANSFER_ONLY','transfer 0% is not a buy/sell claim');
 assert.equal(r.fields.mintCapability?.value,'NONE DETECTED ✓');
 assert.equal(r.fields.ownerAdmin.value,'No token owner/admin');
 assert.equal(r.restriction.value,'None in token code');
 assert.equal(calls(x).length,0);
});
test('CCIP BurnMintERC20: role-gated mint with cap remaining from pinned state; fail-closed on wrong role hash',async()=>{
 const base={[sel('MINTER_ROLE()')]:keccak(Buffer.from('MINTER_ROLE')),[sel('BURNER_ROLE()')]:keccak(Buffer.from('BURNER_ROLE')),
  [sel('maxSupply()')]:word(1000n*E18),[sel('totalSupply()')]:word(400n*E18),[sel('decimals()')]:word(18),[sel('getCCIPAdmin()')]:addr(A)};
 const r=await inspect(fixture(digestOf('CCIP_BURN_MINT_ROLE_TOKEN'),{network:'robinhood',calls:base}));
 assert.equal(r.fields.mintCapability?.value,'Role-gated mint · cap 1,000 · 600 remaining');
 assert.equal(r.fields.mintCapability.status,'VERIFIED_SOURCE_AND_STATE');
 assert.match(r.fields.mintCapability.evidence[0].scope,/not claimed/,'no executable-mint claim without role enumeration');
 assert.equal(r.fields.ownerAdmin.value,'AccessControl roles · CCIP admin '+A);
 assert.equal(r.restriction.value,'None in token code');
 const full=await inspect(fixture(digestOf('CCIP_BURN_MINT_ROLE_TOKEN'),{calls:{...base,[sel('totalSupply()')]:word(1000n*E18)}}));
 assert.equal(full.fields.mintCapability?.value,'Role-gated mint · cap reached (1,000)');
 const uncapped=await inspect(fixture(digestOf('CCIP_BURN_MINT_ROLE_TOKEN'),{calls:{...base,[sel('maxSupply()')]:word(0)}}));
 assert.equal(uncapped.fields.mintCapability?.value,'Role-gated mint · uncapped');
 const bad=await inspect(fixture(digestOf('CCIP_BURN_MINT_ROLE_TOKEN'),{calls:{...base,[sel('MINTER_ROLE()')]:word(1)}}));
 assert.notEqual(bad.fields.mintCapability?.dataState,'DATA_FOUND','role hash mismatch publishes no mint value');
});
test('YFI: governance-managed uncapped minters; missing governance() fails closed',async()=>{
 const r=await inspect(fixture(digestOf('GOVERNANCE_MINTER_SET'),{calls:{[sel('governance()')]:addr(A)}}));
 assert.equal(r.fields.mintCapability?.value,'Governance-managed minters · uncapped');
 assert.equal(r.fields.ownerAdmin.value,'Governance: '+A);
 const m=await inspect(fixture(digestOf('GOVERNANCE_MINTER_SET')));
 assert.notEqual(m.fields.mintCapability?.dataState,'DATA_FOUND');
 assert.match(m.fields.tradingTaxes.value,/^Transfer 0%/);
});
test('CVX: operator scheduled mint within cap; max reached; missing state fails closed',async()=>{
 const c={[sel('operator()')]:addr(A),[sel('vecrvProxy()')]:addr(B),[sel('maxSupply()')]:word(100000000n*E18),[sel('totalSupply()')]:word(99000000n*E18)};
 const r=await inspect(fixture(digestOf('OPERATOR_SCHEDULED_CAPPED_MINT'),{calls:c}));
 assert.equal(r.fields.mintCapability?.value,'Operator scheduled mint · cap 100,000,000 · 1,000,000 remaining');
 assert.equal(r.fields.ownerAdmin.value,'No token owner · operator '+A);
 const done=await inspect(fixture(digestOf('OPERATOR_SCHEDULED_CAPPED_MINT'),{calls:{...c,[sel('totalSupply()')]:word(100000000n*E18)}}));
 assert.equal(done.fields.mintCapability?.value,'Operator mint · max supply reached');
 const {[sel('vecrvProxy()')]:_,...noProxy}=c;
 const m=await inspect(fixture(digestOf('OPERATOR_SCHEDULED_CAPPED_MINT'),{calls:noProxy}));
 assert.notEqual(m.fields.mintCapability?.dataState,'DATA_FOUND');
});
test('LDO MiniMe: controller authority and pinned transfersEnabled drive the restriction value',async()=>{
 const r=await inspect(fixture(digestOf('MINIME_CONTROLLED'),{calls:{[sel('controller()')]:addr(A),[sel('transfersEnabled()')]:word(1)}}));
 assert.equal(r.fields.mintCapability?.value,'Controller mint (generateTokens)');
 assert.equal(r.fields.ownerAdmin.value,'Controller: '+A);
 assert.match(r.fields.ownerAdmin.evidence[0].scope,/without allowance/);
 assert.equal(r.restriction.value,'Controller-gated transfers · enabled');assert.equal(r.restriction.status,'VERIFIED_SOURCE_AND_STATE');
 const off=await inspect(fixture(digestOf('MINIME_CONTROLLED'),{calls:{[sel('controller()')]:addr(A),[sel('transfersEnabled()')]:word(0)}}));
 assert.equal(off.restriction.value,'Transfers DISABLED by controller');
});
test('absence and state claims require a direct runtime (delegating proxy publishes transfer-only at most)',async()=>{
 const proxy='0x363d3d373d3d3d363d73'+B.slice(2)+'5af43d82803e903d91602b57fd5bf3';
 for(const name of ['FIXED_SUPPLY_OZ_BURNABLE','GOVERNANCE_MINTER_SET']){
  const r=await inspect(fixture(digestOf(name),{runtime:proxy,calls:{[sel('governance()')]:addr(A)}}));
  assert.notEqual(r.fields.mintCapability?.value,'NONE DETECTED ✓');
  assert.notEqual(r.fields.mintCapability?.value,'Governance-managed minters · uncapped');
 }
});
test('a digest that differs by one nibble applies no V6 profile',async()=>{
 const d=digestOf('FIXED_SUPPLY_OZ_BURNABLE'),alt=(d[0]==='0'?'1':'0')+d.slice(1);
 const r=await inspect(fixture(alt,{network:'robinhood'}));
 assert.notEqual(r.fields.ownerAdmin?.value,'No token owner/admin');
 assert.notEqual(r.fields.mintCapability?.value,'NONE DETECTED ✓');
});
