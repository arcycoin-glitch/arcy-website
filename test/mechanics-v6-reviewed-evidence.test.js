'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const deep=require('../search/server/lib/mechanics-deep'),reviewed=require('../search/server/lib/mechanics-reviewed-tokens');
const keccak=require('../lib/keccak');
const sel=s=>keccak(Buffer.from(s)).slice(0,10),word=v=>'0x'+BigInt(v).toString(16).padStart(64,'0');
const TOKEN='0x'+'11'.repeat(20),A='0x'+'22'.repeat(20),B='0x'+'33'.repeat(20),BLOCK='0x1234';
const addr=a=>'0x'+a.slice(2).padStart(64,'0'),digestOf=name=>Object.entries(reviewed.PROFILES).find(([,v])=>v===name)[0];
function fixture(name,{calls={},slots={},runtime='0x600160005500',abi=[]}={}){
 const log=[],digest=digestOf(name);
 return {log,options:{network:'ethereum',address:TOKEN,block:BLOCK,sourceLoader:async()=>({digest,abi,runtimeMatch:'exact_match'}),rpc:async(method,params)=>{
  log.push({method,params});assert.equal(params.at(-1),BLOCK);
  if(method==='eth_getCode')return runtime;
  if(method==='eth_getStorageAt')return slots[Number(BigInt(params[1]))]||word(0);
  if(method==='eth_call'){const raw=calls[params[0].data.slice(0,10)];if(raw===undefined)throw Error('execution reverted');return raw;}
  throw Error(method);
 }}};
}
async function inspect(x){let supplementary;const result=await deep.inspect({...x.options,onSupplementary:x=>{supplementary=x;}});return {...result,supplementary};}
const spx=count=>fixture('LAUNCH_TAX_DECAY_FIXED_SUPPLY',{abi:[{type:'function',name:'owner',inputs:[],outputs:[{type:'address'}],stateMutability:'view'}],calls:{[sel('owner()')]:addr(A)},slots:{6:word(BigInt(B)<<8n),7:word(15),8:word(70),9:word(0),10:word(0),11:word(69),12:word(420),14:word(count)}});

test('Gnosis full source fixture reproduces the reviewed digest; constructor recipients are not administrators',async()=>{
 const source=require('./fixtures/mechanics-v6/gnosis-source.json');
 assert.equal(deep.digest(source.sources),digestOf('FIXED_SUPPLY_LEGACY_ALLOCATION'));
 const x=fixture('FIXED_SUPPLY_LEGACY_ALLOCATION'),r=await inspect(x);
 assert.equal(r.fields.mintCapability.value,'NONE DETECTED ✓');
 assert.equal(r.fields.mintCapability.evidence[0].mintAuthority.functionPresent,false);
 assert.equal(r.fields.ownerAdmin.value,'No token owner/admin');
 assert.match(r.fields.ownerAdmin.evidence[0].scope,/allocation recipients, not administrators/);
 assert.equal(r.fields.tradingTaxes.evidence[0].coverage,'TOKEN_TAX_ALL_TRANSFERS');
 assert.equal(r.fields.tradingTaxes.value,'Buy 0% · Sell 0% · Transfer 0%');
 assert.equal(r.fields.tradingTaxes.status,'VERIFIED_SOURCE_AND_STATE');
 assert.equal(r.fields.tradingTaxes.evidence[0].tokenTax.externalFees.dex,'NOT_VERIFIED');
 assert.equal(r.fields.tradingTaxes.evidence[0].sourceBoundNonDelegatingRuntime,true);
 assert.equal(x.log.filter(x=>x.method==='eth_call').length,0);
 const clone=fixture('FIXED_SUPPLY_LEGACY_ALLOCATION',{runtime:'0x363d3d373d3d3d363d73'+B.slice(2)+'5af43d82803e903d91602b57fd5bf3'});
 const unresolved=await inspect(clone);assert.equal(unresolved.fields.mintCapability,undefined);assert.equal(unresolved.fields.ownerAdmin,undefined);
 assert.equal(unresolved.fields.tradingTaxes.value,'Transfer 0% · DEX/hook fees NOT VERIFIED');
 assert.equal(unresolved.fields.tradingTaxes.evidence[0].coverage,'TOKEN_TRANSFER_ONLY');
 assert.equal(unresolved.fields.tradingTaxes.status,'VERIFIED_SOURCE');
});

test('SPX next buy increments the counter before tax, but wallet transfers and sells keep the current counter',async()=>{
 const before=await inspect(spx(68));assert.equal(before.fields.tradingTaxes.value,'Buy 15% · Sell 70% · Transfer 15%');
 const edge=spx(69),r=await inspect(edge);
 assert.equal(r.fields.tradingTaxes.value,'Buy 0% · Sell 70% · Transfer 15%');
 const tax=r.fields.tradingTaxes.evidence[0].tokenTax;
 assert.equal(tax.nextEligibleBuyCount,'70');
 assert.match(tax.exemptions.excludedFromFee,/does NOT bypass/);
 assert.equal(tax.collection.buyback,false);assert.equal(tax.collection.burn,false);assert.equal(tax.collection.reflection,false);
 assert.deepEqual(tax.externalFees,{dex:'NOT_VERIFIED',hook:'NOT_VERIFIED'});
 assert.equal(edge.log.filter(x=>x.method==='eth_getStorageAt'&&BigInt(x.params[1])<64n).length,8,'unchanged reviewed storage budget');
 assert.equal((await inspect(spx(420))).fields.tradingTaxes.value,'Buy 0% · Sell 70% · Transfer 0%');
 assert.equal((await inspect(spx(421))).fields.tradingTaxes.value,'Buy 0% · Sell 0% · Transfer 0%');
});

test('Torch tax separates immutable recipient exemptions, timestamp schedule and external router execution',async()=>{
 const x=fixture('IMMUTABLE_POOL_BUY_TAX',{calls:{[sel('BUY_TAX_BPS()')]:word(200),[sel('buyTaxBps()')]:word(5000),[sel('FEE_ROUTER()')]:addr(A)}}),r=await inspect(x);
 const tax=r.fields.tradingTaxes.evidence[0].tokenTax;
 assert.equal(tax.launch.active,true);assert.equal(tax.launch.mechanism,'TIMESTAMP_LINEAR_DECAY');
 assert.match(tax.exemptions.factoryRecipient,/FACTORY/);assert.equal(tax.collection.creatorShareBps,'7000');
 assert.match(tax.collection.shareScope,/NOT VERIFIED/);assert.equal(tax.externalFees.hook,'NOT_VERIFIED');
 assert.equal(x.log.filter(x=>x.method==='eth_call').length,3);
});

test('role identifier and cap state do not claim active role membership, execution or irreversible revocation',async()=>{
 const x=fixture('CCIP_BURN_MINT_ROLE_TOKEN',{calls:{[sel('MINTER_ROLE()')]:keccak(Buffer.from('MINTER_ROLE')),[sel('BURNER_ROLE()')]:keccak(Buffer.from('BURNER_ROLE')),[sel('maxSupply()')]:word(100),[sel('totalSupply()')]:word(100),[sel('decimals()')]:word(0),[sel('getCCIPAdmin()')]:addr(A)}}),r=await inspect(x);
 const stage=r.fields.mintCapability.evidence[0].mintAuthority;
 assert.equal(stage.functionPresent,true);assert.equal(stage.authorityIdentifierVerified,true);assert.equal(stage.authorizedAccountsVerified,false);
 assert.equal(stage.currentUsability,'NO_POSITIVE_CAPACITY');assert.equal(stage.permissionRevoked,'NOT_VERIFIED');assert.equal(stage.constraints.burnCanRestoreCapacity,true);
 const burn=r.details.observations.find(x=>x.method==='Reviewed CCIP privileged burn paths').burnAuthority;
 assert.equal(burn.holderAllowanceRequired,true);assert.equal(burn.arbitraryHolderBalance,false);assert.equal(burn.currentUsability,'NOT_VERIFIED');
});

test('pinned governance/controller identities do not claim the external authority can execute issuance',async()=>{
 const yfi=await inspect(fixture('GOVERNANCE_MINTER_SET',{calls:{[sel('governance()')]:addr(A)}}));
 const ys=yfi.fields.mintCapability.evidence[0].mintAuthority;
 assert.equal(ys.authority,A);assert.equal(ys.authorizedAccountsVerified,false);assert.equal(ys.currentUsability,'NOT_VERIFIED');
 const ldo=await inspect(fixture('MINIME_CONTROLLED',{calls:{[sel('controller()')]:addr(A),[sel('transfersEnabled()')]:word(2)}}));
 assert.equal(ldo.fields.mintCapability.evidence[0].mintAuthority.currentUsability,'NOT_VERIFIED');
 assert.equal(ldo.details.observations.some(x=>x.method==='transfersEnabled()'),false,'noncanonical bool does not become enabled');
 const burn=ldo.details.observations.find(x=>x.method==='Reviewed controller arbitrary-holder burn path').burnAuthority;
 assert.equal(burn.arbitraryHolderBalance,true);assert.equal(burn.holderAllowanceRequired,false);assert.equal(burn.authority,A);
});

test('renounced onlyOwner mint is revoked while a live owner still needs capacity and execution evidence',async()=>{
 const abi=[{type:'function',name:'owner',inputs:[],outputs:[{type:'address'}],stateMutability:'view'}];
 const renounced=await inspect(fixture('OWNER_CAPPED_MINT_VOTES',{abi,calls:{[sel('owner()')]:word(0)}}));
 assert.equal(renounced.fields.mintCapability.evidence[0].mintAuthority.permissionRevoked,'VERIFIED');
 const live=await inspect(fixture('OWNER_CAPPED_MINT_VOTES',{abi,calls:{[sel('owner()')]:addr(A)}}));
 const stage=live.fields.mintCapability.evidence[0].mintAuthority;
 assert.equal(stage.authorizedAccountsVerified,true);assert.equal(stage.currentUsability,'NOT_VERIFIED');assert.equal(stage.constraints.remainingRaw,'NOT_VERIFIED');
});

test('role evidence from another block or source cannot establish current mint or burner accounts',async()=>{
 const digest=digestOf('ROLE_MINTER_BURNER_VOTES'),fields={},details={observations:[
  {method:'getRoleMemberCount',role:'MINTER_ROLE',count:'1',sourceDigest:digest,block:'0x1233'},
  {method:'getRoleMemberCount',role:'DEFAULT_ADMIN_ROLE',count:'1',sourceDigest:'0'.repeat(64),block:BLOCK},
  {method:'hasRole',role:'BURNER_ROLE',member:A,value:true,sourceDigest:digest,block:'0x1233'},
  {method:'hasRole',role:'DEFAULT_ADMIN_ROLE',member:B,value:true,sourceDigest:'0'.repeat(64),block:BLOCK}
 ]};
 await reviewed.apply({profile:'ROLE_MINTER_BURNER_VOTES',fields,details,proof:{sourceDigest:digest},fact:(value,method,evidence,status)=>({value,evidence:[evidence],status}),direct:true,address:TOKEN,block:BLOCK});
 assert.equal(fields.mintCapability.status,'VERIFIED_SOURCE');
 assert.equal(fields.mintCapability.evidence[0].mintAuthority.authorizedAccountsVerified,false);
 assert.equal(fields.ownerAdmin,undefined);
 assert.deepEqual(details.observations.find(x=>x.method==='Reviewed BEAM privileged burn path').burnAuthority.authorizedAccounts,[]);
});
