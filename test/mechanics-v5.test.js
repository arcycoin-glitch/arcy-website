'use strict';
// Contract & Mechanics V5: Transfer Restrictions (supplementary), new reviewed source profiles, short reasons,
// data-engine pass-through, research note and the gated Risk Engine reuse.
const test=require('node:test'),assert=require('node:assert/strict');
const deep=require('../search/server/lib/mechanics-deep');
const coverage=require('../search/server/lib/mechanics-coverage');
const reviewed=require('../search/server/lib/mechanics-reviewed-tokens');
const restrictions=require('../search/server/lib/mechanics-restrictions');
const riskEvidence=require('../search/server/lib/mechanics-risk-evidence');
const engine=require('../search/server/lib/data-engine');
const {chain}=require('../search/server/lib/chains');
const notes=require('../search/server/lib/research-notes');
const keccak=require('../lib/keccak');
const sel=s=>keccak(Buffer.from(s)).slice(0,10);
const word=v=>'0x'+BigInt(v).toString(16).padStart(64,'0');
const addr=a=>'0x'+a.slice(2).toLowerCase().padStart(64,'0');
const block='0x1234',code='0x600160005500',TOKEN='0x1111111111111111111111111111111111111111';
const OWNER='0x42f7c51be14cac4c7fe70dcbef7ceff62e130137',SC='0x5555555555555555555555555555555555555555',AP='0x6666666666666666666666666666666666666666';
const digestOf=name=>Object.entries(deep.PROFILES).find(([,v])=>v===name)[0];
const fn=(name,inputs,out,mut='view')=>({type:'function',name,stateMutability:mut,inputs:inputs.map(type=>({type})),outputs:out?[{type:out}]:[]});
function fixture(digest,{calls={},runtime=code,abi=[],network='ethereum'}={}){
 const log=[];
 const rpc=async(method,params)=>{
  log.push({method,params});assert.equal(params.at(-1),block,'every read is pinned');
  if(method==='eth_getCode')return runtime;
  if(method==='eth_getStorageAt')return word(0);
  if(method==='eth_call'){const v=calls[params[0].data.slice(0,10)];return v===undefined?word(0):v;}
  throw Error('Unexpected '+method);
 };
 return {log,options:{network,address:TOKEN,block,rpc,sourceLoader:async()=>({digest,abi,runtimeMatch:'exact_match',url:'https://sourcify.dev/server/v2/contract/1/'+TOKEN,retrievedAt:'2026-11-15T09:00:00Z'})}};
}
async function inspect(x){let extra=null;const r=await deep.inspect({...x.options,onSupplementary:s=>{extra=s;}});return {...r,restriction:extra?.transferRestrictions||null};}
const missing=code=>({value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reasonCode:code,evidence:[]});
const emptyCard=()=>({description:'t',fields:{tradingTaxes:missing('TRADING_TAXES_NOT_VERIFIED'),mintCapability:missing('MINT_CAPABILITY_NOT_VERIFIED'),ownerAdmin:missing('OWNER_ADMIN_NOT_VERIFIED'),contractArchitecture:missing('ARCHITECTURE_NOT_VERIFIED')}});

test('V5 reviewed profiles are full-digest keyed and registered; restriction getters are bounded',()=>{
 for(const name of ['UNISWAP_UERC20_FIXED_SUPPLY','FIXED_SUPPLY_SELF_BURN','LEGACY_FIXED_SUPPLY_SELF_FREEZE','ERC1155_WRAPPED_FIXED_SUPPLY','PAXOS_SUPPLY_CONTROLLED']){
  const d=digestOf(name);assert.match(d,/^[0-9a-f]{64}$/);assert.equal(reviewed.PROFILES[d],name);
 }
 assert.ok(restrictions.RESTRICTION_GETTERS.length<=3&&restrictions.RESTRICTION_BUDGET===2);
 assert.deepEqual(reviewed.REVIEWED_GETTERS.slice(-3),['supplyController()','assetProtectionRole()','owner()']);
});
test('UERC20: fixed supply, no admin, full-value transfer and no restrictions; zero extra reads',async()=>{
 const x=fixture(digestOf('UNISWAP_UERC20_FIXED_SUPPLY'),{network:'robinhood'});const r=await inspect(x);
 assert.equal(r.fields.mintCapability.value,'NONE DETECTED ✓');
 assert.equal(r.fields.ownerAdmin.value,'No token owner/admin');assert.match(r.fields.ownerAdmin.evidence[0].scope,/Permit2/);
 assert.match(r.fields.tradingTaxes.value,/^Transfer 0% · DEX\/hook fees NOT VERIFIED/);
 assert.equal(r.restriction.value,'None in token code');assert.equal(r.restriction.status,'VERIFIED_SOURCE');
 assert.equal(r.restriction.evidence[0].block,block);
 assert.equal(x.log.filter(c=>c.method==='eth_call').length,0,'no new calls');
});
test('BNB legacy: owner can only withdraw ETH; same-owner value keeps the address; restrictions none',async()=>{
 const x=fixture(digestOf('LEGACY_FIXED_SUPPLY_SELF_FREEZE'),{abi:[fn('owner',[],'address')],calls:{[sel('owner()')]:addr(OWNER)}});const r=await inspect(x);
 assert.equal(r.fields.ownerAdmin.value,'Owner: ETH withdrawal only · '+OWNER);assert.equal(r.fields.ownerAdmin.status,'VERIFIED_SOURCE_AND_STATE');
 assert.equal(r.fields.mintCapability.value,'NONE DETECTED ✓');assert.equal(r.restriction.value,'None in token code');
});
test('NPC: renounced owner had no powers; SHIB: no owner; both no restrictions',async()=>{
 const n=await inspect(fixture(digestOf('ERC1155_WRAPPED_FIXED_SUPPLY'),{abi:[fn('owner',[],'address')]}));
 assert.equal(n.fields.ownerAdmin.value,'Ownership renounced · owner had no token powers');assert.equal(n.restriction.value,'None in token code');
 const s=await inspect(fixture(digestOf('FIXED_SUPPLY_SELF_BURN')));
 assert.equal(s.fields.ownerAdmin.value,'No token owner/admin');assert.equal(s.fields.mintCapability.value,'NONE DETECTED ✓');assert.equal(s.restriction.value,'None in token code');
});
test('Paxos implementation: supply controller, owner powers and pause/freeze state at the pinned block',async()=>{
 const x=fixture(digestOf('PAXOS_SUPPLY_CONTROLLED'),{abi:[fn('owner',[],'address'),fn('paused',[],'bool')],calls:{[sel('owner()')]:addr(OWNER),[sel('supplyController()')]:addr(SC),[sel('assetProtectionRole()')]:addr(AP),[sel('paused()')]:word(0)}});
 const r=await inspect(x);
 assert.equal(r.fields.mintCapability.value,'Supply-controller mint · '+SC);
 assert.match(r.fields.ownerAdmin.value,new RegExp('^Owner-governed .* · '+OWNER+'$'));assert.equal(r.fields.ownerAdmin.evidence[0].assetProtectionRole,AP);
 assert.equal(r.restriction.value,'Pause + freeze · not paused');assert.equal(r.restriction.status,'VERIFIED_SOURCE_AND_STATE');
 const extra=x.log.filter(c=>c.method==='eth_call'&&reviewed.REVIEWED_GETTERS.map(sel).includes(c.params[0].data.slice(0,10)));
 assert.ok(extra.length<=reviewed.REVIEWED_BUDGET);
 const paused=await inspect(fixture(digestOf('PAXOS_SUPPLY_CONTROLLED'),{abi:[fn('paused',[],'bool')],calls:{[sel('paused()')]:word(1)}}));
 assert.equal(paused.restriction.value,'Pause + freeze · PAUSED');
});
test('restriction absence claims need the direct runtime; unknown digests and unreviewed profiles get nothing',async()=>{
 const delegating='0x363d3d373d3d3d363d73'+'33'.repeat(20)+'5af43d82803e903d91602b57fd5bf3';
 const clone=await inspect(fixture(digestOf('NATIVE_DEPOSIT_WRAPPER'),{runtime:delegating}));
 assert.equal(clone.restriction,null,'WETH-style absence needs a direct runtime');
 assert.equal((await inspect(fixture('b'.repeat(64)))).restriction,null);
 assert.equal(await restrictions.derive({profile:'RECOMPILED_ROLE_BURN_MINT',fields:{},details:{observations:[]}}),null);
 assert.equal(await restrictions.derive({profile:'OZ_ERC20_TEMPLATE',fields:{},details:{observations:[]},direct:false,kind:null}),null);
});
test('upgradeable proxies qualify absence findings; presence findings report pause state',async()=>{
 const up=await restrictions.derive({profile:'UPGRADEABLE_NO_DIRECT_MINT',fields:{},details:{observations:[]},kind:'EIP-1967 implementation',direct:false});
 assert.equal(up.value,'None in current code · upgradeable');assert.match(up.extra.upgradeCaveat,/current implementation only/);
 const beacon=await restrictions.derive({profile:'OZ_ERC20_TEMPLATE',fields:{},details:{observations:[]},kind:'Reviewed immutable beacon proxy',direct:false});
 assert.equal(beacon.value,'None in current code · upgradeable');
 const usdc=await restrictions.derive({profile:'ALLOWANCE_MINTER_TOKEN',fields:{},details:{observations:[{method:'paused()',value:true,sourceDigest:'d'}]},proof:{sourceDigest:'d'},kind:'Legacy implementation slot'});
 assert.equal(usdc.value,'Pause + blacklist · PAUSED');assert.equal(usdc.status,'VERIFIED_SOURCE_AND_STATE');
 const unknownState=await restrictions.derive({profile:'ALLOWANCE_MINTER_TOKEN',fields:{},details:{observations:[{method:'paused()',value:false,sourceDigest:'other'}]},proof:{sourceDigest:'d'}});
 assert.equal(unknownState.value,'Pause + blacklist','a paused() read from another source is not used');
 const usdt=await restrictions.derive({profile:'CAPPED_FEE_LEGACY_TOKEN',fields:{},details:{observations:[]}});
 assert.equal(usdt,null,'deprecated/forwarding state unproven: no restriction claim');
});
test('launch limits are evaluated against the pinned block; Ondo and PEPE read bounded state',async()=>{
 const obs=raw=>({observations:[{method:'restrictionEndBlock()',raw}]});
 assert.equal((await restrictions.derive({profile:'FIXED_LAUNCH_RESTRICTIONS',fields:{},details:obs('4661'),block:'0x1234',direct:true})).value,'Launch buy limits until block 4661');
 assert.equal((await restrictions.derive({profile:'FIXED_LAUNCH_RESTRICTIONS',fields:{},details:obs('4659'),block:'0x1234',direct:true})).value,'None active · launch limits expired');
 const reads=[];const w=v=>async(a,s)=>{reads.push(s);return v[s]??null;};
 const ondo=await restrictions.derive({profile:'ROLE_TIMELOCK_TRANSFER',fields:{},details:{observations:[]},word:w({'transferAllowed()':word(1)}),address:TOKEN,direct:true});
 assert.equal(ondo.value,'Investor vesting locks · transfers enabled');
 const gated=await restrictions.derive({profile:'ROLE_TIMELOCK_TRANSFER',fields:{},details:{observations:[]},word:w({'transferAllowed()':word(0)}),address:TOKEN,direct:true});
 assert.equal(gated.value,'Transfers gated (TRANSFER_ROLE) · vesting locks');
 const pepe=await restrictions.derive({profile:'OWNER_RULES_BLACKLIST_FIXED_SUPPLY',fields:{},details:{observations:[]},proof:{},word:w({'owner()':word(0),'limited()':word(0),'uniswapV2Pair()':addr('0x'+'77'.repeat(20))}),address:TOKEN,direct:true});
 assert.equal(pepe.value,'Blacklist (frozen)');assert.match(pepe.scope,/existing blacklist entries stay blocked/);
 assert.equal(await restrictions.derive({profile:'OWNER_RULES_BLACKLIST_FIXED_SUPPLY',fields:{},details:{observations:[]},proof:{},word:w({}),address:TOKEN,direct:true}),null,'failed reads fail closed');
});
test('coverage keeps the four fields unchanged and adds supplementary restrictions (found or explained gap)',async()=>{
 const x=fixture(digestOf('UNISWAP_UERC20_FIXED_SUPPLY'),{network:'robinhood'});
 const out=await coverage.enrich({...x.options,card:emptyCard()});
 assert.deepEqual(Object.keys(out.fields).sort(),['contractArchitecture','mintCapability','ownerAdmin','tradingTaxes']);
 assert.equal(out.supplementary.transferRestrictions.value,'None in token code');
 const gap=await coverage.enrich({...fixture('c'.repeat(64)).options,card:emptyCard()});
 assert.equal(Object.keys(gap.fields).length,4);
 assert.equal(gap.supplementary.transferRestrictions.dataState,'NOT_VERIFIED');assert.equal(gap.supplementary.transferRestrictions.value,null);
 assert.match(gap.supplementary.transferRestrictions.reasonCode,/^(MECHANICS_|RESTRICTIONS_NOT_REVIEWED)/);
});
test('short user-facing reasons; full technical explanation stays in evidence',async()=>{
 const gaps=require('../search/server/lib/mechanics-gaps');
 const d={sourceVerification:{matched:false},failures:[{reason:'SOURCE_CODE_UNAVAILABLE'}]};
 const f=gaps.explain('ownerAdmin',missing('OWNER_ADMIN_NOT_VERIFIED'),d);
 assert.equal(f.reason,'Verified source unavailable.');assert.match(f.explanation,/pinned-runtime-matched/);
 const p=gaps.explain('mintCapability',missing('X'),{sourceVerification:{matched:false},failures:[{reason:'IMPLEMENTATION_EXECUTION_UNRESOLVED'}]});
 assert.equal(p.reason,'Proxy implementation path unresolved.');
});
test('data-engine validates supplementary restrictions; 20-field tally and schema unchanged; research note added',()=>{
 const cfg=chain('ethereum'),context={address:TOKEN,block};
 const ok={value:'Pause + blacklist · not paused',status:'VERIFIED_SOURCE_AND_STATE',dataState:'DATA_FOUND',chainId:1,network:'ethereum',source:'Ethereum RPC / contract evidence',evidence:[{chainId:1,network:'ethereum',address:TOKEN,block,scope:'Reviewed scope.'}]};
 const card=engine.formatCard('mechanics',{fields:emptyCard().fields,supplementary:{transferRestrictions:ok}},cfg,context);
 assert.equal(Object.keys(card.fields).length,4);assert.equal(card.supplementary.transferRestrictions.value,ok.value);
 assert.ok(card.researchNotes.some(n=>n.startsWith('Transfer Restrictions: Pause + blacklist · not paused (reviewed source at block 4660).')));
 assert.ok(card.researchNotes.length<=5,'fits the proof list');
 const other=engine.formatCard('mechanics',{fields:emptyCard().fields,supplementary:{transferRestrictions:{...ok,evidence:[{...ok.evidence[0],address:'0x'+'99'.repeat(20)}]}}},cfg,context);
 assert.equal(other.supplementary.transferRestrictions.reasonCode,'SOURCE_CONTRACT_MISMATCH');
 const stale=engine.formatCard('mechanics',{fields:emptyCard().fields,supplementary:{transferRestrictions:{...ok,evidence:[{...ok.evidence[0],block:'0x1'}]}}},cfg,context);
 assert.equal(stale.supplementary.transferRestrictions.reasonCode,'SOURCE_BLOCK_MISMATCH');
 const wrongChain=engine.formatCard('mechanics',{fields:emptyCard().fields,supplementary:{transferRestrictions:{...ok,chainId:4663}}},cfg,context);
 assert.equal(wrongChain.supplementary.transferRestrictions.dataState,'NOT_VERIFIED');
 assert.equal(engine.formatCard('supply',{fields:{},supplementary:{transferRestrictions:ok}},cfg,context).supplementary,undefined);
 assert.equal(require('../search/server/schema').find(c=>c.id==='mechanics').fields.length,4);
 assert.equal(notes.restrictionNote({dataState:'NOT_VERIFIED',reason:'Verified source unavailable.'}),'Transfer Restrictions: NOT VERIFIED. Verified source unavailable.');
});
test('Risk Engine reuse is inert while the public flag is off (no snapshot request)',async()=>{
 let called=0;const reader={getSnapshot:async()=>{called++;return null;}};
 const card=emptyCard();
 for(const env of [{},{ARC_AUTONOMY_RISK_PUBLIC_ENABLED:'false'},{ARC_AUTONOMY_RISK_PUBLIC_ENABLED:'1'}])
  assert.equal(await riskEvidence.attach(card,{network:'ethereum',address:TOKEN,env,reader}),card);
 assert.equal(await riskEvidence.attach(card,{network:'arc',address:TOKEN,env:{ARC_AUTONOMY_RISK_PUBLIC_ENABLED:'true'},reader}),card,'unsupported network');
 assert.equal(called,0);
 const out=await coverage.enrich({...fixture('c'.repeat(64)).options,card:emptyCard(),env:{},riskReader:reader});
 assert.equal(called,0);assert.equal(out.fields.tradingTaxes.dataState,'NOT_VERIFIED');
});
test('Risk Engine reuse (flag on): corroborates, fails closed on conflict, simulated sell only, ignores stale/unverified',async()=>{
 const env={ARC_AUTONOMY_RISK_PUBLIC_ENABLED:'true'},now=Date.parse('2026-11-15T12:00:00Z');
 const rec=(value,extra={})=>({metricId:'risk.sell-transfer-tax',network:'ethereum',token:TOKEN,value,state:'VERIFIED_ONCHAIN',reasonCode:'EXACT_ONCHAIN_AGREEMENT',
  observedAt:'2026-11-15T11:00:00Z',block:{number:4660,hash:'0x'+'ab'.repeat(32)},observations:[{source:{operator:'a'}},{source:{operator:'b'}}],...extra});
 const reader=r=>({getSnapshot:async(n,t)=>{assert.equal(n,'ethereum');assert.equal(t,TOKEN);return {records:[r]};}});
 const reviewedTax={value:'Transfer 0% · DEX/hook fees NOT VERIFIED',status:'VERIFIED_SOURCE',dataState:'DATA_FOUND',chainId:1,network:'ethereum',source:'x',evidence:[{block}]};
 const base={...emptyCard(),fields:{...emptyCard().fields,tradingTaxes:reviewedTax}};
 const agree=await riskEvidence.attach(base,{network:'ethereum',address:TOKEN,env,reader:reader(rec(0)),now});
 assert.equal(agree.fields.tradingTaxes.value,reviewedTax.value);assert.equal(agree.fields.tradingTaxes.evidence.at(-1).status,'CORROBORATING');
 const conflict=await riskEvidence.attach(base,{network:'ethereum',address:TOKEN,env,reader:reader(rec(300)),now});
 assert.equal(conflict.fields.tradingTaxes.dataState,'NOT_VERIFIED');assert.equal(conflict.fields.tradingTaxes.value,null);
 assert.equal(conflict.fields.tradingTaxes.reasonCode,'MECHANICS_RISK_EVIDENCE_CONFLICT');
 const sim=await riskEvidence.attach(emptyCard(),{network:'ethereum',address:TOKEN,env,reader:reader(rec(250)),now});
 assert.equal(sim.fields.tradingTaxes.value,'Sell 2.5% (simulated) · Buy/Transfer NOT VERIFIED');assert.equal(sim.fields.tradingTaxes.evidence[0].block,'0x1234');
 for(const r of [rec(250,{state:'SINGLE_SOURCE'}),rec(250,{observedAt:'2026-11-13T00:00:00Z'}),rec(50),rec(250,{network:'robinhood'}),rec(250,{metricId:'risk.mint-authority'})])
  assert.equal((await riskEvidence.attach(emptyCard(),{network:'ethereum',address:TOKEN,env,reader:reader(r),now})).fields.tradingTaxes.dataState,'NOT_VERIFIED');
 const failing={getSnapshot:async()=>{throw Error('down');}};
 assert.equal((await riskEvidence.attach(base,{network:'ethereum',address:TOKEN,env,reader:failing,now})).fields.tradingTaxes.value,reviewedTax.value);
});
