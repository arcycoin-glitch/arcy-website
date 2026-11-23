'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const mech=require('../search/server/lib/mechanics-deep');
const review=require('../search/server/lib/mechanics-v8-source');
const {recorder}=require('../search/server/lib/mechanics-v8-evidence');
const auth=require('../search/server/lib/mechanics-v8-authority');
const keccak=require('../lib/keccak');
const a=x=>'0x'+x.repeat(40),[A,B,C,D,E]=['1','2','3','4','5'].map(a),block='0x123';
const word=x=>'0x'+BigInt(x).toString(16).padStart(64,'0');
const fn=(name,outputs='address',inputs=[])=>({type:'function',stateMutability:'view',name,outputs:[{type:outputs}],inputs:inputs.map(type=>({type}))});
const slot=(sig,...args)=>mech.selector(sig)+args.map(x=>word(x).slice(2)).join('');
const simple='0x600160005500',delegates='0x60006000f400';
const canon=(name,address,...abi)=>({abi,subjectAddress:address,runtimeFamily:{kind:name,release:'v5.0.2',sourceReference:'https://example.com/canonical'},digest:'a'.repeat(64)});
function fixture({code={},slots={},sources={},reads={}}){
 const log=[];
 const rpc=async(method,p)=>{
  log.push([method,p]);assert.equal(p.at(-1),block);
  if(method==='eth_getCode')return code[p[0]]??'0x';
  if(method==='eth_getStorageAt')return slots[p[0]+p[1]]??word(0);
  if(method==='eth_call')return reads[p[0].to+p[0].data]??word(0);
  throw Error('Not a permitted pinned read');
 };
 return {log,inspect:()=>mech.inspect({network:'ethereum',address:A,block,rpc,sourceLoader:async(_,x)=>sources[x]||null})};
}
test('transparent v5 checks the immutable admin, reports slot disagreement, and follows reviewed ProxyAdmin ownership',async()=>{
 const f=fixture({code:{[A]:'0x7f'+word(C).slice(2)+delegates.slice(2),[B]:simple,[C]:simple},slots:{[A+mech.SLOTS.implementation]:word(B),[A+mech.SLOTS.admin]:word(D)},
  sources:{[A]:{...canon('TRANSPARENT',A),immutableReferences:{'1':[{start:1,length:32}]}},[C]:canon('ADMIN',C,fn('owner'),fn('pendingOwner'))},
  reads:{[C+slot('owner()')]:word(E),[C+slot('pendingOwner()')]:word(D)}});
 const r=await f.inspect(),g=r.details.authorityGraph;
 assert.equal(r.details.proxyBinding.proxyType,'TRANSPARENT');
 assert(r.details.failures.some(x=>x.reason==='ADMIN_SLOT_IMMUTABLE_MISMATCH'&&x.slotValue===D&&x.immutableValue===C));
 assert(g.edges.some(x=>x.contractAddress===A&&x.controller===C&&x.verificationStatus==='CONFIRMED_AUTHORITY'&&x.block===block));
 assert(g.edges.some(x=>x.contractAddress===C&&x.controller===E&&x.permission==='upgradeAndCall(address,address,bytes)'&&x.verificationStatus==='CONFIRMED_AUTHORITY'));
 assert(g.edges.some(x=>x.controller===D&&x.mechanism==='PROPOSED_OWNER'&&x.verificationStatus==='OBSERVED_CONTROLLER'));
 assert(!g.edges.some(x=>x.controller===D&&x.verificationStatus==='CONFIRMED_AUTHORITY'));
 assert(!f.log.some(([m,p])=>m==='eth_call'&&p[0].to===D));
});
test('UUPS UUID and owner alone never confirm authority; recognized gate uses outer storage',async()=>{
 const base={code:{[A]:delegates,[B]:delegates},slots:{[A+mech.SLOTS.implementation]:word(B)},
  reads:{[B+slot('proxiableUUID()')]:mech.SLOTS.implementation,[A+slot('owner()')]:word(C),[B+slot('owner()')]:word(E)}};
 for(const kind of ['UUPS_ONLY_OWNER','UNKNOWN_CUSTOM']){
  const f=fixture({...base,sources:{[A]:canon('ERC1967',A),[B]:canon(kind,B,fn('owner'))}});
  const r=await f.inspect(),edges=r.details.authorityGraph.edges;
  assert(r.fields.contractArchitecture.value.includes('UUPS UUID observed'));
  if(kind==='UUPS_ONLY_OWNER')assert(edges.some(x=>x.controller===C&&x.mechanism===kind&&x.block===block&&x.verificationStatus==='CONFIRMED_AUTHORITY'));
  else assert(edges.some(x=>x.mechanism==='UUPS_UUID'&&x.verificationStatus==='UNKNOWN_AUTHORITY'));
  assert(!edges.some(x=>x.controller===E));
 }
});
test('only reviewed UUPS role gate plus checked membership confirms a role holder',async()=>{
 const ROLE=keccak(Buffer.from('UPGRADER_ROLE'));
 const roleAbi=[fn('UPGRADER_ROLE','bytes32'),fn('getRoleMemberCount','uint256',['bytes32']),fn('getRoleMember','address',['bytes32','uint256']),fn('hasRole','bool',['bytes32','address'])];
 for(const enabled of [false,true]){
  const f=fixture({code:{[A]:delegates,[B]:delegates},slots:{[A+mech.SLOTS.implementation]:word(B)},sources:{[A]:canon('ERC1967',A),[B]:canon('UUPS_ONLY_ROLE',B,...roleAbi)},reads:{
   [B+slot('proxiableUUID()')]:mech.SLOTS.implementation,[A+slot('UPGRADER_ROLE()')]:ROLE,
   [A+slot('getRoleMemberCount(bytes32)',ROLE)]:word(1),[A+slot('getRoleMember(bytes32,uint256)',ROLE,0)]:word(C),
   [A+slot('hasRole(bytes32,address)',ROLE,C)]:word(enabled?1:0)
  }});
  const edges=(await f.inspect()).details.authorityGraph.edges.filter(x=>x.mechanism==='UUPS_ONLY_ROLE');
  assert.deepEqual(edges.map(x=>[x.controller,x.verificationStatus]),[[enabled?C:null,enabled?'CONFIRMED_AUTHORITY':'UNKNOWN_AUTHORITY']]);
 }
});
test('canonical beacon binds proxy caller and only a reviewed upgrade gate qualifies its owner',async()=>{
 const f=fixture({code:{[A]:delegates,[B]:simple,[C]:simple},slots:{[A+mech.SLOTS.beacon]:word(B)},
  sources:{[A]:{...canon('BEACON_PROXY',A),runtimeFamily:{kind:'BEACON_PROXY',release:'v4.9.6'}},[B]:canon('BEACON',B,fn('owner'))},
  reads:{[B+slot('implementation()')]:word(C),[B+slot('owner()')]:word(E)}});
 const r=await f.inspect();
 assert.equal(r.details.proxyBinding.implementation,C);
 assert(f.log.some(([method,p])=>method==='eth_call'&&p[0].to===B&&p[0].from===A));
 assert(r.details.authorityGraph.edges.some(x=>x.contractAddress===B&&x.controller===E&&x.permission==='upgradeTo(address)'&&x.verificationStatus==='CONFIRMED_AUTHORITY'));
});
test('nested observations preserve controller cycles and multisig/timelock indicators without promoting signers',async()=>{
 const roles={
  [B]:canon('OWNABLE_2STEP',B,fn('owner')),[C]:canon('TIMELOCK',C,fn('owner'),fn('getMinDelay','uint256')),
  [D]:canon('CUSTOM',D,fn('getOwners','address[]'),fn('getThreshold','uint256'))
 };
 const values={[B+'owner()']:word(C),[C+'owner()']:word(B),[C+'getMinDelay()']:word(3600),
  [D+'getOwners()']:word(32)+word(2).slice(2)+word(C).slice(2)+word(E).slice(2),[D+'getThreshold()']:word(2)};
 const g=await auth.trace({subject:A,roots:[B,D].map(x=>auth.root(x,'ABI_CONTROLLER_GETTER','Observed','OBSERVED_CONTROLLER')),
  codeAt:async()=>simple,sourceAt:async x=>roles[x],call:async(x,sig)=>values[x+sig],abiFn:mech.abiFn,decodeArray:mech.decodeArray,
  stamp:recorder({chainId:1,network:'ethereum',address:A,block,provider:'test RPC'}),deadline:Date.now()+1000});
 assert.equal(g.nodes.find(x=>x.contractAddress===C).values['getMinDelay()'],'3600');
 assert(g.nodes.some(x=>x.kind==='MULTISIG_INDICATOR'));
 assert(g.edges.some(x=>x.contractAddress===C&&x.controller===B&&x.cycle));
 assert(g.edges.filter(x=>x.mechanism==='SIGNER_INDICATOR').every(x=>x.verificationStatus==='OBSERVED_CONTROLLER'));
 assert(g.requests<=auth.LIMITS.requests);
});
test('a familiar controller name alone cannot match canonical provenance or an ambiguous immutable',()=>{
 const content='contract SafeProxy {}', key='contracts/proxies/SafeProxy.sol';
 const comp={name:'SafeProxy',fullyQualifiedName:key+':SafeProxy'};
 assert.equal(review.classify({[key]:{content}},comp),null);
 assert.equal(review.classify({[key]:{content}},{...comp,fullyQualifiedName:'another.sol:SafeProxy'}),null);
 assert.equal(review.immutableAddress('0x7f'+word(C).slice(2)+'7f'+word(D).slice(2),{x:[{start:1,length:32},{start:34,length:32}]}),null);
});
