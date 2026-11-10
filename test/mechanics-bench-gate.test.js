'use strict';
// The paired Mechanics gate replaces the absolute zero-extra-request rule with narrow, evidence-based budgets:
// <=2 delegation-probe eth_calls per contract whose architecture was NOT verified on main, <=3 sibling getter calls (+<=1
// cached reference fetch) per Robinhood contract whose tax/mint/owner were NOT verified on main. Everything else unchanged.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const SCRIPT=path.resolve(__dirname,'../scripts/assert-mechanics-bench.cjs');
const {isPinnedBlockTag,customRoleEvidence}=require('../scripts/mechanics-bench-budget.cjs');
const FIELDS=['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture'];
const field=ok=>({ok,cls:ok?'ON_CHAIN_VERIFIED':'NOT_VERIFIED',status:ok?'ON_CHAIN':'NOT_VERIFIED',value:ok?'x':'',scope:''});
const netOf=(o={})=>({rpc:10,sourcify:1,goplus:0,explorer:0,other:0,failed:0,replayHit:11,replayMiss:0,augProbe:0,augSibling:0,augReference:0,augCustomRole:0,...o});
function rows(n=32,mut=()=>{}){return Array.from({length:n},(_,i)=>{const r={chain:i<16?'ethereum':'robinhood',address:'0x'+(i+1).toString(16).padStart(40,'0'),group:'radar',block:'0x10',err:null,net:netOf(),f:Object.fromEntries(FIELDS.map(k=>[k,field(true)]))};mut(r,i);return r;});}
const total=rs=>rs.reduce((t,r)=>{for(const [k,v] of Object.entries(r.net))t[k]=(t[k]||0)+v;return t;},{});
function gate(beforeRows,afterRows,afterMode='augment'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcy-gate-'));
 try{const b=path.join(dir,'b.json'),a=path.join(dir,'a.json');
  fs.writeFileSync(b,JSON.stringify({mode:'replay',net:total(beforeRows),rows:beforeRows}));fs.writeFileSync(a,JSON.stringify({mode:afterMode,net:total(afterRows),rows:afterRows}));
  const r=spawnSync(process.execPath,[SCRIPT,b,a],{encoding:'utf8'});return {ok:r.status===0,out:r.stdout+r.stderr};}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}
// contract 0: unverified proxy on main; contract 20: unverified Robinhood token on main
const base=()=>rows(32,(r,i)=>{if(i===0)r.f.contractArchitecture=field(false);if(i===20)for(const k of ['tradingTaxes','mintCapability','ownerAdmin'])r.f[k]=field(false);});

test('identical replays pass; any unbudgeted extra request still fails',()=>{
 assert.equal(gate(base(),base(),'replay').ok,true);
 const extra=base();extra[5].net.rpc++;const r=gate(base(),extra);assert.equal(r.ok,false);assert.match(r.out,/New RPC usage/);
 const src=base();src[5].net.sourcify++;assert.match(gate(base(),src).out,/New Sourcify usage/);
 const miss=base();miss[5].net.replayMiss++;assert.equal(gate(base(),miss).ok,false);
});

test('delegation probe: <=2 calls only for a contract whose architecture was unverified on main',()=>{
 const ok=base();ok[0].net.rpc+=2;ok[0].net.augProbe=2;ok[0].f.contractArchitecture=field(true);
 const r=gate(base(),ok);assert.equal(r.ok,true,r.out);assert.match(r.out,/"probe":2/);
 const over=base();over[0].net.rpc+=3;over[0].net.augProbe=3;assert.match(gate(base(),over).out,/probe budget exceeded/);
 const ineligible=base();ineligible[1].net.rpc+=2;ineligible[1].net.augProbe=2;assert.match(gate(base(),ineligible).out,/already verified architecture/);
});

test('sibling: <=3 getter calls and <=1 reference fetch, only for an unverified Robinhood contract',()=>{
 const ok=base();ok[20].net.rpc+=3;ok[20].net.augSibling=3;ok[20].net.sourcify+=1;ok[20].net.augReference=1;
 assert.equal(gate(base(),ok).ok,true);
 const over=base();over[20].net.rpc+=4;over[20].net.augSibling=4;assert.match(gate(base(),over).out,/Sibling getter budget exceeded/);
 const twice=base();twice[20].net.sourcify+=2;twice[20].net.augReference=2;assert.match(gate(base(),twice).out,/reference fetched more than once/);
 const verified=base();verified[21].net.rpc+=3;verified[21].net.augSibling=3;assert.match(gate(base(),verified).out,/ineligible\/verified/);
 const eth=rows(32,(r,i)=>{if(i===2)for(const k of ['tradingTaxes','mintCapability','ownerAdmin'])r.f[k]=field(false);});const ethAfter=structuredClone(eth);ethAfter[2].net.rpc+=3;ethAfter[2].net.augSibling=3;assert.match(gate(eth,ethAfter).out,/ineligible\/verified/);
});

test('correctness gate is unchanged: a verified field can never be lost or silently rewritten',()=>{
 const lost=base();lost[3].f.mintCapability=field(false);assert.match(gate(base(),lost).out,/Verified field lost/);
 const changed=base();changed[3].f.mintCapability={...field(true),value:'other'};assert.match(gate(base(),changed).out,/changed without same-owner stronger proof/);
 const budgetHidesLoss=base();budgetHidesLoss[0].net.rpc+=2;budgetHidesLoss[0].net.augProbe=2;budgetHidesLoss[0].f.ownerAdmin=field(false);assert.match(gate(base(),budgetHidesLoss).out,/Verified field lost/);
});

test('reviewed-profile reads: <=8 per contract and only where the tax row was unverified on main',()=>{
 const ok=base();ok[20].net.rpc+=8;ok[20].net.augReviewed=8;ok[20].f.tradingTaxes=field(true);
 const r=gate(base(),ok);assert.equal(r.ok,true,r.out);assert.match(r.out,/"reviewed":8/);
 const over=base();over[20].net.rpc+=9;over[20].net.augReviewed=9;assert.match(gate(base(),over).out,/Reviewed-profile read budget exceeded/);
 const ineligible=base();ineligible[4].net.rpc+=3;ineligible[4].net.augReviewed=3;assert.match(gate(base(),ineligible).out,/already verified tax row/);
 const hidden=base();hidden[20].net.rpc+=9;hidden[20].net.augReviewed=8;assert.match(gate(base(),hidden).out,/New RPC usage/);
});

test('custom-role replay reads require a pinned JSON-RPC quantity and stay within the per-contract budget',()=>{
 for(const block of ['0x0','0x1','0x1d21839','0xABCDEF'])assert.equal(isPinnedBlockTag(block),true,block);
 for(const block of ['latest','pending','safe','0x','0x01','0x'+'a'.repeat(65),null])assert.equal(isPinnedBlockTag(block),false,String(block));
 const ok=base();ok[6].net.rpc+=20;ok[6].net.augCustomRole=20;
 const result=gate(base(),ok);assert.equal(result.ok,true,result.out);assert.match(result.out,/"customRole":20/);
 const over=base();over[6].net.rpc+=21;over[6].net.augCustomRole=21;assert.match(gate(base(),over).out,/Custom AccessControl role read budget exceeded/);
});

test('custom-role evidence measurement deduplicates mirrored fields and keeps pinned source scope',()=>{
 const member='0x'+'3'.repeat(40),proof={role:'PAUSER_ROLE',method:'hasRole',roleId:'0x'+'a'.repeat(64),member,value:true,block:'0x1234',sourceDigest:'b'.repeat(64),scope:'Confirmed membership for the first indexed member only.'};
 const card={fields:{ownerAdmin:{evidence:[{observations:[proof]}]},mintCapability:{evidence:[{observations:[proof]}]}}};
 assert.deepEqual(customRoleEvidence(card),[{role:proof.role,method:proof.method,roleId:proof.roleId,member,count:null,value:true,block:proof.block,sourceDigest:proof.sourceDigest,scope:proof.scope}]);
});

test('an enumerated DEFAULT_ADMIN_ROLE member may only be upgraded to reviewed evidence for the same address',()=>{
 const A='0x7e9e4c0876b2102f33a1d82117cc73b7fddd0032',B='0x'+'12'.repeat(20);
 const mk=v=>rows(32,(r,i)=>{if(i===6)r.f.ownerAdmin={ok:true,cls:'SINGLE_SOURCE',status:'GETTER_REPORTED',value:'DEFAULT_ADMIN_ROLE: '+A,scope:''};});
 const same=mk();same[6].f.ownerAdmin={ok:true,cls:'ON_CHAIN_VERIFIED',status:'VERIFIED_SOURCE_AND_STATE',value:'Role-governed · DEFAULT_ADMIN_ROLE: '+A+' · burner can burn any wallet',scope:''};
 assert.equal(gate(mk(),same).ok,true);
 const other=mk();other[6].f.ownerAdmin={...same[6].f.ownerAdmin,value:'Role-governed · DEFAULT_ADMIN_ROLE: '+B};
 assert.match(gate(mk(),other).out,/changed without same-owner stronger proof/);
 const weaker=mk();weaker[6].f.ownerAdmin={...same[6].f.ownerAdmin,status:'GETTER_REPORTED',cls:'SINGLE_SOURCE'};
 assert.match(gate(mk(),weaker).out,/changed without same-owner stronger proof/);
});
