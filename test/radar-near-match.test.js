'use strict';
// Radar V3/V4 near-match discovery (issue #279): adaptive discovery, never adaptive safety.
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../lib/radar-v2/intel/engine'),NM=require('../lib/radar-v2/intel/near-match'),S=require('../lib/radar-v2/v4-snapshot');
const RH=require('../lib/radar-v2/intel/risk-holds'),F=require('../lib/radar-v2/intel/fetch');
const DAY=86400000,NOW=Date.parse('2026-11-18T14:00:00Z');
const A=n=>'0x'+n.toString(16).padStart(40,'0');
const iso=d=>new Date(NOW-d*DAY).toISOString();
const EMPTY_REG={schema:'arcy-radar-project-registry/1',version:'t',projects:[]};
const verified=(o={})=>({crossCheck:'MATCHED',fields:{priceUsd:'CROSS_VERIFIED',volume24hUsd:'CROSS_VERIFIED',liquidityUsd:'CROSS_VERIFIED',poolCreatedAt:'CROSS_VERIFIED'},sourcesDisagree:false,...o});
// Ethereum floors: volume $100k, liquidity $200k, 10 trades.
const miss=(n,o={})=>({address:A(n),symbol:'T'+n,name:'Token '+n,reason:'INELIGIBLE_AFTER_VERIFICATION',priceUsd:0.5,volume24hUsd:70000,liquidityUsd:260000,change24hPct:5,logo:{url:'https://assets.geckoterminal.com/near-match-fixture',source:'GeckoTerminal'},
 poolCreatedAt:iso(40),buys24h:60,sells24h:55,pool:A(1000+n),quote:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',...o});
const legacyRanked=['0x68749665ff8d2d112fa859aa293f07a622782f38','0x6982508145454ce325ddbe47a25d4ec3d2311933','0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9']
 .map((a,i)=>({rank:i+1,address:a,chainId:1,symbol:['XAUt','PEPE','AAVE'][i],name:['Tether Gold','Pepe','Aave Token'][i],priceUsd:1,volume24hUsd:5e6,liquidityUsd:2e7,poolCreatedAt:iso(900),buys24h:300,sells24h:300,fields:{},discovery:{version:'arcy-discovery-2',score:60,poolsSeen:1}}));
// Real shape of the live Ethereum window on 2026-11-18: 10 ranked rows, all established/legacy.
function ethSection({excluded=[],nearMiss=[],tokens=legacyRanked}={}){
 return {ok:true,network:'ethereum',chainId:1,asOf:iso(0.01),freshness:'FRESH',tokens,excluded,nearMiss,discovery:{uniqueCandidates:45}};
}
async function run(sections,opts={}){F._reset();E._clearCache();
 return E.run({sections,now:NOW,env:{},fetcher:async()=>{throw Error('no network in near-match tests');},rpc:{},registryDoc:EMPTY_REG,limits:{concurrency:1,pace:false},...opts});}

test('1. no qualified candidates + valid near matches => labelled, ranked by distance, with exact explanation',async()=>{
 const nearMiss=[{...miss(1,{volume24hUsd:90000}),stage:'POST_VERIFICATION_GATES'}];
 const r=await run({ethereum:ethSection({excluded:[
  {...miss(1,{volume24hUsd:90000}),detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:verified()},
  {...miss(2,{volume24hUsd:55000}),detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:verified()},
  {...miss(3,{volume24hUsd:80000,liquidityUsd:150000}),detail:'VOLUME_BELOW_NETWORK_FLOOR,LIQUIDITY_BELOW_NETWORK_FLOOR',verification:verified()}]})});
 const n=r.networks.ethereum,shown=n.displayCandidates;
 assert.equal(nearMiss.length,1);
 assert.deepEqual(shown.map(x=>x.address),[A(1),A(3),A(2)]);
 assert.ok(shown.every(x=>x.discoveryClass==='NEAR_MATCH'&&x.displayTier==='WATCHLIST_NOT_VERIFIED'));
 assert.deepEqual(shown[0].nearMatch.missed,[{gate:'VOLUME_BELOW_NETWORK_FLOOR',value:90000,threshold:100000,distance:0.1}]);
 assert.match(shown[0].infoV4,/^YAKIN EŞLEŞME — kritik risk kontrollerinden geçti \(güvenlik garantisi değildir\), 24s hacim eşiğin %90’i/);
 assert.equal(n.funnel.v4ExcludedBy.NOT_EARLY_STAGE_CATEGORY,3,'XAUt/PEPE/AAVE still excluded');
});
test('2. no qualified + no legitimate near matches => honest empty state with exclusion statistics',async()=>{
 const r=await run({ethereum:ethSection({excluded:[{...miss(4,{volume24hUsd:2000,liquidityUsd:5000}),detail:'VOLUME_BELOW_NETWORK_FLOOR,LIQUIDITY_BELOW_NETWORK_FLOOR',verification:verified()}]})});
 const n=r.networks.ethereum;
 assert.equal(n.displayCandidates.length,0);
 assert.equal(n.display.shortfall.droppedByReason.NOT_EARLY_STAGE_CATEGORY,3);
 assert.equal(n.display.shortfall.droppedByReason.TOO_FAR_FROM_THRESHOLDS,1);
});
test('3. a verified failed-exit (persistent risk hold) token never enters any near-match result',async()=>{
 const af=RH.SEEDS[0];
 const sec={ok:true,network:'arc',chainId:5042,asOf:iso(0.01),freshness:'FRESH',tokens:[],discovery:{uniqueCandidates:9},
  excluded:[{address:af.address,symbol:'AF',name:'Arcflow',reason:'INELIGIBLE_AFTER_VERIFICATION',detail:'VOLUME_BELOW_NETWORK_FLOOR',priceUsd:0.0001,volume24hUsd:4900,liquidityUsd:40000,poolCreatedAt:iso(60),buys24h:200,sells24h:200,verification:verified()}]};
 const r=await run({arc:sec});
 assert.equal(r.networks.arc.displayCandidates.length,0);
 assert.equal(r.networks.arc.display.shortfall.droppedByReason.PERSISTENT_RISK_HOLD,1);
 const row=r.networks.arc.all[0];assert.equal(row.eligibility,'EXCLUDE');assert.equal(row.discoveryClass,'NEAR_MATCH','discovery class is computed but the hard gate wins');
});
test('4. corrupt / unavailable data can never produce QUALIFIED or NEAR_MATCH',()=>{
 const c=(o)=>({address:A(9),chainId:1,priceUsd:1,liquidityUsd:3e5,volume24hUsd:9e4,poolCreatedAt:iso(30),buys24h:20,sells24h:20,...o});
 assert.equal(NM.classify(c({v3:{stage:'POOL_LEVEL_GATES',gates:[]}}),'ethereum',NOW).discoveryClass,'MONITOR_ONLY','unverified stage with no gates is not qualified');
 assert.equal(NM.classify(c({v3:{stage:'WHATEVER',gates:['VOLUME_BELOW_NETWORK_FLOOR']}}),'ethereum',NOW).discoveryClass,'MONITOR_ONLY');
 assert.equal(NM.classify(c({v3:{stage:'POST_VERIFICATION_GATES',gates:['VOLUME_BELOW_NETWORK_FLOOR'],verification:{fields:{priceUsd:'NOT_VERIFIED',liquidityUsd:'CROSS_VERIFIED'}}}}),'ethereum',NOW).discoveryClass,'MONITOR_ONLY');
 assert.equal(NM.classify(c({volume24hUsd:null,v3:{stage:'POST_VERIFICATION_GATES',gates:['VOLUME_BELOW_NETWORK_FLOOR'],verification:verified()}}),'ethereum',NOW).discoveryClass,'NOT_SHOWN','missing value => distance 1, never near');
 assert.equal(NM.classify(c({poolCreatedAt:null,v3:{stage:'POST_VERIFICATION_GATES',gates:['VOLUME_BELOW_NETWORK_FLOOR'],verification:verified()}}),'ethereum',NOW).discoveryClass,'MONITOR_ONLY');
 assert.equal(NM.classify(c({v3:{stage:'POST_VERIFICATION_GATES',gates:['SOMETHING_NEW'],verification:verified()}}),'ethereum',NOW).discoveryClass,'MONITOR_ONLY','unknown gate is missing evidence, not a pass');
 assert.equal(NM.classify(c({priceUsd:null,liquidityUsd:null,v3:{stage:'ONCHAIN_POOL_CREATION',gates:['NO_TOKEN_LEVEL_DATA']}}),'ethereum',NOW).discoveryClass,'NOT_SHOWN');
 assert.equal(NM.classify(c({v3:{stage:'POST_VERIFICATION_GATES',gates:['PRICE_IMPLAUSIBLE','VOLUME_BELOW_NETWORK_FLOOR'],verification:verified()}}),'ethereum',NOW).discoveryClass,'HARD');
 assert.equal(NM.classify(c({v3:{stage:'POST_VERIFICATION_GATES',gates:['VOLUME_LIQUIDITY_INCONSISTENT'],verification:verified()}}),'ethereum',NOW).discoveryClass,'HARD');
});
test('5. source conflicts cannot be hidden by fallback scoring',async()=>{
 const r=await run({ethereum:ethSection({excluded:[{...miss(5,{volume24hUsd:99000}),detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:verified({sourcesDisagree:true})}]})});
 assert.equal(r.networks.ethereum.displayCandidates.length,0);
 assert.equal(r.networks.ethereum.display.shortfall.droppedByReason.SOURCE_CONFLICT_V3,1);
});
test('6. near-match rows keep exact chain, contract and pool identity end to end (engine → snapshot → served)',async()=>{
 const sec=ethSection({excluded:[{...miss(6),detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:verified()}]});
 const r=await run({ethereum:sec});
 const snap=S.build(r,{ethereum:sec},{now:NOW});assert.equal(S.validate(snap).ok,true,JSON.stringify(S.validate(snap)));
 const row=snap.sections.ethereum.rows[0];
 assert.equal(row.chainId,1);assert.equal(row.address,A(6));assert.equal(row.pool,A(1006));assert.equal(row.opportunity.discoveryClass,'NEAR_MATCH');
 assert.match(row.opportunity.nearMatch.passedCriticalChecks,/NOT_A_SAFETY_GUARANTEE/);
 S._reset();const v=await S.serve('ethereum',{env:{RADAR_V4_OPPORTUNITY_ENABLED:'true'},fetcher:async()=>({ok:true,status:200,text:async()=>JSON.stringify(snap)}),now:NOW});
 assert.equal(v.data.tokens[0].address,A(6));assert.equal(v.data.chainId,1);
});
test('7. duplicate pools / repeated listings do not inflate candidate counts',async()=>{
 const dup={...miss(7),detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:verified()};
 const sec=ethSection({excluded:[dup,{...dup,pool:A(2222)},dup],nearMiss:[{...dup,stage:'BELOW_FINALISTS',gates:[]}]});
 const d=E.discover({ethereum:sec}).sections.ethereum;
 assert.equal(d.candidates.filter(c=>c.address===A(7)).length,1);assert.equal(d.duplicates,3);
 const r=await run({ethereum:sec});assert.equal(r.networks.ethereum.funnel.v4Candidates,4);
});
test('8. critical risk holds survive snapshot refreshes (ledger carried, still excluded on the next run)',async()=>{
 const af=RH.SEEDS[0];
 const sec={ok:true,network:'arc',chainId:5042,asOf:iso(0.01),freshness:'FRESH',tokens:[{rank:1,address:af.address,chainId:5042,symbol:'AF',name:'Arcflow',priceUsd:0.0001,volume24hUsd:50000,liquidityUsd:40000,poolCreatedAt:iso(60),buys24h:300,sells24h:300,fields:{},discovery:{version:'arcy-discovery-2',score:57,poolsSeen:1}}],discovery:{uniqueCandidates:9}};
 const r1=await run({arc:sec});const snap1=S.build(r1,{arc:sec},{now:NOW});
 assert.ok(snap1.riskLedger.some(x=>x.key===af.key&&x.state==='HELD'));
 const r2=await run({arc:sec},{priorRiskLedger:snap1.riskLedger});
 assert.equal(r2.networks.arc.displayCandidates.length,0);assert.ok(r2.networks.arc.all[0].reasons.includes('PERSISTENT_LOW_EXIT_LIQUIDITY'));
});
test('9. the primary (QUALIFIED) list is unchanged when near matches are added',async()=>{
 const q=[1,2,3].map(i=>({rank:i,address:A(50+i),chainId:1,symbol:'Q'+i,name:'Qualified '+i,priceUsd:1,volume24hUsd:3e5+i,liquidityUsd:5e5+i*1000,poolCreatedAt:iso(60),buys24h:100,sells24h:100,fields:{},discovery:{version:'arcy-discovery-2',score:50-i,poolsSeen:1}}));
 const base=await run({ethereum:ethSection({tokens:q})});
 const more=await run({ethereum:ethSection({tokens:q,excluded:[{...miss(8,{volume24hUsd:99000}),detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:verified()}]})});
 const ids=x=>x.networks.ethereum.displayCandidates.map(r=>r.address);
 assert.deepEqual(ids(more).slice(0,3),ids(base));assert.equal(ids(more)[3],A(8));
 assert.ok(more.networks.ethereum.displayCandidates.slice(0,3).every(r=>r.discoveryClass==='QUALIFIED'));
});
test('10. coverage counters reconcile with discovery and exclusion stages',async()=>{
 const sec=ethSection({excluded:[{...miss(10),detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:verified()},{...miss(11,{volume24hUsd:1000,liquidityUsd:1000}),detail:'VOLUME_BELOW_NETWORK_FLOOR,LIQUIDITY_BELOW_NETWORK_FLOOR',verification:verified()},
  {...miss(12),reason:'POOL_UNDER_24H',poolCreatedAt:iso(0.3)}],nearMiss:[{...miss(13),stage:'BELOW_SHORTLIST',gates:[]}]});
 const r=await run({ethereum:sec}),f=r.networks.ethereum.funnel;
 assert.equal(f.v3.uniqueCandidates,45);assert.equal(f.v3.ranked,3);assert.equal(f.v3.excludedListed,3);assert.equal(f.v3.nearMissListed,1);
 const sum=Object.values(f.classes).reduce((a,b)=>a+b,0);assert.equal(sum,f.v4Candidates);
 assert.equal(f.v4Candidates,r.networks.ethereum.all.length);
 assert.equal(Object.values(f.shownByClass).reduce((a,b)=>a+b,0),r.networks.ethereum.displayCandidates.length);
 assert.deepEqual(f.shownByClass,{NEAR_MATCH:1,MONITOR_ONLY:2});
});
test('11. V3/V4 fallback cannot leak excluded assets (category, impersonation, wrapped) into near-match rows',async()=>{
 const sec=ethSection({tokens:[],excluded:[
  {...miss(20,{address:'0x45804880de22913dafe09f4980848ece6ecbaf78',symbol:'PAXG',name:'PAX Gold'}),detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:verified()},
  {...miss(21,{symbol:'NEAR',name:'NEAR'}),detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:verified()},
  {...miss(22,{name:'Wrapped Thing'}),detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:verified()}]});
 const r=await run({ethereum:sec});
 assert.equal(r.networks.ethereum.displayCandidates.length,0);
 const snap=S.build(r,{ethereum:sec},{now:NOW});assert.equal(snap.sections.ethereum.rows.length,0);
 // a tampered snapshot that inserts a non-early row is rejected by the serving validator
 const bad=structuredClone(S.build(await run({ethereum:ethSection({excluded:[{...miss(23),detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:verified()}]})}),{ethereum:ethSection()},{now:NOW}));
 bad.sections.ethereum.rows[0].opportunity.category='LEGACY_MEME';assert.equal(S.validate(bad).ok,false);
 const order=structuredClone(bad);order.sections.ethereum.rows[0].opportunity.category='EARLY_STAGE_CANDIDATE';
 order.sections.ethereum.rows.push({...order.sections.ethereum.rows[0],address:A(24),rank:2,opportunity:{...order.sections.ethereum.rows[0].opportunity,discoveryClass:'QUALIFIED'}});
 assert.equal(S.validate(order).ok,false,'a QUALIFIED row can never be placed below a NEAR_MATCH');
});
test('12. near-match layer adds zero network/RPC calls and stays bounded with oversized inputs',async()=>{
 let calls=0;const rpc={ethereum:async()=>{calls++;throw Error('no');}};
 const flood=Array.from({length:200},(_,i)=>({...miss(100+i),detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:verified()}));
 const t0=Date.now();
 const r=await run({ethereum:ethSection({excluded:flood,nearMiss:flood.map(x=>({...x,stage:'BELOW_FINALISTS',gates:[]}))})},{rpc,limits:{concurrency:1,pace:false,unregisteredOnchain:0}});
 assert.equal(calls,0);assert.ok(r.networks.ethereum.funnel.v4Candidates<=45);assert.ok(Date.now()-t0<5000);
 assert.ok(r.networks.ethereum.displayCandidates.length<=10);
 assert.ok(r.networks.ethereum.displayCandidates.filter(x=>x.discoveryClass==='MONITOR_ONLY').length<=10);
});
test('Ethereum uses remaining slots for adequately observed monitored candidates, not young unverified pools',async()=>{
 const mature=Array.from({length:6},(_,i)=>({...miss(30+i),reason:'INELIGIBLE_AFTER_VERIFICATION',detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:null,poolCreatedAt:iso(5)}));
 const r=await run({ethereum:ethSection({excluded:[{...miss(40,{volume24hUsd:95000}),detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:verified()},...mature]})});
 const shown=r.networks.ethereum.displayCandidates;
 assert.equal(shown[0].discoveryClass,'NEAR_MATCH');assert.equal(shown.filter(x=>x.discoveryClass==='MONITOR_ONLY').length,6);
 assert.match(shown[1].infoV4,/^SADECE İZLEME — onaylı veya düşük riskli değildir, eksik: /);
 assert.equal(r.networks.ethereum.display.shortfall?.droppedByReason?.MONITOR_ONLY_CAP||0,0);
});
test('snapshot builder reads the legacy V3 window (source=legacy-v3) and refuses V4-served input (circular guard)',async()=>{
 const {sections}=require('../scripts/probe-radar-intel.cjs');const urls=[];
 const fetcher=async(u)=>{urls.push(u);const chain=/chain=([a-z]+)/.exec(u)[1];
  const body=chain==='ethereum'?{ok:true,network:'ethereum',opportunity:{servedList:'V4_OPPORTUNITY'},tokens:[]}:{ok:true,network:chain,tokens:[]};
  return {ok:true,status:200,json:async()=>body};};
 const s=await sections(fetcher);
 assert.ok(urls.every(u=>u.includes('&source=legacy-v3')));
 assert.equal(s.out.ethereum.reason,'CIRCULAR_V4_INPUT_REFUSED');assert.equal(s.timing.ethereum.circular,true);assert.equal(s.out.arc.ok,true);
});
test('API: source=legacy-v3 bypasses V4 serving (for the builder) without bypassing site/publication policy',async()=>{
 const radar=require('../lib/radar-v2'),handler=require('../search/server/api/radar.js'),old={...process.env},ol=radar.load,of=global.fetch;
 Object.assign(process.env,{RADAR_V4_OPPORTUNITY_ENABLED:'true',MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true'});
 let fetched=0;global.fetch=async()=>{fetched++;return {ok:false,status:404,text:async()=>''};};
 radar.load=async n=>({ok:true,version:2,network:n,chainId:1,tokens:[],excluded:[],nearMiss:[]});
 const call=async(q,h={'sec-fetch-site':'same-origin'})=>{const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};await handler({method:'GET',query:q,headers:h},res);return res;};
 try{
  S._reset();const r=await call({chain:'ethereum',source:'legacy-v3'});
  assert.equal(r.code,200);assert.equal(r.body.servedList,'LEGACY_V3_REQUESTED');assert.equal(fetched,0,'no snapshot read');assert.ok(Array.isArray(r.body.nearMiss));
  const cross=await call({chain:'ethereum',source:'legacy-v3'},{'sec-fetch-site':'cross-site'});assert.equal(cross.code,403);
 }finally{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);radar.load=ol;global.fetch=of;S._reset();}
});
test('look-alikes: several contracts sharing a ticker never fill near-match/monitor slots',async()=>{
 const young=(n)=>({...miss(n,{symbol:'GTA6',name:'GTA6'}),reason:'POOL_UNDER_24H',poolCreatedAt:iso(0.2)});
 const r=await run({ethereum:ethSection({excluded:[young(60),young(61),{...miss(62,{volume24hUsd:95000}),detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:verified()}]})});
 assert.deepEqual(r.networks.ethereum.displayCandidates.map(x=>x.address),[A(62)]);
 assert.equal(r.networks.ethereum.display.shortfall.droppedByReason.DUPLICATE_TICKER_UNRESOLVED,2);
});
test('builder cross-check upgrades pre-verification near misses using the real verifier; disagreement => CONFLICT',async()=>{
 const pairs=(addr,price,liq)=>[{chainId:'ethereum',pairAddress:A(9000),baseToken:{address:addr},quoteToken:{address:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'},priceUsd:String(price),volume:{h24:70000},liquidity:{usd:liq},priceChange:{h24:1},pairCreatedAt:NOW-40*DAY,dexId:'uniswap',url:'https://dexscreener.com/ethereum/x'}];
 const nm=(n,o={})=>({...miss(n,{volume24hUsd:70000,liquidityUsd:150000,...o}),stage:'POOL_LEVEL_GATES',gates:['VOLUME_BELOW_NETWORK_FLOOR','LIQUIDITY_BELOW_NETWORK_FLOOR'],scope:'POOL_LEVEL_PROVIDER_VALUES'});
 const fetcher=async(u)=>({ok:true,status:200,headers:new Map(),text:async()=>JSON.stringify([...pairs(A(70),0.5,150000),...pairs(A(71),0.9,150000)])});
 const r=await run({ethereum:ethSection({nearMiss:[nm(70),nm(71)]})},{limits:{concurrency:1,pace:false,crossCheckFetcher:fetcher}});
 const by=a=>r.networks.ethereum.all.find(x=>x.address===a);
 assert.equal(by(A(70)).discoveryClass,'NEAR_MATCH',JSON.stringify(by(A(70)).nearMatch));assert.equal(by(A(71)).discoveryClass,'CONFLICT');
 assert.equal(r.cost.builderCrossChecks,1,'one batched call per network');
 const off=await run({ethereum:ethSection({nearMiss:[nm(70)]})});assert.equal(off.networks.ethereum.all.find(x=>x.address===A(70)).discoveryClass,'MONITOR_ONLY');
});


test('near-match look-alike exclusion also applies to an otherwise V4 ELIGIBLE contract',()=>{
 const row=(n,eligibility)=>({key:'1:'+A(n),network:'ethereum',chainId:1,address:A(n),symbol:'SAME',
  eligibility,discoveryClass:'NEAR_MATCH',marketObserved:true,reasons:[],
  nearMatch:{passed:[],maxDistance:0.2},opportunity:{score:20,dimensions:{product:0,team:0,adoption:0}},
  evidenceConfidence:{score:35,missing:[]}});
 const d=E.selectDisplay([row(601,'ELIGIBLE'),row(602,'REVIEW')]);
 assert.equal(d.length,0,'same-symbol near matches remain withheld regardless of V4 eligibility');
 assert.equal(d.shortfall.droppedByReason.DUPLICATE_TICKER_UNRESOLVED,2);
});

test('Arc and Ethereum may populate 10 observation slots, while Robinhood retains the 3-monitor cap',()=>{
 const monitor=(network,i,props={})=>({
  key:({arc:5042,ethereum:1,robinhood:4663}[network])+':'+A(800+i),network,
  chainId:{arc:5042,ethereum:1,robinhood:4663}[network],address:A(800+i),symbol:'CAND'+i,
  eligibility:'REVIEW',discoveryClass:'MONITOR_ONLY',reasons:[],marketObserved:true,
  priceUsd:0.1,liquidityUsd:network==='ethereum'?120000:25000,volume24hUsd:network==='ethereum'?26000:2000,
  change24hPct:4,trades24h:36,poolCreatedAt:iso(6),snapshotNow:NOW,
  artwork:{url:'https://assets.geckoterminal.com/observed-fixture'},nearMatch:{passed:['PRICE_EVIDENCE'],pending:['INDEPENDENT_CROSS_CHECK_PENDING'],maxDistance:0.3},
  opportunity:{score:20,dimensions:{product:0,team:0,adoption:0}},
  evidenceConfidence:{score:20,missing:['EXIT','SELL']}
  ,...props
 });
 for(const network of ['arc','ethereum']){
  const rows=Array.from({length:13},(_,i)=>monitor(network,i));
  const out=E.selectDisplay(rows,{network});
  assert.equal(out.length,10,network+' can present ten observed candidates');
  assert.deepEqual(out.byClass,{MONITOR_ONLY:10});
  assert.ok(out.every(x=>x.watchOnly&&x.displayTier==='WATCHLIST_NOT_VERIFIED'));
  assert.equal(out.shortfall,null);
 }
 const conservative=E.selectDisplay(Array.from({length:13},(_,i)=>monitor('robinhood',i)),{network:'robinhood'});
 assert.equal(conservative.length,3,'Robinhood retains existing conservative cap');
 assert.equal(conservative.shortfall.droppedByReason.MONITOR_ONLY_CAP,10);
 const candidates=Array.from({length:13},(_,i)=>monitor('ethereum',i));
 candidates[0].eligibility='EXCLUDE';candidates[0].reasons=['PERSISTENT_LOW_EXIT_LIQUIDITY'];
 candidates[1].discoveryClass='CONFLICT';
 candidates[2].symbol='SPOOF';candidates[3].symbol='SPOOF';
 const risk=E.selectDisplay(candidates,{network:'ethereum'});
 assert.ok(risk.every(x=>x.address!==A(800)&&x.address!==A(801)&&x.symbol!=='SPOOF'),'hard holds, source conflicts and lookalikes remain excluded');
 assert.ok(risk.length<=9,'never fabricate a tenth candidate when safety leaves too few');
});

test('snapshot validator accepts expanded genuine Ethereum monitors but rejects four Robinhood monitors',async()=>{
 const monitored=Array.from({length:8},(_,i)=>({...miss(1100+i),reason:'INELIGIBLE_AFTER_VERIFICATION',detail:'VOLUME_BELOW_NETWORK_FLOOR',verification:null,poolCreatedAt:iso(5)}));
 const sec=ethSection({tokens:[],excluded:monitored});
 const result=await run({ethereum:sec});
 const snapshot=S.build(result,{ethereum:sec},{now:NOW});
 assert.ok(snapshot.sections.ethereum.rows.length>3,'must exercise the formerly rejected monitor overflow');
 assert.ok(snapshot.sections.ethereum.rows.length<=10);
 assert.equal(snapshot.sections.ethereum.rows.filter(x=>x.opportunity.discoveryClass==='MONITOR_ONLY').length,snapshot.sections.ethereum.rows.length);
 assert.deepEqual(S.validate(snapshot),{ok:true},'source-backed rows may now fill Arc/ETH slots');
 const spoof=structuredClone(snapshot);
 spoof.sections.robinhood={...spoof.sections.ethereum,
  rows:spoof.sections.ethereum.rows.map(x=>({...x,network:'robinhood',chainId:4663}))};
 assert.equal(S.validate(spoof).ok,false,'robinhood still enforces the old 3-monitor cap');
});
