'use strict';
// Workstreams C + G: consistent, explained holder methodology on every chain; plain-language reasons for gated providers.
const {test}=require('node:test'),assert=require('node:assert/strict');
const pub=require('../search/server/lib/arc-holder-publication'),ec=require('../search/server/lib/evidence-class'),rh=require('../search/server/lib/robinhood-holder-rank');
const block='0x10',anchor='0x'+'1'.repeat(64),A='0x'+'aa'.repeat(20),DEAD='0x'+'0'.repeat(36)+'dead';
test('Arc signed snapshot fields expose the same methodology metadata as Ethereum/Robinhood, read from the signed payload',()=>{
 const snap={status:'ONCHAIN_VERIFIED',block,snapshot:{block,completedAt:new Date(Date.now()-3600e3).toISOString()},holderCount:19,largestWalletPct:91.37,top10Pct:96.95,top20Pct:96.97,evidence:[{block,anchor}],excluded:[{address:DEAD,balanceRaw:'30343793'}]};
 const card=pub.toCard(snap,A);
 const ev=card.fields.largestWalletPct.evidence[0];
 assert.match(ev.concentrationDenominator,/totalSupply/);assert.match(ev.walletClassification,/NOT classified/);
 assert.deepEqual(ev.excludedFromConcentration,[{address:DEAD,balanceRaw:'30343793',role:'BURN_ADDRESS'}]);
 assert.equal(card.fields.holderCount.evidence[0].holderCountIncludesBurnAddresses,false,'Arc counts exclude burn custody');
 assert.equal(card.fields.largestWalletPct.value,91.37,'values unchanged');assert.equal(card.fields.largestWalletPct.status,'SIGNED_ONCHAIN_SNAPSHOT');
 assert.deepEqual(pub.toCard({...snap,excluded:'tampered'},A).fields.top10Pct.evidence[0].excludedFromConcentration,[],'malformed lists are dropped, never guessed');
});
test('Robinhood: when burn rows push real wallets below 20, Top 20 carries a specific reason',async()=>{
 const w=i=>'0x'+(i+1).toString(16).padStart(40,'0');
 const items=[{address:{hash:DEAD},value:'5000'},...Array.from({length:19},(_,i)=>({address:{hash:w(i)},value:String(200-i)}))];
 const bal=Object.fromEntries(items.map(x=>[x.address.hash,BigInt(x.value)]));
 const r=await rh.fetchRank(A,{block,totalSupplyRaw:'100000',key:'',fetcher:async()=>new Response(JSON.stringify({items}),{status:200,headers:{'content-type':'application/json'}}),rpcCall:async(m,[{data}])=>'0x'+bal['0x'+data.slice(-40)].toString(16).padStart(64,'0')});
 assert.equal(r.top10Pct.dataState,'DATA_FOUND');assert.equal(r.top20Pct.dataState,'NOT_VERIFIED');
 assert.equal(r.top20Pct.reasonCode,'BURN_EXCLUSION_RANK_INCOMPLETE');assert.match(r.top20Pct.reason,/fewer than 20 real wallets/);
});
test('licensing-gated provider reasons become a plain user sentence; code and operator detail are preserved',()=>{
 const report={cards:{mechanics:{fields:{
  tradingTaxes:{value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reasonCode:'PROVIDER_DISABLED_LICENSE_UNVERIFIED',reason:'GoPlus public production use is disabled pending written commercial permission and required attribution.'},
  ownerAdmin:{value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reasonCode:'OWNER_ADMIN_NOT_VERIFIED',reason:'Original reason'},
  contractArchitecture:{value:'NON-PROXY · runtime verified',status:'ON_CHAIN',dataState:'DATA_FOUND'}}}}};
 ec.annotate(report);
 const t=report.cards.mechanics.fields.tradingTaxes;
 assert.equal(t.reasonCode,'PROVIDER_DISABLED_LICENSE_UNVERIFIED');assert.equal(t.reason,ec.PLAIN.PROVIDER_DISABLED_LICENSE_UNVERIFIED);
 assert.match(t.reasonDetail,/GoPlus public production use/);assert.doesNotMatch(t.reason,/GoPlus|permission|licen/i);
 assert.equal(report.cards.mechanics.fields.ownerAdmin.reason,'Original reason','other reasons untouched');
 assert.equal(report.cards.mechanics.fields.contractArchitecture.reason,undefined,'verified fields untouched');
 assert.equal(t.evidenceClass,'NOT_VERIFIED');assert.equal(t.provenance.failureReason,'PROVIDER_DISABLED_LICENSE_UNVERIFIED');
 ec.annotate(report);assert.match(report.cards.mechanics.fields.tradingTaxes.reasonDetail,/GoPlus/,'idempotent');
});
