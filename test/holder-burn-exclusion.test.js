'use strict';
// Burn custody (zero / 0xdead) is never ranked as a whale on Ethereum or Robinhood, matching the Arc holder worker.
// Denominator stays totalSupply(); full-supply reconciliation still includes burn balances.
const {test}=require('node:test'),assert=require('node:assert/strict');
const small=require('../search/server/lib/holders'),large=require('../search/server/lib/large-holders'),rh=require('../search/server/lib/robinhood-holder-rank'),A=require('../search/server/lib/holder-attribution');
const TOKEN='0x'+'f'.repeat(40),DEAD='0x'+'0'.repeat(36)+'dead',ZERO='0x'+'0'.repeat(40),BLOCK='0x1234';
const w=i=>'0x'+(i+1).toString(16).padStart(40,'0');

test('isBurn recognises only zero and 0xdead, case-insensitively',()=>{
 assert.equal(A.isBurn(DEAD),true);assert.equal(A.isBurn(DEAD.toUpperCase().replace('0X','0x')),true);assert.equal(A.isBurn(ZERO),true);
 assert.equal(A.isBurn(w(1)),false);assert.equal(A.isBurn(null),false);
});

test('Ethereum small census: 0xdead holding 60% is not the largest wallet; supply still reconciles with burn included',()=>{
 const r=small.calculate([DEAD,w(1),w(2)],[600n,300n,100n],1000n,3,BLOCK,TOKEN);
 assert.equal(r.fields.largestWalletPct.value,30,'largest real wallet, not the burn address');
 assert.equal(r.fields.top10Pct.value,40);assert.equal(r.fields.top20Pct.value,40);
 assert.equal(r.fields.holderCount.value,3,'published holder count is unchanged (explorer-defined)');
 const ev=r.fields.top10Pct.evidence[0];
 assert.deepEqual(ev.excludedFromConcentration,[{address:DEAD,balanceRaw:'600',role:'BURN_ADDRESS'}]);
 assert.equal(ev.holderCountIncludesBurnAddresses,true);assert.match(ev.concentrationDenominator,/totalSupply/);
 assert.match(ev.walletClassification,/NOT classified/);
 // Reconciliation is still exact: dropping the burn balance from the inventory must fail closed.
 assert.equal(small.calculate([w(1),w(2)],[300n,100n],1000n,2,BLOCK,TOKEN).fields.top10Pct.dataState,'NOT_VERIFIED');
});

test('Ethereum small census: no burn holder → identical values to the previous calculation',()=>{
 const r=small.calculate([w(1),w(2)],[700n,300n],1000n,2,BLOCK,TOKEN);
 assert.equal(r.fields.largestWalletPct.value,70);assert.equal(r.fields.top10Pct.value,100);
 assert.deepEqual(r.fields.top10Pct.evidence[0].excludedFromConcentration,[]);
});

test('Ethereum small census: only burn custody → honest unavailable, never a 0% or 100% whale',()=>{
 const r=small.calculate([DEAD],[1000n],1000n,1,BLOCK,TOKEN);
 assert.equal(r.fields.largestWalletPct.dataState,'NOT_VERIFIED');assert.equal(r.fields.largestWalletPct.reasonCode,'NO_NON_BURN_HOLDERS');
});

test('Ethereum ranked candidates: burn row is skipped; top 20 withheld when fewer than 20 non-burn wallets remain',()=>{
 const rows=[{address:{hash:DEAD},value:'5000'},...Array.from({length:20},(_,i)=>({address:{hash:w(i)},value:String(200-i)}))];
 const page=large.parsePage({items:rows},TOKEN);assert.equal(page.ok,true);
 const balances=[5000n,...Array.from({length:20},(_,i)=>BigInt(200-i))];
 const r=large.evaluate(page,balances,100000n,BLOCK,TOKEN,1000);
 assert.equal(r.ok,true);
 assert.equal(r.fields.largestWalletPct.value,0.2,'200/100000, not the 5000 burn balance');
 assert.equal(r.fields.top20Pct.dataState,'DATA_FOUND','exactly 20 non-burn wallets remain');
 assert.equal(r.fields.top20Pct.evidence[0].excludedFromConcentration[0].address,DEAD);
 // Two burn rows among 21 candidates → 19 wallets → top20 withheld with a reason, top10 still published.
 const rows2=[{address:{hash:DEAD},value:'5000'},{address:{hash:ZERO},value:'4000'},...Array.from({length:19},(_,i)=>({address:{hash:w(i)},value:String(200-i)}))];
 const r2=large.evaluate(large.parsePage({items:rows2},TOKEN),[5000n,4000n,...Array.from({length:19},(_,i)=>BigInt(200-i))],100000n,BLOCK,TOKEN,1000);
 assert.equal(r2.ok,true);assert.equal(r2.fields.top10Pct.dataState,'DATA_FOUND');
 assert.equal(r2.fields.top20Pct.dataState,'NOT_VERIFIED');assert.equal(r2.fields.top20Pct.reasonCode,'BURN_EXCLUSION_RANK_INCOMPLETE');
 assert.equal(r2.holderCandidates.find(c=>c.address===DEAD).role,'BURN_ADDRESS','candidate list keeps the labelled burn row');
});

test('Robinhood ranked candidates: burn custody excluded from concentration; census still counts it for supply',async()=>{
 const items=[{address:{hash:DEAD},value:'600'},{address:{hash:w(1)},value:'300'},{address:{hash:w(2)},value:'100'}];
 const balances={[DEAD]:600n,[w(1)]:300n,[w(2)]:100n};
 const fetcher=async()=>new Response(JSON.stringify({items}),{status:200,headers:{'content-type':'application/json'}});
 const rpcCall=async(m,[{data}])=>'0x'+balances['0x'+data.slice(-40)].toString(16).padStart(64,'0');
 const r=await rh.fetchRank(TOKEN,{block:BLOCK,totalSupplyRaw:'1000',reportedHolderCount:3,fetcher,rpcCall,key:''});
 assert.equal(r.reasonCode,undefined,JSON.stringify(r));
 assert.equal(r.largestWalletPct.value,30);assert.equal(r.top10Pct.value,40);
 assert.equal(r.holderCount.value,3,'census holder count unchanged');
 assert.equal(r.top10Pct.evidence[0].excludedFromConcentration[0].address,DEAD);
});
