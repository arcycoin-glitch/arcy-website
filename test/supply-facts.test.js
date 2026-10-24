const {test}=require('node:test');
const assert=require('node:assert/strict');
const c=require('../lib/core');
const verified=require('../lib/verified-source');
const runtime=require('../lib/mechanics-runtime');
const facts=require('../lib/supply-facts');
const address='0x'+'e'.repeat(40);
const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const originals={context:c.context,call:c.call,lookup:verified.lookup,nonDelegating:runtime.nonDelegating};
function setup({immutable=true,profile='FIXED_SUPPLY_CAPPED_ERC20',match='exact_match',sourceAddress=address}={}){
 c.context=async()=>({block:'0x555',code:'0x6000'});
 c.call=async (to,selector,block)=>{assert.equal(to,address);assert.equal(selector,'0x18160ddd');assert.equal(block,'0x555');return word(100000);};
 runtime.nonDelegating=()=>immutable;
 verified.lookup=async()=>({dataState:'DATA_FOUND',address:sourceAddress,runtimeMatch:match,sourceDigest:'reviewed-digest',profile:{id:profile}});
}
function restore(){Object.assign(c,{context:originals.context,call:originals.call});verified.lookup=originals.lookup;runtime.nonDelegating=originals.nonDelegating;}
test('immutable exact source with reviewed fixed-supply nonburnable profile proves exactly zero supply burns',async()=>{
 setup();try{const result=await facts.verifiedSupplyBurned(address);
 assert.equal(result.value,'0');assert.equal(result.status,'ONCHAIN_VERIFIED');assert.equal(result.dataState,'DATA_FOUND');
 assert.ok(result.evidence.some(e=>e.method.includes('totalSupply()')&&e.totalSupplyRaw==='100000'));
 assert.match(result.evidence[0].scope,/dead custody/);
 }finally{restore();}
});
test('proxy, wrong runtime profile, wrong source address or unverifiable source cannot manufacture zero burns',async()=>{
 for(const opts of [{immutable:false},{profile:'FIAT_TOKEN_V2_2'},{profile:null},{match:'partial_match'},{sourceAddress:'0x'+'f'.repeat(40)}]){
  setup(opts);try{const result=await facts.verifiedSupplyBurned(address);assert.equal(result.value,null);assert.equal(result.status,'NOT_VERIFIED');}finally{restore();}
 }
});
test('failed totalSupply RPC cannot masquerade as proved zero burns',async()=>{
 setup();c.call=async()=>{throw Object.assign(Error('RPC failure'),{httpStatus:429});};
 try{const r=await facts.safelyVerifiedSupplyBurned(address);assert.equal(r.value,null);assert.equal(r.status,'NOT_VERIFIED');assert.equal(r.dataState,'SOURCE_API_FAILED');}finally{restore();}
});
