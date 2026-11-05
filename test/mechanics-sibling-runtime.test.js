'use strict';
// Verified-sibling runtime reuse (Pons V2 launcher tokens, 2026-11-05 audit). Every acceptance condition has a negative test.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const sib=require('../search/server/lib/mechanics-sibling-runtime'),m=require('../search/server/lib/mechanics-deep');
const pad=a=>'0'.repeat(24)+a.slice(2);
const A1='0x'+'a1'.repeat(20),A2='0x'+'a2'.repeat(20),B1='0x'+'b1'.repeat(20),B2='0x'+'b2'.repeat(20);
// Synthetic 200-byte runtime with immutable id 'x' at 40 and 100 (same value) and id 'y' at 150; trailing bytes = "metadata".
function runtime(x,y,{tweak=null,metadata='a264697066735822'}={}){
 const b=Buffer.alloc(200,0x5b);b.write(metadata,192,'hex');
 for(const s of [40,100])Buffer.from(pad(x),'hex').copy(b,s);Buffer.from(pad(y),'hex').copy(b,150);
 if(tweak!==null)b[tweak]^=1;return '0x'+b.toString('hex');
}
function family(extra={}){
 const refs={x:[{start:40,length:32},{start:100,length:32}],y:[{start:150,length:32}]};
 const b=Buffer.from(runtime(A1,B1).slice(2),'hex');for(const r of Object.values(refs).flat())b.fill(0,r.start,r.start+r.length);
 return {id:'TEST_FAMILY',chainId:4663,length:200,reference:'0x'+'cc'.repeat(20),compilation:'src/T.sol:T',compilerVersion:'0.8.35+commit.47b9dedd',
  sourceDigest:m.digest({'src/T.sol':{content:'contract T{}'}}),maskedRuntimeSha256:crypto.createHash('sha256').update(b).digest('hex'),immutableReferences:refs,getters:{deployer:'x',curve:'y'},...extra};
}

test('match: a sibling that differs only inside declared immutables is accepted with its own immutable values',()=>{
 const f=family(),hit=sib.match(runtime(A2,B2),4663,[f]);
 assert.equal(hit.family.id,'TEST_FAMILY');assert.deepEqual(hit.immutables,{x:A2,y:B2});
 assert.deepEqual(sib.match(runtime(A1,B1),4663,[f]).immutables,{x:A1,y:B1},'the reference itself matches');
});

test('match fails closed: byte outside immutables, metadata, length, chain, dirty/zero/inconsistent immutables, ambiguity',()=>{
 const f=family();
 assert.equal(sib.match(runtime(A2,B2,{tweak:10}),4663,[f]),null,'one byte outside an immutable region');
 assert.equal(sib.match(runtime(A2,B2,{metadata:'a264697066735823'}),4663,[f]),null,'different CBOR metadata');
 assert.equal(sib.match(runtime(A2,B2)+'00',4663,[f]),null,'different length');
 assert.equal(sib.match(runtime(A2,B2),1,[f]),null,'different chain');
 const dirty=Buffer.from(runtime(A2,B2).slice(2),'hex');dirty[150]=1;assert.equal(sib.match('0x'+dirty.toString('hex'),4663,[f]),null,'non-address immutable word');
 const split=Buffer.from(runtime(A2,B2).slice(2),'hex');Buffer.from(pad(A1),'hex').copy(split,100);assert.equal(sib.match('0x'+split.toString('hex'),4663,[f]),null,'same immutable id with two values');
 assert.equal(sib.match(runtime('0x'+'0'.repeat(40),B2),4663,[f]),null,'zero address immutable');
 assert.equal(sib.match(runtime(A2,B2),4663,[f,{...f,id:'OTHER'}]),null,'two matching families are ambiguous');
 assert.equal(sib.match('0xzz',4663,[f]),null);assert.equal(sib.match(null,4663,[f]),null);
});

function record(f,over={}){
 return {chainId:String(f.chainId),address:f.reference,runtimeMatch:'exact_match',match:'exact_match',
  abi:[{type:'function',name:'deployer',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}],
  sources:{'src/T.sol':{content:'contract T{}'}},compilation:{name:'T',fullyQualifiedName:f.compilation,compilerVersion:f.compilerVersion},
  runtimeBytecode:{onchainBytecode:runtime(A1,B1),immutableReferences:f.immutableReferences},...over};
}
test('reference record must still be exact-matched with the pinned digest, compiler, contract, layout and runtime',()=>{
 const f=family();assert.equal(sib.validateReference(record(f),f).digest,f.sourceDigest);
 const bad=[['SIBLING_REFERENCE_NOT_EXACT',{runtimeMatch:'match'}],
  ['SIBLING_REFERENCE_SOURCE_CHANGED',{sources:{'src/T.sol':{content:'contract T{uint x;}'}}}],
  ['SIBLING_REFERENCE_COMPILATION_CHANGED',{compilation:{name:'T',fullyQualifiedName:'src/U.sol:U',compilerVersion:f.compilerVersion}}],
  ['SIBLING_REFERENCE_LAYOUT_CHANGED',{runtimeBytecode:{onchainBytecode:runtime(A1,B1),immutableReferences:{x:[{start:40,length:32}]}}}],
  ['SIBLING_REFERENCE_RUNTIME_CHANGED',{runtimeBytecode:{onchainBytecode:runtime(A1,B1,{tweak:5}),immutableReferences:f.immutableReferences}}],
  ['SOURCE_IDENTITY_MISMATCH',{address:'0x'+'dd'.repeat(20)}]];
 for(const [code,over] of bad)assert.throws(()=>sib.validateReference(record(f,over),f),new RegExp(code),code);
});

test('pinned Pons family constant: reviewed digest, 4 declared regions in 3 ids, getters bound to every id',()=>{
 const [f]=sib.FAMILIES;assert.equal(sib.FAMILIES.length,1);
 assert.equal(f.chainId,4663);assert.equal(f.length,3248);assert.match(f.sourceDigest,/^[0-9a-f]{64}$/);assert.match(f.maskedRuntimeSha256,/^[0-9a-f]{64}$/);
 assert.equal(Object.values(f.immutableReferences).flat().length,4);
 assert.deepEqual(Object.values(f.getters).sort(),Object.keys(f.immutableReferences).sort(),'every immutable id is re-read through a getter');
 assert.equal(m.PROFILES[f.sourceDigest],undefined,'no profile shortcut: mechanics still come from source analysis');
});

// Engine integration: the token's own getters must return its own immutable words at the pinned block.
const T='0x'+'1'.repeat(40),block='0x1234',basic='0x600160005500',zero='0x'+'0'.repeat(64),word=a=>'0x'+pad(a);
function inspectWith({deployer=A2,curve=B2,abi=['deployer','curve']}={}){
 const launch=Object.keys(m.PROFILES).find(k=>m.PROFILES[k]==='FIXED_SUPPLY_BURNABLE_LAUNCH');
 const source={digest:launch,abi:abi.map(name=>({type:'function',name,stateMutability:'view',inputs:[],outputs:[{type:'address'}]})),url:'https://sourcify.dev/ref',
  runtimeMatch:'SIBLING_REFERENCE_EXACT_MATCH_IMMUTABLES_ONLY',sourceProvider:'Sourcify (verified sibling reference)',sourceAssurance:'SIBLING_RUNTIME_MATCH_IMMUTABLES_ONLY',
  siblingReview:{family:'TEST_FAMILY',getters:{deployer:'x',curve:'y'},immutables:{x:A2,y:B2}},runtimeReview:{family:'TEST_FAMILY',immutables:{x:A2,y:B2}}};
 const sel=s=>m.selector(s);
 const rpc=async(method,p)=>{if(method==='eth_getCode')return basic;if(method==='eth_getStorageAt')return zero;if(method==='eth_call'){if(p[0].data===sel('deployer()'))return word(deployer);if(p[0].data===sel('curve()'))return word(curve);return zero;}throw Error('Unexpected '+method);};
 return m.inspect({network:'robinhood',address:T,block,rpc,sourceLoader:async()=>source});
}
test('sibling source publishes reviewed fields only after this token\'s own getters match its immutables',async()=>{
 const r=await inspectWith();
 assert.match(r.fields.mintCapability.value,/NONE DETECTED/);assert.match(r.fields.tradingTaxes.value,/Transfer 0%/);
 const e=r.fields.mintCapability.evidence[0];assert.equal(e.sourceAssurance,'SIBLING_RUNTIME_MATCH_IMMUTABLES_ONLY');assert.equal(e.runtimeReview.family,'TEST_FAMILY');
});
test('fail closed when the token state disagrees or the reference ABI lacks a getter',async()=>{
 for(const opts of [{deployer:A1},{curve:B1},{abi:['deployer']}]){
  const r=await inspectWith(opts);
  for(const k of ['mintCapability','tradingTaxes','ownerAdmin'])assert.equal(r.fields[k],undefined,JSON.stringify(opts)+' '+k);
  assert(r.details.failures.some(d=>d.reason==='SIBLING_TOKEN_STATE_MISMATCH'));
 }
});
