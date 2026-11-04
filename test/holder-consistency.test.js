'use strict';
// Workstream C: one holder methodology across every source that can fill the Holder & Whale card.
const {test}=require('node:test'),assert=require('node:assert/strict');
const gp=require('../search/server/lib/goplus-evidence'),A=require('../search/server/lib/holder-attribution');
const TSLA='0x'+'ab'.repeat(20),DEAD='0x'+'0'.repeat(36)+'dead',ZERO='0x'+'0'.repeat(40),w=i=>'0x'+(i+1).toString(16).padStart(40,'0');
const body=(holders,count='1000')=>({code:1,result:{[TSLA]:{holder_count:count,holders}}});
// Match the provider chain tag used by the existing fixture helper.
function response(holders,count){const r=body(holders,count);return {...r,chain_id:'4663',chainId:'4663'};}
function parse(holders,count){return gp.parseHolders(Object.assign(response(holders,count)),'robinhood',TSLA);}

test('GoPlus fallback: 0xdead at 50% is never the largest wallet; top 10 withheld with a reason when burn takes a slot',()=>{
 const rows=[{address:DEAD,percent:'0.5'},...Array.from({length:9},(_,i)=>({address:w(i),percent:(0.05-i*0.001).toFixed(6)}))];
 const out=parse(rows);
 if(out.holderCount.dataState!=='DATA_FOUND')return assert.fail('fixture chain identity rejected');
 assert.equal(out.largestWalletPct.value,5,'first real wallet');assert.match(out.largestWalletPct.evidence[0].method,/0xdead excluded/);
 assert.match(out.largestWalletPct.evidence[0].scope,new RegExp(DEAD));
 assert.equal(out.top10Pct.dataState,'NOT_VERIFIED');assert.equal(out.top10Pct.reasonCode,'BURN_EXCLUSION_RANK_INCOMPLETE');
});
test('GoPlus fallback without burn rows is unchanged; a burn row out of order still fails closed',()=>{
 const rows=Array.from({length:10},(_,i)=>({address:w(i),percent:(0.2/(i+1)).toFixed(12)}));
 const out=parse(rows);assert.equal(out.largestWalletPct.value,20);assert.equal(out.top10Pct.dataState,'DATA_FOUND');
 const bad=[{address:w(0),percent:'0.1'},{address:DEAD,percent:'0.3'}];
 assert.equal(parse(bad).largestWalletPct.dataState,'NOT_VERIFIED','source ordering is validated across burn rows too');
 assert.equal(parse([{address:ZERO,percent:'0.9'}]).largestWalletPct.dataState,'NOT_VERIFIED','burn-only list ranks nothing');
});
test('every concentration path (Arc worker, ETH census, ETH ranked, Robinhood ranked, GoPlus) uses the same burn rule',()=>{
 const fs=require('node:fs'),path=require('node:path'),read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
 assert.match(read('lib/holder-index.js'),/!c\.BURNS\.includes\(x\.address\)/,'Arc worker ranks non-burn balances only');
 for(const f of ['search/server/lib/holders.js','search/server/lib/large-holders.js','search/server/lib/robinhood-holder-rank.js','search/server/lib/goplus-evidence.js'])assert.match(read(f),/isBurn/,f);
 assert.deepEqual([A.isBurn(DEAD),A.isBurn(ZERO),A.isBurn(w(1))],[true,true,false]);
 assert.deepEqual(require('../lib/core').BURNS.map(x=>x.toLowerCase()).sort(),[DEAD,ZERO].sort(),'Arc worker and Search share the same two burn addresses');
});
