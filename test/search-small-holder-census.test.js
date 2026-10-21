'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const eth=require('../search/server/lib/holders');
const robin=require('../search/server/lib/robinhood-holder-rank');
const adapter=require('../search/server/lib/robinhood-adapter');

const TOKEN='0x'+'a'.repeat(40), BLOCK='0x1234';
const wallets=n=>Array.from({length:n},(_,i)=>'0x'+(i+1).toString(16).padStart(40,'0'));
const response=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}});
function source(balances){
 const rows=wallets(balances.length).map((addr,i)=>({address:{hash:addr},value:String(balances[i])}));
 const amounts=new Map(rows.map(row=>[row.address.hash,BigInt(row.value)]));
 const calls=[];
 const fetcher=async url=>{calls.push(['explorer',url]);return response({items:rows})};
 const rpcCall=async(method,params)=>{
  assert.equal(method,'eth_call');assert.equal(params[1],BLOCK);
  const word=String(params[0].data);
  assert.match(word,/^0x70a08231[0-9a-f]{64}$/);
  const addr='0x'+word.slice(-40);
  calls.push(['pinnedRpc',addr]);
  return '0x'+(amounts.get(addr)||0n).toString(16).padStart(64,'0');
 };
 return {fetcher,rpcCall,calls};
}

test('Ethereum 1, 3, 9 and 19 holder cohorts produce 4 sourced fields only after exact supply reconciliation',()=>{
 for(const n of [1,3,9,19]){
  const addresses=wallets(n), balances=Array.from({length:n},(_,i)=>BigInt(n-i));
  const supply=balances.reduce((a,b)=>a+b,0n);
  const result=eth.calculate(addresses,balances,supply,n,BLOCK,TOKEN);
  assert.equal(result.fields.holderCount.value,n);
  assert.equal(result.fields.top20Pct.value,100);
  assert.equal(result.fields.top10Pct.value,n<=10?100:eth.pct(balances.slice(0,10).reduce((a,b)=>a+b,0n),supply));
  assert.equal(result.fields.largestWalletPct.value,eth.pct(balances[0],supply));
  assert.ok(Object.values(result.fields).every(x=>x.dataState==='DATA_FOUND'));
 }
});
test('Ethereum never turns a missing wallet, duplicate, or zero balance into a verified small-holder census',()=>{
 for(const [addrs,balances,total] of [
  [wallets(2),[600n,300n],1000n],
  [[wallets(2)[0],wallets(2)[0]],[500n,500n],1000n],
  [wallets(2),[1000n,0n],1000n]
 ]){
  const r=eth.calculate(addrs,balances,total,2,BLOCK,TOKEN);
  assert.ok(Object.values(r.fields).every(f=>f.dataState!=='DATA_FOUND'));
 }
});
test('Ethereum end-to-end adapter recovers four source-backed fields for fewer than twenty wallets',async()=>{
 const r=await eth.inspect(TOKEN,BLOCK,'1000',{
  getCounters:async()=>({token_holders_count:'2'}),
  getPages:async()=>wallets(2),
  getBalances:async()=>[600n,400n]
 });
 assert.equal(r.fields.holderCount.value,2);
 assert.equal(r.fields.largestWalletPct.value,60);
 assert.equal(r.fields.top10Pct.value,100);
 assert.equal(r.fields.top20Pct.value,100);
 assert.equal(r.fields.holderCount.status,'RECONCILED_SNAPSHOT');
});
test('Ethereum retains only the explorer-reported holder count if pinned balances are incomplete or fail',async()=>{
 const scenarios=[
  {getPages:async()=>wallets(2),getBalances:async()=>[600n,300n]},
  {getPages:async()=>{throw Error('Explorer refused page')},getBalances:async()=>[]},
  {getPages:async()=>wallets(2),getBalances:async()=>{throw Error('Pinned RPC timeout')}}
 ];
 for(const scenario of scenarios){
  const r=await eth.inspect(TOKEN,BLOCK,'1000',{getCounters:async()=>({token_holders_count:2}),...scenario});
  assert.equal(r.fields.holderCount.value,2);
  assert.equal(r.fields.holderCount.status,'SOURCE_REPORTED');
  for(const key of ['largestWalletPct','top10Pct','top20Pct'])
   assert.notEqual(r.fields[key].dataState,'DATA_FOUND',key);
 }
 const down=await eth.inspect(TOKEN,BLOCK,'1000',{getCounters:async()=>{throw Error('No explorer count')}});
 assert.equal(down.fields.holderCount.dataState,'SOURCE_API_FAILED');
});
test('Robinhood small wallet cohort calculates 100% top 10/20 and exact reconciled count',async()=>{
 for(const balances of [[1000n],[600n,300n,100n],[400n,200n,100n,100n,80n,40n,40n,20n,10n,10n]]){
  const data=source(balances);
  const r=await robin.fetchRank(TOKEN,{block:BLOCK,totalSupplyRaw:'1000',...data});
  assert.equal(r.holderCount.value,balances.length);
  assert.equal(r.holderCount.status,'ONCHAIN_RECONCILED');
  assert.equal(r.top10Pct.value,100);
  assert.equal(r.top20Pct.value,100);
  assert.equal(r.largestWalletPct.value,Number(balances[0])/10);
  assert.equal(r.top20Pct.evidence[0].censusComplete,true);
  assert.equal(data.calls.filter(x=>x[0]==='pinnedRpc').length,balances.length);
 }
});
test('Robinhood incomplete, non-reconciled, or stale small cohorts fail closed',async()=>{
 const incomplete=source([600n,300n,50n]);
 const r=await robin.fetchRank(TOKEN,{block:BLOCK,totalSupplyRaw:'1000',...incomplete});
 assert.equal(r.reasonCode,'BLOCKSCOUT_RANK_BELOW_TEN_ROWS');
 assert.equal(r.holderCount,undefined);
 const stale=source([600n,300n,100n]);
 stale.rpcCall=async()=>('0x'+(900n).toString(16).padStart(64,'0'));
 const bad=await robin.fetchRank(TOKEN,{block:BLOCK,totalSupplyRaw:'1000',...stale});
 assert.equal(bad.reasonCode,'BLOCKSCOUT_RANK_SUPPLY_RECONCILIATION_FAILED'); // Pinned values exceed total supply; fail closed.
});
test('Robinhood 10+ indexed candidate wallets preserve partial concentration without asserting complete top 20',async()=>{
 const balances=Array.from({length:10},(_,i)=>BigInt(100-i));
 const f=source(balances);
 const r=await robin.fetchRank(TOKEN,{block:BLOCK,totalSupplyRaw:'2000',...f});
 assert.equal(r.holderCount,undefined);
 assert.equal(r.top20Pct,undefined);
 assert.equal(r.top10Pct.dataState,'DATA_FOUND');
 assert.equal(r.top10Pct.status,'SOURCE_REPORTED_RPC_RECONCILED');
 assert.equal(r.top10Pct.evidence[0].censusComplete,false);
});
test('Robinhood adapter gives complete RPC-reconciled holder count priority over a divergent live Blockscout count',async()=>{
 const count=require('../search/server/lib/robinhood-holder-count');
 const plus=require('../search/server/lib/goplus-evidence');
 const saved=[count.fetchCount,plus.inspectHolders,robin.fetchRank];
 try{
  count.fetchCount=async()=>({value:77,status:'SOURCE_REPORTED',dataState:'DATA_FOUND'});
  plus.inspectHolders=async()=>({});
  robin.fetchRank=async()=>({
   holderCount:{value:3,status:'ONCHAIN_RECONCILED',dataState:'DATA_FOUND',source:'Robinhood RPC + Blockscout'},
   largestWalletPct:{value:60,status:'ONCHAIN_RECONCILED',dataState:'DATA_FOUND',source:'Robinhood RPC + Blockscout'},
   top10Pct:{value:100,status:'ONCHAIN_RECONCILED',dataState:'DATA_FOUND',source:'Robinhood RPC + Blockscout'},
   top20Pct:{value:100,status:'ONCHAIN_RECONCILED',dataState:'DATA_FOUND',source:'Robinhood RPC + Blockscout'}
  });
  const card=await adapter.holder({address:TOKEN,base:{block:BLOCK,totalSupplyRaw:'1000'}});
  assert.equal(card.fields.holderCount.value,3);
  assert.equal(card.fields.top20Pct.value,100);
  assert.match(card.description,/Full Robinhood positive-balance holder census/);
 }finally{
  count.fetchCount=saved[0];plus.inspectHolders=saved[1];robin.fetchRank=saved[2];
 }
});
