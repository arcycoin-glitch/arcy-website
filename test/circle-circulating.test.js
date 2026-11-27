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

// #335: exact-contract expansion. Identities from Circle's contract-address tables (mainnet section) and
// pinned on-chain eth_chainId/symbol()/decimals(), CI run of scripts/probe-issuer-circulation.cjs.
const multi=()=>({data:[
 {name:'USD Coin',symbol:'USDC',chains:[{chain:'ETH',amount:'900.5',updateDate:'2026-10-28T09:00:00.000Z'},{chain:'ARC',amount:'50',updateDate:'2026-10-28T09:00:00.000Z'}]},
 {name:'Euro Coin',symbol:'EURC',chains:[{chain:'ETH',amount:'319645602.321356',updateDate:'2026-10-28T09:22:02.075Z'},{chain:'ARC',amount:'12047737.178198',updateDate:'2026-10-28T09:22:02.075Z'}]}]});
const EURC_ETH='0x1abaea1f7c830bd89acc67ec4af516284b1bc33c',USDC_ARC='0x3600000000000000000000000000000000000000',EURC_ARC='0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1';
test('EURC Ethereum and Circle Arc USDC/EURC map only to their own chain row and contract',()=>{
 const e=m.parse(multi(),{...options,address:EURC_ETH,totalSupply:'319645602.321356'});
 assert.equal(e.value,'319645602.321356');assert.equal(e.evidence[0].sourceChain,'ETH');assert.equal(e.evidence[0].issuerMinusRpcRaw,'0');assert.match(e.evidence[0].identitySourceUrl,/eurc-contract-addresses/);
 const u=m.parse(multi(),{...options,address:USDC_ARC,network:'arc',chainId:5042,totalSupply:'60'});
 assert.equal(u.value,'50');assert.equal(u.evidence[0].chainId,5042);assert.equal(u.evidence[0].sourceChain,'ARC');
 const a=m.parse(multi(),{...options,address:EURC_ARC,network:'arc',chainId:5042,totalSupply:'12057737.178198'});
 assert.equal(a.value,'12047737.178198');assert.equal(a.evidence[0].issuerMinusRpcRaw,'-10000000000','issuer figure (10,000 EURC) below totalSupply is reported, never reconciled away');
 for(const [address,network,chainId] of [[EURC_ETH,'arc',5042],[USDC_ARC,'ethereum',1],[EURC_ARC,'robinhood',4663],[m.TOKEN,'arc',5042]])
  assert.equal(m.parse(multi(),{...options,address,network,chainId}).value,null,address+' on '+network);
 const swapped=multi();[swapped.data[0].symbol,swapped.data[1].symbol]=['EURC','USDC'];
 assert.equal(m.parse(swapped,{...options,address:EURC_ETH}).value,null,'symbol/name pair must both match');
});
test('Arc adapter: Circle contracts get issuer circulation, any other Arc token keeps NOT_VERIFIED without fetching',async()=>{
 assert.equal(await m.inspect('0x'+'7'.repeat(40),'1',{network:'arc',chainId:5042,block:'0x1'}),null);
 assert.equal((await m.inspect(EURC_ETH,'1',{network:'arc',chainId:5042,block:'0x1',fetcher:async()=>{throw Error('must not fetch');}})).reasonCode,'SOURCE_CHAIN_MISMATCH');
 const f=await m.inspect(USDC_ARC,'60',{network:'arc',chainId:5042,block:'0x1',now,fetcher:async()=>new Response(JSON.stringify(multi()))});
 assert.equal(f.value,'50','same Circle ARC row (reader cache is shared within the process)');assert.equal(f.status,'SOURCE_REPORTED');
 assert.equal(m.MAPPINGS.length,4);assert(Object.isFrozen(m.MAPPINGS));
});

// Production regression: the full Search supply formatter must accept exact Arc issuer identity,
// retain the source-reported status, and still reject cross-chain and wrong-token evidence.
test('Circle exact mapping survives Search supply context identity checks',()=>{
 const {formatCard}=require('../search/server/lib/data-engine'),{chain}=require('../search/server/lib/chains');
 for(const map of m.MAPPINGS){
  const ctx={address:map.address,block:options.block};
  const f=m.parse(multi(),{...options,address:map.address,network:map.network,chainId:map.chainId});
  assert.equal(f.chainId,map.chainId);assert.equal(f.network,map.network);
  const raw={fields:{circulatingSupply:f}};
  const accepted=formatCard('supply',raw,chain(map.network),ctx).context.circulatingSupply;
  assert.equal(accepted.dataState,'DATA_FOUND');assert.equal(accepted.status,'SOURCE_REPORTED');assert.equal(accepted.value,f.value);
  const foreign=map.network==='arc'?'ethereum':'arc';
  assert.equal(formatCard('supply',raw,chain(foreign),ctx).context.circulatingSupply.reasonCode,'SOURCE_IDENTITY_MISMATCH');
  assert.equal(formatCard('supply',raw,chain(map.network),{...ctx,address:'0x'+'1'.repeat(40)}).context.circulatingSupply.reasonCode,'SUPPLY_CONTEXT_TOKEN_MISMATCH');
 }
});
