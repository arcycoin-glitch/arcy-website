'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const eth=require('../search/server/lib/holders');
const robin=require('../search/server/lib/robinhood-holder-rank');
const adapter=require('../search/server/lib/robinhood-adapter');
const rhRpc=require('../search/server/lib/robinhood-rpc');

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
  const r=await robin.fetchRank(TOKEN,{block:BLOCK,totalSupplyRaw:'1000',reportedHolderCount:balances.length,...data});
  assert.equal(r.holderCount.value,balances.length);
  assert.equal(r.holderCount.status,'ONCHAIN_RECONCILED');
  assert.equal(r.top10Pct.value,100);
  assert.equal(r.top20Pct.value,100);
  assert.equal(r.largestWalletPct.value,Number(balances[0])/10);
  assert.equal(r.top20Pct.evidence[0].censusComplete,true);
  assert.equal(data.calls.filter(x=>x[0]==='pinnedRpc').length,balances.length);
 }
});
test('Robinhood pinned reader uses one provider and checks exact chain and block identity',async()=>{
 const hash='0x'+'1'.repeat(64),calls=[];
 const read=async(endpoint,method,params)=>{
  calls.push([endpoint,method]);
  if(method==='eth_chainId')return '0x1237';
  if(method==='eth_getBlockByNumber')return {number:BLOCK,hash};
  if(method==='eth_call')return '0x'+(9n).toString(16).padStart(64,'0');
  throw Error('Unexpected RPC method');
 };
 const pinned=rhRpc.createPinnedReader({endpoint:'primary',block:BLOCK,blockHash:hash,providerList:['primary','backup'],callAt:read});
 assert.equal(await pinned.read('eth_call',[]),'0x'+(9n).toString(16).padStart(64,'0'));
 assert.equal(await pinned.verify(),true);
 assert.ok(calls.filter(x=>x[1]==='eth_call').every(x=>x[0]==='primary'));
});
test('Robinhood pinned reader fails over only to a provider serving the same block hash',async()=>{
 const hash='0x'+'2'.repeat(64),calls=[];let failed=false;
 const read=async(endpoint,method,params)=>{
  calls.push([endpoint,method]);
  if(method==='eth_chainId')return '0x1237';
  if(method==='eth_getBlockByNumber')return {number:BLOCK,hash};
  if(method==='eth_call'&&endpoint==='primary'&&!failed){failed=true;throw Object.assign(Error('rate limited'),{retryable:true});}
  if(method==='eth_call')return '0x'+'0'.repeat(63)+'9';
  throw Error('Unexpected RPC method');
 };
 const pinned=rhRpc.createPinnedReader({endpoint:'primary',block:BLOCK,blockHash:hash,providerList:['primary','backup'],callAt:read});
 assert.equal(await pinned.read('eth_call',[]),'0x'+'0'.repeat(63)+'9');
 assert.ok(calls.some(x=>x[0]==='backup'&&x[1]==='eth_call'));
 assert.ok(calls.filter(x=>x[1]==='eth_call').every(x=>x[0]==='primary'||x[0]==='backup'));
});
test('Robinhood pinned reader refuses a fallback provider on a different fork',async()=>{
 const calls=[],hash='0x'+'3'.repeat(64);
 const read=async(endpoint,method)=>{
  calls.push([endpoint,method]);
  if(method==='eth_chainId')return '0x1237';
  if(method==='eth_getBlockByNumber')return {number:BLOCK,hash:endpoint==='primary'?hash:'0x'+'4'.repeat(64)};
  if(method==='eth_call')throw Object.assign(Error('unavailable'),{retryable:true});
 };
 const pinned=rhRpc.createPinnedReader({endpoint:'primary',block:BLOCK,blockHash:hash,providerList:['primary','backup'],callAt:read});
 await assert.rejects(pinned.read('eth_call',[]),/No provider can serve the pinned Robinhood block/);
 assert.equal(calls.some(x=>x[0]==='backup'&&x[1]==='eth_call'),false);
});
test('Robinhood paginates and reconciles a bounded 21-60 holder census at the pinned block',async()=>{
 const balances=Array.from({length:25},(_,i)=>BigInt(25-i));
 const base=source(balances);
 const allRows=wallets(25).map((address,i)=>({address:{hash:address},value:String(balances[i])}));
 const cursor={address_hash:allRows[19].address.hash,value:allRows[19].value,items_count:20};
 const pages=[];
 const fetcher=async url=>{
  const parsed=new URL(url);
  pages.push(parsed.href);
  return parsed.searchParams.has('address_hash')
   ?response({items:allRows.slice(20)})
   :response({items:allRows.slice(0,20),next_page_params:cursor});
 };
 let active=0,maxActive=0;
 const rpcCall=async(...args)=>{
  active++;maxActive=Math.max(maxActive,active);
  try{await new Promise(resolve=>setTimeout(resolve,1));return await base.rpcCall(...args);}
  finally{active--;}
 };
 const result=await robin.fetchRank(TOKEN,{block:BLOCK,totalSupplyRaw:'325',reportedHolderCount:25,fetcher,rpcCall});
 assert.equal(pages.length,2,'all explorer pages are fetched');
 assert.ok(maxActive<=4,'pinned RPC fanout stays within the configured limit');
 assert.equal(result.holderCount.value,25);
 assert.equal(result.holderCount.status,'ONCHAIN_RECONCILED');
 assert.equal(result.top20Pct.value,Number((310n*100n*10n**12n+325n/2n)/325n)/1e12);
 assert.equal(result.top20Pct.evidence[0].censusComplete,true);
 assert.equal(result.top20Pct.evidence[0].matchedWallets,25);
 assert.equal(result.top20Pct.evidence[0].pinnedBalanceRequests,25);
 assert.equal(result.top20Pct.evidence[0].rpcConcurrencyLimit,4);
 assert.equal(base.calls.filter(x=>x[0]==='pinnedRpc').length,25);
});
test('Robinhood incomplete bounded pagination falls back to the established source-ranked sample',async()=>{
 const balances=Array.from({length:25},(_,i)=>BigInt(25-i));
 const base=source(balances);
 const allRows=wallets(25).map((address,i)=>({address:{hash:address},value:String(balances[i])}));
 const fetcher=async url=>{
  const parsed=new URL(url);
  return parsed.searchParams.has('address_hash')
   ?response({items:allRows.slice(20)})
   :response({items:allRows.slice(0,20),next_page_params:{address_hash:allRows[19].address.hash,value:allRows[19].value,items_count:20}});
 };
 const result=await robin.fetchRank(TOKEN,{block:BLOCK,totalSupplyRaw:'400',reportedHolderCount:25,fetcher,rpcCall:base.rpcCall});
 assert.equal(result.holderCount,undefined,'non-reconciled populations are never called complete');
 assert.equal(result.top10Pct.status,'SOURCE_REPORTED_RPC_RECONCILED');
 assert.equal(result.top10Pct.evidence[0].censusComplete,false);
 assert.equal(base.calls.filter(x=>x[0]==='pinnedRpc').length,25,'no duplicate balance reads during sample fallback');
});
test('Robinhood refuses Blockscout 403 without leaking a count or issuing balance reads',async()=>{
 let rpcReads=0;
 const result=await robin.fetchRank(TOKEN,{block:BLOCK,totalSupplyRaw:'100',reportedHolderCount:25,key:'',
  fetcher:async()=>new Response('forbidden',{status:403}),rpcCall:async()=>{rpcReads++;return '0x'+'0'.repeat(64);}});
 assert.equal(result.reasonCode,'BLOCKSCOUT_HOLDERS_HTTP_403');
 assert.equal(rpcReads,0);
});
test('Robinhood mismatched counts, missing or duplicate pages, and zero extra-wallet balances never become a complete census',async()=>{
 const balances=Array.from({length:25},(_,i)=>BigInt(25-i));
 const base=source(balances),allRows=wallets(25).map((address,i)=>({address:{hash:address},value:String(balances[i])}));
 const cursor={address_hash:allRows[19].address.hash,value:allRows[19].value,items_count:20};
 const variants=[
  {reportedHolderCount:26,second:allRows.slice(20)},
  {reportedHolderCount:25,second:[allRows[0],...allRows.slice(21)]},
  {reportedHolderCount:25,second:[]}
 ];
 for(const variant of variants){
  const fetcher=async url=>new URL(url).searchParams.has('address_hash')?
   response({items:variant.second}):response({items:allRows.slice(0,20),next_page_params:cursor});
  const result=await robin.fetchRank(TOKEN,{block:BLOCK,totalSupplyRaw:'325',fetcher,
   reportedHolderCount:variant.reportedHolderCount,rpcCall:base.rpcCall});
  assert.equal(result.holderCount,undefined);
  assert.equal(result.top10Pct.status,'SOURCE_REPORTED_RPC_RECONCILED');
  assert.equal(result.top10Pct.evidence[0].censusComplete,false);
 }
 const zeroRpc=async(method,params)=>{
  const addr='0x'+String(params[0].data).slice(-40);
  if(addr===wallets(25)[24])return '0x'+'0'.repeat(64);
  return base.rpcCall(method,params);
 };
 const pageFetcher=async url=>new URL(url).searchParams.has('address_hash')?
  response({items:allRows.slice(20)}):response({items:allRows.slice(0,20),next_page_params:cursor});
 const zero=await robin.fetchRank(TOKEN,{block:BLOCK,totalSupplyRaw:'325',reportedHolderCount:25,
  fetcher:pageFetcher,rpcCall:zeroRpc});
 assert.equal(zero.holderCount,undefined);
 assert.equal(zero.top10Pct.evidence[0].censusComplete,false);
});
test('Robinhood extra-candidate RPC timeout falls back to the existing top-20 sample',async()=>{
 const balances=Array.from({length:25},(_,i)=>BigInt(25-i)),base=source(balances);
 const allRows=wallets(25).map((address,i)=>({address:{hash:address},value:String(balances[i])}));
 const cursor={address_hash:allRows[19].address.hash,value:allRows[19].value,items_count:20};
 const fetcher=async url=>new URL(url).searchParams.has('address_hash')?
  response({items:allRows.slice(20)}):response({items:allRows.slice(0,20),next_page_params:cursor});
 const rpcCall=async(method,params)=>{
  if(String(params[0].data).endsWith(wallets(25)[24].slice(2)))throw Object.assign(Error('timeout'),{name:'TimeoutError'});
  return base.rpcCall(method,params);
 };
 const result=await robin.fetchRank(TOKEN,{block:BLOCK,totalSupplyRaw:'325',reportedHolderCount:25,fetcher,rpcCall});
 assert.equal(result.holderCount,undefined);
 assert.equal(result.top20Pct.status,'SOURCE_REPORTED_RPC_RECONCILED');
 assert.equal(result.top20Pct.evidence[0].censusComplete,false);
});
test('Robinhood checks the anchored block again after all holder balance reads',async()=>{
 const balances=[600n,300n,100n],base=source(balances);let checks=0;
 const result=await robin.fetchRank(TOKEN,{block:BLOCK,totalSupplyRaw:'1000',reportedHolderCount:3,
  ...base,verifyBlock:async()=>{checks++;if(checks===2)throw Error('reorg');}});
 assert.equal(checks,2);
 assert.equal(result.reasonCode,'ROBINHOOD_BLOCK_ANCHOR_CHANGED');
 assert.equal(result.holderCount,undefined);
});
test('Robinhood complete census retains source count time separately from its RPC block',async()=>{
 const data=source([600n,300n,100n]);
 const result=await robin.fetchRank(TOKEN,{
  block:BLOCK,totalSupplyRaw:'1000',
  reportedHolderCountPromise:Promise.resolve({value:3,evidence:[{
   source:'Robinhood Blockscout',checkedAt:'2026-11-10T15:00:00.000Z',
   sourceUrl:'https://robinhoodchain.blockscout.com/api/v2/tokens/'+TOKEN+'/counters'
  }]}),
  ...data
 });
 assert.equal(result.holderCount.status,'ONCHAIN_RECONCILED');
 const proof=result.holderCount.evidence[0];
 assert.equal(proof.block,BLOCK);
 assert.equal(proof.reportedHolderCount,3);
 assert.equal(proof.reportedHolderCountSource,'Robinhood Blockscout');
 assert.equal(proof.reportedHolderCountCheckedAt,'2026-11-10T15:00:00.000Z');
 assert.equal(proof.reportedHolderCountBlockPinned,false);
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
test('Robinhood partial first page cannot become a complete census when the count is unavailable',async()=>{
 const balances=Array.from({length:10},(_,i)=>BigInt(100-i));
 const f=source(balances),original=f.fetcher;
 f.fetcher=async url=>{
  const body=await (await original(url)).json();
  return response({...body,next_page_params:{address_hash:wallets(balances.length).at(-1),value:'91',items_count:balances.length}});
 };
 const r=await robin.fetchRank(TOKEN,{block:BLOCK,totalSupplyRaw:'955',...f});
 assert.equal(r.holderCount,undefined);
 assert.equal(r.largestWalletPct.status,'SOURCE_REPORTED_RPC_RECONCILED');
 assert.equal(r.top10Pct.status,'SOURCE_REPORTED_RPC_RECONCILED');
 assert.equal(r.top20Pct,undefined);
 assert.equal(r.top10Pct.evidence[0].censusComplete,false);
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
test('Robinhood starts count and ranking concurrently and supplies count evidence to the census reader',async()=>{
 const count=require('../search/server/lib/robinhood-holder-count');
 const plus=require('../search/server/lib/goplus-evidence');
 const saved=[count.fetchCount,plus.inspectHolders,robin.fetchRank];
 let finishCount,rankStarted=false,receivedCount;
 try{
  count.fetchCount=()=>new Promise(resolve=>{finishCount=resolve});
  plus.inspectHolders=async()=>({});
  robin.fetchRank=async(_address,options)=>{
   rankStarted=true;
   receivedCount=await options.reportedHolderCountPromise;
   return {};
  };
  const pending=adapter.holder({address:TOKEN,base:{block:BLOCK,totalSupplyRaw:'1000'}});
  assert.equal(rankStarted,true,'rank request starts before count resolves');
  finishCount({value:42,status:'SOURCE_REPORTED',dataState:'DATA_FOUND'});
  await pending;
  assert.equal(receivedCount.value,42);
 }finally{
  count.fetchCount=saved[0];plus.inspectHolders=saved[1];robin.fetchRank=saved[2];
 }
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
