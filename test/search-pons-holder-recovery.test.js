'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const count=require('../search/server/lib/robinhood-holder-count');
const rank=require('../search/server/lib/robinhood-holder-rank');
const adapter=require('../search/server/lib/robinhood-adapter');
const plus=require('../search/server/lib/goplus-evidence');
const PONS='0x39dbed3a2bd333467115de45665cc57f813c4571';
const BLOCK='0x1234';
const wallet=i=>'0x'+i.toString(16).padStart(40,'0');
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
const http403=()=>new Response('denied',{status:403});
function rpcBalances(balances,seen=[]){
 return async(method,params)=>{
  assert.equal(method,'eth_call');assert.equal(params[1],BLOCK);
  const address='0x'+params[0].data.slice(-40);
  seen.push(address);
  return '0x'+(balances.get(address)||0n).toString(16).padStart(64,'0');
 };
}
test('PONS exact-contract Robinhood count falls back from blocked counters to token metadata',async()=>{
 const urls=[];
 const found=await count.fetchCount(PONS,{key:'',fetcher:async url=>{
  urls.push(url);
  return url.endsWith('/counters')?http403():json({address:PONS.toUpperCase(),holders_count:'104335'});
 }});
 assert.deepEqual(urls.map(u=>u.includes('/counters')), [true,false]);
 assert.equal(found.value,104335);assert.equal(found.status,'SOURCE_REPORTED');
 assert.equal(found.chainId,4663);assert.equal(found.evidence[0].contract,PONS);
 assert.ok(!found.evidence[0].sourceUrl.includes('apikey='));
});
test('PONS count refuses mismatched contract and unsupported holder values',async()=>{
 for(const body of [{address:wallet(3),holders_count:9000},{address:PONS,holders_count:'0'},
                    {address:PONS,holders_count:'1e6'},{address:PONS,holders_count:1.5}]){
  const r=await count.fetchCount(PONS,{key:'',fetcher:async()=>json(body)});
  assert.equal(r,null);
 }
});
test('PONS 20 source-ranked wallets may drift at explorer height; pinned RPC metrics use only real block balances',async()=>{
 const addresses=Array.from({length:20},(_,i)=>wallet(i+1));
 const explorer=addresses.map((a,i)=>({address:{hash:a},value:String(200-i)}));
 const pinned=new Map(addresses.map((a,i)=>[a,BigInt(100+i)]));
 const seen=[];const report=await rank.fetchRank(PONS,{block:BLOCK,totalSupplyRaw:'5000',
  fetcher:async()=>json({items:explorer}),rpcCall:rpcBalances(pinned,seen)});
 assert.equal(seen.length,20);
 assert.equal(report.reasonCode,undefined);
 assert.equal(report.holderCount,undefined);
 assert.equal(report.top20Pct.status,'SOURCE_REPORTED_RPC_RECONCILED');
 assert.equal(report.top20Pct.evidence[0].sourceRankCompleteness,'SOURCE_REPORTED');
 assert.equal(report.top20Pct.evidence[0].explorerBalanceAtDifferentBlockIgnored,true);
 assert.equal(report.largestWalletPct.value,199/50);
 assert.equal(report.top10Pct.value,38.9);
 assert.equal(report.top20Pct.value,43.8);
 assert.match(report.top10Pct.evidence[0].scope,/may OMIT higher-ranked wallets/);
});
test('PONS pinned RPC unavailable or invalid source rows cannot generate concentration',async()=>{
 const addresses=Array.from({length:20},(_,i)=>wallet(i+1));
 const items=addresses.map((a,i)=>({address:a,value:String(200-i)}));
 const zero=await rank.fetchRank(PONS,{block:BLOCK,totalSupplyRaw:'5000',
  fetcher:async()=>json({items}),rpcCall:async()=>('0x'+'0'.repeat(64))});
 assert.equal(zero.reasonCode,'BLOCKSCOUT_RANK_RPC_RECONCILIATION_FAILED');
 const duplicates=await rank.fetchRank(PONS,{block:BLOCK,totalSupplyRaw:'5000',
  fetcher:async()=>json({items:[...items.slice(0,19),items[0]]})});
 assert.equal(duplicates.reasonCode,'BLOCKSCOUT_HOLDERS_SCHEMA_INVALID');
});
test('Robinhood keeps independent source-backed count and sample if Blockscout rank fails',async()=>{
 const old=[count.fetchCount,plus.inspectHolders,rank.fetchRank];
 try{
  count.fetchCount=async()=>({value:104335,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',source:'Blockscout',network:'robinhood',chainId:4663,evidence:[{contract:PONS}]});
  plus.inspectHolders=async()=>({top10Pct:{value:5,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',source:'Separate source',network:'robinhood',chainId:4663,evidence:[{address:PONS}]}});
  rank.fetchRank=async()=>({reasonCode:'BLOCKSCOUT_HOLDERS_HTTP_403'});
  const c=await adapter.holder({address:PONS,base:{block:BLOCK,totalSupplyRaw:'5000'}});
  assert.equal(c.fields.holderCount.value,104335);assert.equal(c.fields.top10Pct.value,5);
  assert.equal(c.fields.top20Pct.value,null);
 }finally{[count.fetchCount,plus.inspectHolders,rank.fetchRank]=old;}
});
