const test=require('node:test'),assert=require('node:assert/strict'),runtime=require('../lib/mechanics-runtime'),c=require('../lib/core'),summary=require('../lib/contract-summary'),source=require('../lib/verified-source');
const a='0x'+'1'.repeat(40),block='0x42',digest='2fe87a0ede258f1d3827f837a1a42c860542e346867f64fe5c89fdb7feefe90b';
test('non-proxy proof rejects delegation, destruction, truncated PUSH and unsupported formats',()=>{
 for(const code of ['0x60f400','0x61f2ff00','0x6001600055'])assert.equal(runtime.nonDelegating(code),true);
 for(const code of ['0xf4','0xf2','0xff','0x6000f4','0x61ff','0xef0001','0x','0xzz'])assert.equal(runtime.nonDelegating(code),false);
});
test('unreachable data is excluded only by EVM termination and valid jump-destination rules',()=>{
 for(const code of ['0x00f4','0xf3f2','0xfdf4','0xfef4','0x56f4','0x00605bf4'])assert.equal(runtime.nonDelegating(code),true);
 for(const code of ['0x005bf4','0xfe5bf2','0x565bff','0x575bf4','0x5f57f4'])assert.equal(runtime.nonDelegating(code),false);
});
async function fixture(pool,fn){const old=[c.rpc,c.call];try{c.rpc=async(method,params)=>{assert.equal(method,'eth_getCode');assert.deepEqual(params,[a,block]);return '0x600100';};c.call=async(address,data,pinned)=>{assert.equal(address,a);assert.equal(pinned,block);return '0x'+BigInt(pool).toString(16).padStart(64,'0');};await fn();}finally{[c.rpc,c.call]=old;}}
const base=()=>({block,proxy:c.unknown(),owner:c.unknown(),admin:c.unknown(),verifiedSource:{profile:source.profiles[digest],sourceDigest:digest,runtimeMatch:'match'}});
test('reviewed constructor-only family closes launch authority only after pool registration',async()=>fixture(5,async()=>{const r=await runtime.enrich(base(),a),f=summary.present(r).contractFields;assert.equal(f.mint.status,'NOT_DETECTED');assert.equal(f.ownerAdmin.status,'NOT_DETECTED');assert.equal(f.proxyUpgradeable.status,'NOT_DETECTED');for(const key of ['buyTax','sellTax','transferTax']){assert.equal(f[key].value,0);assert.equal(f[key].status,'VERIFIED');assert.equal(f[key].evidence[0].block,block);assert.match(f[key].scope,/not DEX/);}}));
test('pending one-time authority and unreviewed contracts remain unknown',async()=>fixture(0,async()=>{const r=await runtime.enrich(base(),a);assert.equal(summary.present(r).contractFields.ownerAdmin.status,'NOT_VERIFIED');const b=base();b.verifiedSource.profile=null;const unknown=await runtime.enrich(b,a);assert.equal(unknown.mint,undefined);assert.equal(unknown.buyTax,undefined);}));
test('RPC failure cannot establish architecture or overwrite an established proxy',async()=>{const old=c.rpc;try{c.rpc=async()=>{throw Object.assign(Error(),{httpStatus:429});};const b=base();b.verifiedSource.profile=null;const r=await runtime.enrich(b,a);assert.equal(r.proxy.value,null);assert.equal(r.architectureReadFailure.httpStatus,429);const p={...b,proxy:c.fact(a,[{block}],'DETECTED')};assert.equal((await runtime.enrich(p,a)).proxy.value,a);}finally{c.rpc=old;}});
