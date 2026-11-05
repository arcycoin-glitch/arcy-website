'use strict';
// Architecture-only delegation proof for unreviewed EIP-1967 / legacy OpenZeppelin proxies (2026-11-05 audit: XAUt and PAXG
// were NOT VERIFIED although their slots point at deployed implementations). The proof is differential: the same non-admin
// eth_call reverts (or differs) without an override and executes replacement code in the proxy's own address context when
// ONLY the slot is overridden. Everything else (admin semantics, token mechanics) stays unverified.
const test=require('node:test'),assert=require('node:assert/strict');
const m=require('../search/server/lib/mechanics-deep'),probe=require('../search/server/lib/mechanics-proxy-probe');
const A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40),C='0x'+'3'.repeat(40),block='0x1234';
const zero='0x'+'0'.repeat(64),addr=a=>'0x'+a.slice(2).padStart(64,'0');
const basic='0x600160005500',delegate='0x60006000f400';
// mode: 'delegate' (real proxy), 'unsupported' (RPC rejects overrides), 'self' (baseline already returns own address),
// 'other' (override answers something else), 'call' (forwards with CALL, not DELEGATECALL: context = probe target)
function chain({slots={},targets={[B]:basic},mode='delegate'}={}){
 const seen=[];
 const rpc=async(method,p)=>{
  seen.push([method,p]);
  if(method==='eth_getCode')return p[0]===A?delegate:targets[p[0]]||'0x';
  if(method==='eth_getStorageAt'){assert.equal(p[2],block);return slots[p[1]]||zero;}
  if(method==='eth_call'){
   assert.equal(p[1],block,'every probe call is pinned to the inspection block');
   if(p[0].data!==probe.PROBE_SELECTOR)return zero;
   if(p.length===2){if(mode==='self')return addr(A);throw Error('execution reverted');}
   if(mode==='unsupported')throw Error('eth_call: too many arguments');
   const ov=p[2],keys=Object.keys(ov).sort();
   assert.deepEqual(keys,[A,probe.PROBE_TARGET].sort(),'override touches only the proxy slot and the probe target');
   assert.deepEqual(Object.keys(ov[A]),['stateDiff']);assert.equal(Object.keys(ov[A].stateDiff).length,1,'exactly one slot replaced');
   assert.equal(ov[probe.PROBE_TARGET].code,probe.PROBE_CODE);
   const slot=Object.keys(ov[A].stateDiff)[0];
   if(!slots[slot])return '0x';
   if(mode==='other')return addr(C);
   if(mode==='call')return addr(probe.PROBE_TARGET);
   return addr(A);
  }
  throw Error('Unexpected method '+method);
 };
 return {seen,options:{network:'ethereum',address:A,block,rpc,sourceLoader:async()=>null}};
}

test('EIP-1967 slot with deployed target and differential delegation proof publishes architecture only',async()=>{
 const x=chain({slots:{[m.SLOTS.implementation]:addr(B),[m.SLOTS.admin]:addr(C)}}),r=await m.inspect(x.options);
 const f=r.fields.contractArchitecture;
 assert.equal(f.value,'EIP-1967 proxy · delegation proven');assert.equal(f.status,'ON_CHAIN');
 const e=f.evidence[0];assert.equal(e.implementation,B);assert.equal(e.implementationSlot,m.SLOTS.implementation);assert.equal(e.adminSlotValue,C);
 assert.equal(e.probe.baseline,'REVERTED');assert.equal(e.probe.redirected,'PROXY_ADDRESS_CONTEXT');assert.match(e.scope,/NOT verified/);
 assert.equal(r.fields.ownerAdmin,undefined,'admin slot value is evidence only, never an owner/admin fact');
 assert.equal(r.fields.mintCapability,undefined);assert.equal(r.fields.tradingTaxes,undefined);
 assert(r.details.failures.some(d=>d.reason==='IMPLEMENTATION_EXECUTION_UNRESOLVED'),'token mechanics stay unresolved');
});

test('legacy OpenZeppelin (zeppelinos) implementation slot is proven the same way',async()=>{
 const r=await m.inspect(chain({slots:{[m.SLOTS.legacy]:addr(B)}}).options);
 assert.equal(r.fields.contractArchitecture.value,'Legacy OpenZeppelin proxy slot · delegation proven');
 assert.equal(r.fields.contractArchitecture.evidence[0].implementationSlot,m.SLOTS.legacy);
});

test('fail closed: unsupported overrides, ambiguous baseline, foreign answer and CALL-forwarding never prove delegation',async()=>{
 for(const mode of ['unsupported','self','other','call']){
  const r=await m.inspect(chain({slots:{[m.SLOTS.implementation]:addr(B)},mode}).options);
  assert.equal(r.fields.contractArchitecture,undefined,mode);
  assert(r.details.failures.some(d=>d.reason==='PROXY_DELEGATION_UNPROVEN'),mode);
 }
});

test('no probe without a deployed slot target, and never for non-delegating runtimes',async()=>{
 const empty=chain({slots:{[m.SLOTS.implementation]:addr(B)},targets:{}}),r=await m.inspect(empty.options);
 assert.equal(r.fields.contractArchitecture,undefined);
 assert(!empty.seen.some(([method,p])=>method==='eth_call'&&p[0].data===probe.PROBE_SELECTOR),'no target bytecode => no probe');
 const plain=chain({slots:{[m.SLOTS.implementation]:addr(B)}});plain.options.rpc=(orig=>async(method,p)=>method==='eth_getCode'&&p[0]===A?basic:orig(method,p))(plain.options.rpc);
 const n=await m.inspect(plain.options);assert.equal(n.fields.contractArchitecture.value,'NON-PROXY · runtime verified');
 assert(!plain.seen.some(([method,p])=>method==='eth_call'&&p[0].data===probe.PROBE_SELECTOR));
});

test('probe helper unit: exact address-context word required; selector and probe code are fixed',async()=>{
 assert.equal(probe.PROBE_CODE,'0x3060005260206000f3');assert.match(probe.PROBE_SELECTOR,/^0x[0-9a-f]{8}$/);
 const read=async(method,p)=>p.length===2?zero:addr(A).toUpperCase().replace('0X','0x');
 assert.equal((await probe.delegationProbe({read,address:A,slot:m.SLOTS.implementation,block})).baseline,'DIFFERENT_RESULT');
 assert.equal(await probe.delegationProbe({read:async()=>addr(A),address:A,slot:m.SLOTS.implementation,block}),null,'same answer with and without override is not a proof');
});
