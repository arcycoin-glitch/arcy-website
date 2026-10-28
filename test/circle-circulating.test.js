'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const m=require('../search/server/lib/circle-circulating');
const now=Date.parse('2026-10-28T10:00:00Z'),options={address:m.TOKEN,totalSupply:'1000',block:'0x123',now};
const body=()=>({data:[{name:'USD Coin',symbol:'USDC',totalAmount:'999999',chains:[{chain:'ETH',amount:'900.123456',updateDate:'2026-10-28T09:00:00.000Z'},{chain:'ARC',amount:'50',updateDate:'2026-10-28T09:00:00.000Z'}]}]});
test('Circle exact Ethereum circulation preserves decimal and source time without asserting pinned on-chain circulation',()=>{
 const f=m.parse(body(),options);assert.equal(f.value,'900.123456');assert.equal(f.status,'SOURCE_REPORTED');assert.equal(f.chainId,1);assert.equal(f.evidence[0].address,m.TOKEN);assert.equal(f.evidence[0].block,undefined);assert.equal(f.evidence[0].rpcComparisonBlock,'0x123');assert.equal(f.freshness.ageMs,3600000);
});
test('Circle rejects foreign contract/chain, missing block and ambiguous symbol/chain rows',()=>{
 for(const change of [{address:'0x'+'1'.repeat(40)},{network:'arc'},{chainId:4663},{block:'latest'}])assert.equal(m.parse(body(),{...options,...change}).value,null);
 for(const mutate of [b=>b.data.push(b.data[0]),b=>b.data[0].chains.push(b.data[0].chains[0]),b=>b.data[0].name='Fake',b=>b.data[0].chains.shift()]){const b=body();mutate(b);assert.equal(m.parse(b,options).value,null);}
});
test('Circle rejects stale/future publication, invalid decimals, uint overflow and numeric coercion',()=>{
 for(const amount of [(1n<<256n).toString(),'0','-1','1e3','0.0000001',900,NaN,null]){const b=body();b.data[0].chains[0].amount=amount;assert.equal(m.parse(b,options).value,null);}
 for(const date of ['2026-10-26T09:00:00Z','2026-10-28T10:02:00Z','2026-10-28','bad']){const b=body();b.data[0].chains[0].updateDate=date;assert.equal(m.parse(b,options).value,null);}
});
test('different-time issuer supply may exceed RPC after redemptions without being labelled reconciled',()=>{
 const f=m.parse(body(),{...options,totalSupply:'800'});assert.equal(f.value,'900.123456');assert.equal(f.status,'SOURCE_REPORTED');assert.equal(f.evidence[0].issuerMinusRpcRaw,'100123456');assert.equal(f.evidence[0].block,undefined);
});
test('wrong-chain and unrelated token requests never fetch Circle; provider errors stay unknown and sanitized',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('private-url');};
 assert.equal(await m.inspect('0x'+'1'.repeat(40),'1000',{fetcher}),null);
 assert.equal((await m.inspect(m.TOKEN,'1000',{fetcher,network:'robinhood'})).value,null);assert.equal(calls,0);
 const f=await m.inspect(m.TOKEN,'1000',{...options,fetcher});assert.equal(f.dataState,'SOURCE_API_FAILED');assert.equal(f.value,null);assert(!JSON.stringify(f).includes('private-url'));
});
test('existing circulation entry point uses Circle and retains licensed-source gates for other tokens',async()=>{
 const c=require('../search/server/lib/circulating');
 const f=await c.inspect(m.TOKEN,'1000',{...options,fetcher:async()=>new Response(JSON.stringify(body()))});
 assert.equal(f.value,'900.123456');assert.equal(f.status,'SOURCE_REPORTED');
 const tether=await c.inspect(require('../search/server/lib/issuer-circulating').TOKEN,'1000',{env:{},block:'0x123'});assert.equal(tether.reasonCode,'ISSUER_CIRCULATION_PERMISSION_REQUIRED');
});
