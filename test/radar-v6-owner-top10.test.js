'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const U=require('../lib/radar-v2/intel/universe');
const OD=require('../lib/radar-v2/intel/official-discovery');
const PC=require('../lib/radar-v2/intel/profile-completeness');
const TOP=require('../lib/radar-v2/intel/top10');
const DOS=require('../lib/radar-v2/intel/dossiers');
const NOW=Date.parse('2026-11-20T09:40:00Z');
const TOLLY='0xbc43ce8dec648ea298c4275559b81d6261c90b67';
const HOOKR='0x18e674231a58c239dc7daedcffe15ec3a24cff5c';
function candidate(chainId,address,symbol){
 const e=U.registryFor(chainId).find(x=>x.address===address);
 assert.ok(e,'curated exact-chain contract required');
 return {chainId,address,symbol,universe:{registry:e}};
}
function fetched(body,code=200){return {ok:code>=200&&code<300,status:code,text:async()=>body,headers:{get:()=>null}}}
test('reviewed canonical site must publish the exact address in fetched HTML, not merely in ticker or registry',async()=>{
 const c=candidate(4663,HOOKR,'HOOKR');
 const yes=await OD.inspect(c,{now:NOW,fetcher:async()=>fetched('<html><title>Hookr docs</title><main>Contract: '+HOOKR+'</main></html>')});
 assert.equal(yes.status,'ADDRESS_PUBLISHED');
 assert.equal(yes.dossier.status,'PRIMARY_SOURCE_VERIFIED');
 assert.equal(yes.dossier.evidenceUrl,'https://hookr.fun/docs/reference/contracts-and-addresses');
 assert.equal(yes.dossier.docsUrl,'https://hookr.fun/docs/reference/contracts-and-addresses');
 const no=await OD.inspect(c,{now:NOW,fetcher:async()=>fetched('hookr ticker only')});
 assert.equal(no.status,'ADDRESS_NOT_PUBLISHED');
 assert.equal(no.dossier,undefined);
 const unavailable=await OD.inspect(c,{now:NOW,fetcher:async()=>fetched('blocked',403)});
 assert.equal(unavailable.status,'SITE_UNREACHABLE');
 assert.equal(unavailable.dossier,undefined);
});
test('TOLLY reviewed primary-source documentation adds research coverage but does not magically verify issuer',()=>{
 const reg=DOS.load();
 const d=DOS.lookup(reg,5042,TOLLY);
 assert.ok(d);
 assert.equal(d.status,'PARTIAL_EVIDENCE');
 assert.equal(d.docsUrl,'https://tollylabs.com/guide');
 const r={chainId:5042,address:TOLLY,priceUsd:0.01,liquidityUsd:120000,volume24hUsd:18000,
  dossier:d,radarAsOf:new Date(NOW).toISOString(),
  history:{observations:30,from:new Date(NOW-29*86400000).toISOString(),to:new Date(NOW).toISOString()},
  compression:{days:30,source:'ONCHAIN_RESERVE_SAMPLES',to:new Date(NOW).toISOString()},
  sourceEvidence:{crossCheck:'MATCHED'},marketSpread:{liquidityUsd:{min:120000,ratio:1.1,providers:2},
   volume24hUsd:{min:17000,ratio:1.2,providers:2}}};
 const p=PC.compute(r,{network:'arc',now:NOW,identity:{level:'METADATA_CROSS_CORROBORATED',evidence:['EXPLORER_DEX_MATCH']},researchFloor:20000});
 assert.equal(p.components.identity.score,12,'creator/project listing is not official issuer verification');
 assert.equal(p.components.official.score,20,'genuine website, guide and documented project purpose earn real evidence points');
 assert.equal(p.components.market.score,20);
 assert.ok(p.score>=60,'real independent evidence may pass 60 without fabricated owner/exit checks');
 assert.equal(p.components.security.score,0);
});
test('pre-breakout A-filter needs actual measured compression despite two other positive non-price signals',()=>{
 const base={researchTier:'RESEARCH_QUALIFIED',discoveryTier:'EARLY',
  identity:{level:'METADATA_CROSS_CORROBORATED'},profileCompleteness:{qualifiesMain:true},
  v3Verification:{crossCheck:'MATCHED'},qualityRank:{score:72,organicBasis:'ONCHAIN_DEMAND_REVIEWED'},
  evidenceSummary:{demand:{cluster:'REVIEWED_NO_CONCENTRATION',wash:'REVIEWED_NO_SELF_TRADE'},product:'VERIFIED_ACTIVE'},
  change24hPct:4,integrity:{pumpHistory:false,suspicious:[]},
  history:{flags:['ACTIVITY_GROWTH_OBSERVED']},
  compression:{status:'NO_COMPRESSION_EVIDENCE'}};
 assert.equal(TOP.topSignal(base).ok,false);
 assert.ok(TOP.topSignal(base).why.includes('COMPRESSION_NOT_CONFIRMED'));
});
