'use strict';
// Issue #279 — Radar V4: opportunity scoring, divergence safeguards, ten-candidate display, snapshot → public Radar path.
const test=require('node:test'),assert=require('node:assert/strict');
const CAT=require('../lib/radar-v2/intel/category'),OPP=require('../lib/radar-v2/intel/opportunity'),E=require('../lib/radar-v2/intel/engine');
const S=require('../lib/radar-v2/v4-snapshot'),SEAL=require('../lib/radar-v2/intel/seal'),P=require('../lib/radar-v2/pre-catalyst');
const DAY=86400000,NOW=Date.parse('2026-11-18T12:00:00Z');
const A=n=>'0x'+n.toString(16).padStart(40,'0');
const iso=d=>new Date(NOW-d*DAY).toISOString();
// ── evidence fixtures ──
const product=(o={})=>({status:'VERIFIED_ACTIVE',updates:[{},{}],activity:{commits90d:60,commits30d:20,commits7d:5,maxAuthors90d:4,activeWeeks90d:12,maxDayShare:0.08,closedIssues90d:14,releases90d:3,lastReleaseAt:iso(6),archived:false,...o}});
const demand=(o={})=>({status:'ONCHAIN_VERIFIED',distinctBuyers:60,clusterReview:'REVIEWED_NO_CONCENTRATION',washReview:'REVIEWED_NO_SELF_TRADE',window:{hours:3,complete:true},...o});
const history=(fn,liq=()=>500000)=>[{candles:Array.from({length:31},(_,i)=>{const t=Math.floor((NOW-(30-i)*DAY)/1000),p=fn(30-i);return [t,p,p,p,p,null];}),
 historicalLiquidity:Array.from({length:31},(_,i)=>({timestamp:Math.floor((NOW-(30-i)*DAY)/1000),liquidityUsd:liq(30-i)}))}];
const catalyst={eventAt:new Date(NOW+12*DAY).toISOString(),kind:'PRODUCT_RELEASE'};
const exit={status:'EXIT_SIMULATED',executableUsd:25000};
const cand=(o={})=>({network:'robinhood',chainId:4663,address:A(1),symbol:'BUILD',name:'Builder Protocol',liquidityUsd:400000,volume24hUsd:60000,priceUsd:0.2,poolCreatedAt:iso(120),...o});

test('category: XAUt, PAXG, PEPE, AAVE and wrapped/stable assets are separated by EXACT contract, not ticker',()=>{
 for(const [a,c] of [['0x68749665ff8d2d112fa859aa293f07a622782f38','COMMODITY_BACKED'],['0x45804880de22913dafe09f4980848ece6ecbaf78','COMMODITY_BACKED'],
  ['0x6982508145454ce325ddbe47a25d4ec3d2311933','LEGACY_MEME'],['0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9','ESTABLISHED_BLUE_CHIP'],
  ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48','STABLECOIN'],['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2','WRAPPED_OR_BASE_ASSET']])
  assert.equal(CAT.classify({chainId:1,address:a,symbol:'X',name:'X'},'ethereum',NOW).category,c,a);
 // same ticker, different contract / chain: no inherited category
 assert.equal(CAT.classify({chainId:4663,address:'0x6982508145454ce325ddbe47a25d4ec3d2311933',symbol:'PEPE',name:'Pepe'},'robinhood',NOW).category,'EARLY_STAGE_CANDIDATE');
 assert.equal(CAT.classify({chainId:1,address:A(9),symbol:'PEPE',name:'Pepe',poolCreatedAt:iso(20),liquidityUsd:3e5},'ethereum',NOW).category,'EARLY_STAGE_CANDIDATE');
 assert.equal(CAT.classify({chainId:1,address:A(9),symbol:'BIG',name:'Big',fdvUsd:3e9},'ethereum',NOW).category,'ESTABLISHED_LARGE_CAP');
 assert.equal(CAT.classify({chainId:1,address:A(9),symbol:'OLD',name:'Old',poolCreatedAt:iso(800),liquidityUsd:5e6},'ethereum',NOW).category,'MATURE_LEGACY_MARKET');
 assert.equal(CAT.classify({chainId:4663,address:A(9),symbol:'NVDA',name:'NVIDIA • Robinhood Token'},'robinhood',NOW).category,'TOKENIZED_EQUITY');
 assert.equal(CAT.classify({chainId:1,address:A(9),symbol:'USDC',name:'USD Coin',priceUsd:3},'ethereum',NOW).category,'IMPERSONATION_SUSPECT');
});
test('MANDATORY: a well-evidenced underperforming project outranks a large token whose only edge is volume/market cap',()=>{
 const strong=OPP.evaluate({candidate:cand(),evidence:{product:product(),demand:demand(),catalyst,exit,history:history(d=>d>20?1:0.4)},network:'robinhood',now:NOW});
 const whale=OPP.evaluate({candidate:cand({liquidityUsd:5e8,volume24hUsd:9e8}),evidence:{exit:{status:'EXIT_SIMULATED',executableUsd:25000},demand:demand({distinctBuyers:900})},network:'robinhood',now:NOW});
 assert.ok(strong.score>whale.score+30,strong.score+' vs '+whale.score);
 assert.ok(whale.score<=35,'market+adoption alone cannot exceed 35');
 assert.equal(strong.divergence.signal,'FUNDAMENTALS_IMPROVING_PRICE_WEAK');assert.equal(strong.divergence.change30dPct,-60);
 assert.equal(whale.dimensions.product,null);assert.equal(whale.developmentEvidence,'DEVELOPMENT_EVIDENCE_UNAVAILABLE');
});
test('MANDATORY: a proven honeypot stays excluded regardless of activity or score',async()=>{
 const rows=[{key:'4663:'+A(1),eligibility:'EXCLUDE',reasons:['SELL_DISABLED'],opportunity:{score:99,dimensions:{product:100,team:100,adoption:100}},marketObserved:true,evidenceConfidence:{score:0.9,missing:[]}},
  {key:'4663:'+A(2),eligibility:'REVIEW',reasons:['IDENTITY_NOT_VERIFIED'],opportunity:{score:5,dimensions:{}},marketObserved:true,evidenceConfidence:{score:0.1,missing:['IDENTITY']}}];
 const out=E.selectDisplay(rows);
 assert.deepEqual(out.map(x=>x.key),['4663:'+A(2)]);
 const c={...cand(),radarAsOf:iso(0),radarFreshness:'FRESH',discovery:{version:'arcy-discovery-2',score:90}};
 assert.ok(P.evaluate(c,{risk:{sell:SEAL.seal({chainId:4663,address:A(1),sourceUrl:'https://robinhoodchain.blockscout.com/a',observedAt:iso(0),status:'SELL_DISABLED_VERIFIED'})}},NOW).reasons.includes('SELL_DISABLED'));
});
test('a 90% drawdown alone is never an opportunity: abandoned dev, collapsed liquidity, concentrated demand or unknown fundamentals',()=>{
 const crash=history(d=>d>25?1:0.1);
 const unknown=OPP.evaluate({candidate:cand(),evidence:{history:crash,demand:demand()},network:'robinhood',now:NOW});
 assert.equal(unknown.dimensions.divergence,null);assert.equal(unknown.divergence.signal,'FUNDAMENTALS_NOT_VERIFIED');
 const abandoned=OPP.evaluate({candidate:cand(),evidence:{product:{...product(),status:'ABANDONED_VERIFIED'},history:crash},network:'robinhood',now:NOW});
 assert.equal(abandoned.dimensions.product,0);assert.ok(abandoned.flags.includes('DEVELOPMENT_ABANDONED'));assert.equal(abandoned.dimensions.divergence,0);
 const drained=OPP.evaluate({candidate:cand(),evidence:{product:product(),history:history(d=>d>25?1:0.1,d=>d>25?1e6:1e5)},network:'robinhood',now:NOW});
 assert.equal(drained.divergence.signal,'LIQUIDITY_COLLAPSED');assert.ok(drained.flags.includes('LIQUIDITY_COLLAPSE'));
 const wash=OPP.evaluate({candidate:cand(),evidence:{product:product(),history:crash,demand:demand({washReview:'WASH_SUSPECTED'})},network:'robinhood',now:NOW});
 assert.equal(wash.divergence.signal,'ADOPTION_WEAK_OR_CONCENTRATED');assert.ok(wash.dimensions.adoption<=25);
});
test('legitimate long drawdown with continuing development scores divergence; no history => PRICE_HISTORY_NOT_VERIFIED',()=>{
 const o=OPP.evaluate({candidate:cand(),evidence:{product:product(),demand:demand(),history:history(d=>1-0.02*(30-d))},network:'robinhood',now:NOW});
 assert.ok(o.dimensions.divergence>0);assert.equal(o.divergence.change30dPct,-60);
 const none=OPP.evaluate({candidate:cand(),evidence:{product:product()},network:'robinhood',now:NOW});
 assert.equal(none.divergence.signal,'PRICE_HISTORY_NOT_VERIFIED');assert.equal(none.dimensions.divergence,null);
});
test('benchmark: underperformance is measured against ETH when the reviewed ETH/USD series is available',()=>{
 const o=OPP.evaluate({candidate:cand(),evidence:{product:product(),demand:demand(),history:history(d=>d>15?1:0.7)},network:'robinhood',now:NOW,benchmark:{id:'ETH',change30dPct:-40}});
 assert.equal(o.divergence.relative30dPct,10);assert.equal(o.divergence.signal,'NO_MATERIAL_UNDERPERFORMANCE');
});
test('artificial GitHub commits and single-author commit floods are capped, private code is labelled not penalised',()=>{
 const burst=OPP.evaluate({candidate:cand(),evidence:{product:product({commits90d:90,maxDayShare:0.9,maxAuthors90d:1,activeWeeks90d:1})},network:'robinhood',now:NOW});
 assert.ok(burst.dimensions.team<=25);assert.ok(burst.flags.includes('ARTIFICIAL_COMMIT_BURST'));
 const priv=OPP.evaluate({candidate:cand(),evidence:{demand:demand()},network:'robinhood',now:NOW});
 assert.equal(priv.dimensions.team,null);assert.equal(priv.developmentEvidence,'DEVELOPMENT_EVIDENCE_UNAVAILABLE');
});
test('catalyst dimension only from a dated future event; info text never forecasts',()=>{
 const o=OPP.evaluate({candidate:cand(),evidence:{product:product(),catalyst},network:'robinhood',now:NOW});
 assert.equal(o.dimensions.catalyst,100);
 assert.equal(OPP.evaluate({candidate:cand(),evidence:{catalyst:{eventAt:iso(1)}},network:'robinhood',now:NOW}).dimensions.catalyst,null);
 const t=OPP.infoReason(o,{eligibility:'REVIEW',category:'EARLY_STAGE_CANDIDATE',catalystAt:catalyst.eventAt});
 assert.match(t,/^Araştırma izleme listesi — DOĞRULANMADI/);assert.doesNotMatch(t,/pump|10x|garanti|kesin|yükselecek/i);
 assert.match(OPP.infoReason(OPP.evaluate({candidate:cand(),evidence:{},network:'robinhood',now:NOW}),{eligibility:'REVIEW'}),/Ürün\/geliştirme kanıtı yok/);
});
// ── display policy ──
const row=(n,o={})=>({key:'1:'+A(n),network:'ethereum',chainId:1,address:A(n),eligibility:'REVIEW',reasons:['IDENTITY_NOT_VERIFIED'],marketObserved:true,
 evidenceConfidence:{score:0.3,missing:['IDENTITY','CATALYST']},discoveryScore:50,opportunity:{score:10,dimensions:{product:null,team:null,adoption:30},flags:[]},...o});
test('zero ELIGIBLE but twelve usable REVIEW candidates => exactly ten WATCHLIST_NOT_VERIFIED, tiered by evidence',()=>{
 const rows=Array.from({length:12},(_,i)=>row(i+1,{discoveryScore:90-i,opportunity:{score:i,dimensions:{product:null,team:null,adoption:i===3?70:20},flags:[]}}));
 rows.push(row(50,{opportunity:{score:60,dimensions:{product:80,team:70,adoption:null},flags:[]}}));
 const out=E.selectDisplay(rows);
 assert.equal(out.length,10);assert.equal(out[0].key,'1:'+A(50));assert.equal(out[0].selectionTier,2);
 assert.equal(out[1].key,'1:'+A(4));assert.equal(out[1].selectionTier,3);
 assert.ok(out.every(x=>x.displayTier==='WATCHLIST_NOT_VERIFIED'&&x.watchOnly));assert.equal(out.shortfall,null);
});
test('fewer than ten defensible candidates: true count with shortfall diagnosis; never padded with risky/contradictory/non-early rows; suspected wash demoted',()=>{
 const rows=[row(1),row(2),row(3,{eligibility:'EXCLUDE',reasons:['NOT_EARLY_STAGE_CATEGORY']}),row(4,{reasons:['SOURCE_CONTRADICTION']}),
  row(5,{opportunity:{score:90,dimensions:{},flags:['DEMAND_CONCENTRATED_OR_WASH']}}),row(6,{marketObserved:false}),row(7,{reasons:['ENGINE_ERROR_X']}),row(1),
  row(8,{eligibility:'EXCLUDE',reasons:['EXCLUDE_ALREADY_RAN_8X']})];
 const out=E.selectDisplay(rows);
 assert.deepEqual(out.map(x=>x.address),[A(1),A(2),A(5)],'suspected wash is shown LAST, never above clean rows despite a higher score');
 assert.equal(out[2].selectionTier,4);
 assert.deepEqual(out.shortfall.droppedByReason,{NOT_EARLY_STAGE_CATEGORY:1,SOURCE_CONTRADICTION:1,MARKET_NOT_OBSERVED:1,ENGINE_ERROR:1,DUPLICATE_EXACT_CONTRACT:1,EXCLUDED_RISK_OR_IDENTITY:1});
});
test('discovery: quiet volume-floor contracts, Arc movers and on-chain pool creations are research candidates with provenance',()=>{
 const sec={ok:true,network:'arc',chainId:5042,asOf:iso(0),freshness:'FRESH',tokens:[{address:A(1),chainId:5042,symbol:'R',pool:A(11)}],
  watchlist:[{address:A(2),chainId:5042,symbol:'M',pool:A(12)}],
  excluded:[{address:A(3),reason:'INELIGIBLE_AFTER_VERIFICATION',detail:'VOLUME_BELOW_NETWORK_FLOOR',pool:A(13),quote:A(99)},
   {address:A(4),reason:'INELIGIBLE_AFTER_VERIFICATION',detail:'LIQUIDITY_BELOW_NETWORK_FLOOR'},{address:A(5),reason:'IMPERSONATION_SUSPECT'},
   {address:A(1),reason:'INELIGIBLE_AFTER_VERIFICATION',detail:'VOLUME_BELOW_NETWORK_FLOOR'}],
  categories:{newPools:{items:[{address:A(6),symbol:'NEW',pool:A(16),quote:A(99)},{address:A(7),symbol:'ETH',identityFlag:'MAJOR_TICKER_WITHOUT_IDENTITY_PROOF',pool:A(17)}]}}};
 const d=E.discover({arc:sec}).sections.arc;
 assert.deepEqual(d.candidates.map(c=>[c.address,c.provenance[0]]),[[A(1),'RADAR_RANKED'],[A(2),'RADAR_LOW_VOLUME_WATCHLIST'],[A(3),'RADAR_QUIET_VOLUME_FLOOR'],[A(6),'ONCHAIN_POOL_CREATION']]);
 assert.equal(d.candidates[2].quote.address,A(99));assert.ok(d.candidates[0].provenance.includes('RADAR_QUIET_VOLUME_FLOOR'));
});
test('three chains rank independently; Pons launches never appear in Robinhood (cross-tab duplicate guard)',()=>{
 const pons=A(77),launch={status:'ONCHAIN_VERIFIED',factory:'0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e',block:123};
 const sections={robinhood:{ok:true,network:'robinhood',chainId:4663,asOf:iso(0),freshness:'FRESH',tokens:[{address:pons,chainId:4663}],excluded:[{address:pons,reason:'INELIGIBLE_AFTER_VERIFICATION',detail:'VOLUME_BELOW_NETWORK_FLOOR'}]},
  pons:{ok:true,network:'pons',chainId:4663,asOf:iso(0),freshness:'FRESH',tokens:[{address:pons,chainId:4663,launch}]},
  arc:{ok:true,network:'arc',chainId:5042,asOf:iso(0),freshness:'FRESH',tokens:[{address:pons,chainId:5042}]}};
 const d=E.discover(sections).sections;
 assert.equal(d.robinhood.candidates.length,0);assert.equal(d.robinhood.ponsRouted,2);
 assert.equal(d.pons.candidates.length,1);assert.equal(d.arc.candidates.length,1,'same address on another chain is a different contract');
});
// ── snapshot path ──
function engineResult(){
 const disp=(net,n)=>({key:(net==='arc'?5042:4663)+':'+A(n),network:net,address:A(n),symbol:'T'+n,eligibility:'REVIEW',displayTier:'WATCHLIST_NOT_VERIFIED',selectionTier:4,
  category:{category:'EARLY_STAGE_CANDIDATE'},opportunity:{version:'arcy-opportunity-intel-4',score:12,dimensions:{},flags:[],divergence:{signal:'PRICE_HISTORY_NOT_VERIFIED'}},
  evidenceConfidence:{score:0.2},missingProof:['IDENTITY'],provenance:['RADAR_QUIET_VOLUME_FLOOR'],infoV4:'Araştırma izleme listesi — DOĞRULANMADI; Ürün/geliştirme kanıtı yok'});
 const net=(name,rows)=>({source:{status:'OBSERVED',asOf:iso(0)},counts:{},display:{shown:rows.length},displayCandidates:rows,all:rows});
 return {registry:{version:'t',approvedProjects:0},cost:{},networks:{arc:net('arc',[disp('arc',1)]),ethereum:{source:{status:'SOURCE_UNAVAILABLE'}},robinhood:net('robinhood',[disp('robinhood',2),disp('robinhood',3)]),pons:net('pons',[disp('pons',3)])}};
}
const sections={arc:{excluded:[{address:A(1),symbol:'T1',name:'T1',priceUsd:0.1,volume24hUsd:3000,liquidityUsd:40000,poolCreatedAt:iso(40),buys24h:40,sells24h:30}]},robinhood:{excluded:[{address:A(2),symbol:'T2',name:'T2',priceUsd:1,volume24hUsd:4000,liquidityUsd:30000,poolCreatedAt:iso(20),buys24h:30,sells24h:20}]},pons:{tokens:[]}};
test('snapshot build: valid DTO rows, discovery-2 formula kept, Pons removed from Robinhood, failed section NOT_BUILT',()=>{
 const snap=S.build(engineResult(),sections,{now:NOW});
 assert.equal(S.validate(snap).ok,true,JSON.stringify(S.validate(snap)));
 const arc=snap.sections.arc.rows[0];
 assert.equal(arc.rank,1);assert.equal(arc.discovery.version,'arcy-discovery-2');assert.ok(Number.isFinite(arc.discovery.score));assert.equal(arc.discovery.basis,'ARCY_DISCOVERY_2_ON_SOURCE_REPORTED_ROW');
 assert.match(arc.discovery.reason,/DOĞRULANMADI/);assert.equal(arc.fields.priceUsd.status,'SOURCE_REPORTED');
 assert.equal(arc.fields.priceUsd.sourceConfirmed,false);assert.deepEqual(arc.fields.priceUsd.sources,[],'no invented provider attribution');
 assert.equal(arc.fields.priceUsd.provenance.via,'RADAR_QUIET_VOLUME_FLOOR');assert.equal(arc.fieldsProvenance,'SOURCE_REPORTED_UNCONFIRMED');
 assert.ok(!JSON.stringify(arc.fields).includes('GeckoTerminal'));assert.equal(arc.opportunity.notForecast,true);
 assert.deepEqual(snap.sections.robinhood.rows.map(r=>r.address),[A(2)]);
 assert.equal(snap.sections.ethereum.status,'NOT_BUILT');
 // a forged duplicate is rejected at validation
 const bad=structuredClone(snap);bad.sections.robinhood.rows.push({...bad.sections.pons.rows[0],network:'robinhood',rank:2});
 assert.equal(S.validate(bad).ok,false);
 const eligibleLie=structuredClone(snap);eligibleLie.sections.arc.rows[0].opportunity.displayTier='ELIGIBLE';assert.equal(S.validate(eligibleLie).ok,false);
});
test('snapshot merge: a failed section carries forward the previous valid one, labelled',()=>{
 const prev=S.build(engineResult(),sections,{now:NOW-5*3600000});
 const r=engineResult();r.networks.arc={source:{status:'SOURCE_UNAVAILABLE'}};
 const m=S.merge(prev,S.build(r,sections,{now:NOW}));
 assert.equal(m.sections.arc.carriedForward,true);assert.equal(m.sections.arc.asOf,prev.sections.arc.asOf);assert.equal(S.validate(m).ok,true);
});
function fetcherFor(snap,{status=200,delay=0}={}){let calls=0;const f=async(u,o)=>{calls++;assert.equal(o.redirect,'error');assert.equal(u,S.url({}));if(delay)await new Promise(r=>setTimeout(r,delay));
 return {ok:status===200,status,text:async()=>JSON.stringify(snap)};};f.calls=()=>calls;return f;}
const live=net=>({ok:true,version:2,network:net,chainId:net==='arc'?5042:4663,engine:'arcy-radar-v3',asOf:iso(0),freshness:'FRESH',tokens:[{rank:1,address:A(500),symbol:'LEG',name:'Legacy',fields:{}}],discovery:{scoreVersion:'arcy-discovery-2'}});
test('public path: release gate OFF by default => response byte-identical to legacy',async()=>{
 S._reset();const f=fetcherFor(S.build(engineResult(),sections,{now:NOW}));
 const d=live('arc');assert.deepEqual(await S.apply('arc',d,{env:{},fetcher:f,now:NOW}),d);assert.equal(f.calls(),0);
});
test('public path: gate ON serves V4 rows in the same DTO, FRESH then STALE then expired => legacy',async()=>{
 const snap=S.build(engineResult(),sections,{now:NOW});const env={RADAR_V4_OPPORTUNITY_ENABLED:'true'};
 S._reset();const f=fetcherFor(snap);
 const a=await S.apply('arc',live('arc'),{env,fetcher:f,now:NOW+60000});
 assert.equal(a.opportunity.status,'FRESH');assert.equal(a.tokens[0].address,A(1));assert.equal(a.opportunity.servedList,'V4_OPPORTUNITY');assert.ok(!a.tokens.some(t=>t.address===A(500)));
 assert.ok(a.tokens.every((x,i)=>x.rank===i+1&&x.fields&&typeof x.symbol==='string'));assert.equal(a.version,2);assert.equal(a.engine,'arcy-radar-v3');
 S._reset();const st=await S.apply('arc',live('arc'),{env,fetcher:fetcherFor(snap),now:NOW+8*3600000});assert.equal(st.opportunity.status,'STALE');assert.equal(st.freshness,'STALE');
 S._reset();const old=await S.apply('arc',live('arc'),{env,fetcher:fetcherFor(snap),now:NOW+30*3600000});
 assert.equal(old.opportunity.status,'UNAVAILABLE');assert.equal(old.tokens[0].address,A(500));
 S._reset();const nb=await S.apply('ethereum',{...live('arc'),network:'ethereum',chainId:1},{env,fetcher:fetcherFor(snap),now:NOW});
 assert.equal(nb.opportunity.reason,'SNAPSHOT_SECTION_NOT_BUILT');
});
test('public path: outage, invalid JSON, oversize and tampered snapshots fall back to legacy; last valid snapshot kept within TTL',async()=>{
 const env={RADAR_V4_OPPORTUNITY_ENABLED:'true'},snap=S.build(engineResult(),sections,{now:NOW});
 S._reset();let r=await S.apply('arc',live('arc'),{env,fetcher:fetcherFor(snap,{status:503}),now:NOW});assert.equal(r.opportunity.reason,'SNAPSHOT_HTTP_503');
 S._reset();r=await S.apply('arc',live('arc'),{env,fetcher:async()=>({ok:true,status:200,text:async()=>'{"schema":'}),now:NOW});assert.equal(r.opportunity.reason,'SNAPSHOT_INVALID_JSON');
 S._reset();r=await S.apply('arc',live('arc'),{env,fetcher:async()=>({ok:true,status:200,text:async()=>'x'.repeat(700000)}),now:NOW});assert.equal(r.opportunity.reason,'SNAPSHOT_TOO_LARGE');
 const t=structuredClone(snap);t.sections.arc.rows[0].opportunity.eligibility='EXCLUDE';
 S._reset();r=await S.apply('arc',live('arc'),{env,fetcher:fetcherFor(t),now:NOW});assert.equal(r.opportunity.reason,'SNAPSHOT_SECTION_INVALID');
 S._reset();await S.apply('arc',live('arc'),{env,fetcher:fetcherFor(snap),now:NOW});
 r=await S.apply('arc',live('arc'),{env,fetcher:async()=>{throw new TypeError('down');},now:NOW+11*60000});
 assert.equal(r.opportunity.status,'FRESH','last valid snapshot survives a transient outage');
 S._reset();const slow=await S.apply('arc',live('arc'),{env,fetcher:async(u,o)=>{assert.ok(o.signal instanceof AbortSignal);throw Object.assign(new Error('t'),{name:'TimeoutError'});},now:NOW});
 assert.equal(slow.opportunity.reason,'SNAPSHOT_TIMEOUT');
});
test('public path: cached read => one snapshot request per 10 minutes for all sections',async()=>{
 const env={RADAR_V4_OPPORTUNITY_ENABLED:'true'},f=fetcherFor(S.build(engineResult(),sections,{now:NOW}));S._reset();
 for(const n of ['arc','robinhood','pons'])await S.apply(n,live(n==='arc'?'arc':n),{env,fetcher:f,now:NOW});
 assert.equal(f.calls(),1);
});
test('snapshot ref override is restricted to a branch name on the fixed repository host (no SSRF)',()=>{
 assert.equal(S.url({RADAR_V4_SNAPSHOT_REF:'preview-1'}),'https://raw.githubusercontent.com/arcycoin-glitch/arcy-website/preview-1/radar-v4/snapshot.json');
 for(const ref of ['../x','evil.com/x','a b','http://x'])assert.equal(S.url({RADAR_V4_SNAPSHOT_REF:ref}),S.url({}));
});
test('radar API handler: gate OFF leaves the public response untouched (no extra request)',async()=>{
 const handler=require('../search/server/api/radar.js');assert.equal(typeof handler,'function');
 const src=require('node:fs').readFileSync(require.resolve('../search/server/api/radar.js'),'utf8');
 assert.match(src,/V4\.serve\(network/);assert.ok(src.indexOf('V4.serve(network')<src.indexOf('radar.load(network'),'snapshot-first ordering');
});
// ── snapshot-first handler (production blocker fix) ──
function handlerHarness(){
 const radar=require('../lib/radar-v2'),handler=require('../search/server/api/radar.js');
 const call=async(chain)=>{const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
  await handler({method:'GET',query:{chain},headers:{'sec-fetch-site':'same-origin'}},res);return res;};
 return {radar,call};
}
async function withEnv(vars,fn){const keys=Object.keys(vars),old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
 const of=global.fetch,radar=require('../lib/radar-v2'),ol=radar.load;S._reset();
 try{return await fn();}finally{for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];global.fetch=of;radar.load=ol;S._reset();}}
const ON={RADAR_V4_OPPORTUNITY_ENABLED:'true',MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true'};
const providerDown=async()=>{throw Object.assign(Error('RADAR_PROVIDER_HTTP_503'),{code:'RADAR_PROVIDER_HTTP_503'});};
test('handler: fresh V4 snapshot is served even when the legacy provider fails (no legacy call)',()=>withEnv(ON,async()=>{
 const {radar,call}=handlerHarness();const snap=S.build(engineResult(),sections,{now:Date.now()});let legacyCalls=0;
 radar.load=async()=>{legacyCalls++;return providerDown();};
 global.fetch=async(u)=>{assert.equal(u,S.url(process.env));return {ok:true,status:200,text:async()=>JSON.stringify(snap)};};
 const r=await call('arc');
 assert.equal(r.code,200);assert.equal(r.body.opportunity.servedList,'V4_OPPORTUNITY');assert.equal(r.body.freshness,'FRESH');assert.equal(legacyCalls,0);
 assert.match(r.headers['Cache-Control'],/s-maxage=/);assert.equal(r.body.version,2);assert.equal(r.body.engine,'arcy-radar-v3');
}));
test('handler: stale (6-24 h) V4 snapshot is served as STALE with no-store when the provider fails',()=>withEnv(ON,async()=>{
 const {radar,call}=handlerHarness();const snap=S.build(engineResult(),sections,{now:Date.now()-8*3600000});
 radar.load=providerDown;global.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify(snap)});
 const r=await call('arc');assert.equal(r.code,200);assert.equal(r.body.freshness,'STALE');assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.body.opportunity.status,'STALE');
}));
test('handler: expired / invalid / missing-branch snapshot + healthy legacy => legacy list, labelled; both down => honest 503',()=>withEnv(ON,async()=>{
 const {radar,call}=handlerHarness();
 radar.load=async(n)=>({...live(n),network:n});
 for(const [body,status,reason] of [[S.build(engineResult(),sections,{now:Date.now()-30*3600000}),200,'SNAPSHOT_SECTION_EXPIRED'],[{schema:'bad'},200,'SNAPSHOT_SCHEMA_INVALID'],[{},404,'SNAPSHOT_HTTP_404'],[{},403,'SNAPSHOT_HTTP_403'],[{},429,'SNAPSHOT_HTTP_429'],[{},503,'SNAPSHOT_HTTP_503']]){
  S._reset();global.fetch=async()=>({ok:status===200,status,text:async()=>JSON.stringify(body)});
  const r=await call('arc');assert.equal(r.code,200);assert.equal(r.body.tokens[0].address,A(500));assert.equal(r.body.opportunity.reason,reason,reason);
 }
 S._reset();radar.load=providerDown;global.fetch=async()=>({ok:false,status:503,text:async()=>''});
 const down=await call('arc');assert.equal(down.code,503);assert.equal(down.body.ok,false);assert.ok(!down.body.tokens,'no fabricated candidates');
}));
test('handler: V4 not served unless the existing publication approvals are set; gate OFF never fetches the snapshot',()=>withEnv({RADAR_V4_OPPORTUNITY_ENABLED:'true',MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'false'},async()=>{
 const {radar,call}=handlerHarness();let fetched=0;global.fetch=async()=>{fetched++;return {ok:true,status:200,text:async()=>'{}'};};
 radar.load=async()=>{throw Object.assign(Error('RADAR_NOT_CONFIGURED'),{code:'RADAR_NOT_CONFIGURED'});};
 const r=await call('arc');assert.equal(r.code,503);assert.equal(fetched,0);
 delete process.env.RADAR_V4_OPPORTUNITY_ENABLED;process.env.MARKET_RADAR_PUBLIC_DISPLAY_APPROVED='true';process.env.MARKET_RADAR_JSON_DELIVERY_APPROVED='true';
 radar.load=async(n)=>({...live(n),network:n});const off=await call('arc');assert.equal(fetched,0);assert.equal(off.body.opportunity,undefined,'legacy response byte-identical when OFF');
}));
test('serving path: concurrent requests share one snapshot read; cache expiry triggers exactly one refresh',async()=>{
 S._reset();let n=0;const snap=S.build(engineResult(),sections,{now:NOW});
 const f=async()=>{n++;await new Promise(r=>setTimeout(r,20));return {ok:true,status:200,text:async()=>JSON.stringify(snap)};};
 const env={RADAR_V4_OPPORTUNITY_ENABLED:'true'};
 const rs=await Promise.all(['arc','robinhood','pons','arc','pons'].map(x=>S.serve(x,{env,fetcher:f,now:NOW})));
 assert.equal(n,1);assert.ok(rs.every(r=>r.data));
 await S.serve('arc',{env,fetcher:f,now:NOW+11*60000});assert.equal(n,2);
});
test('serving path: exact-address Pons/Robinhood integrity even if a stored snapshot slipped a duplicate past an old validator',async()=>{
 S._reset();const snap=S.build(engineResult(),sections,{now:NOW});
 // simulate an older publisher: duplicate placed in robinhood AFTER validation
 const dup={...snap.sections.pons.rows[0],network:'robinhood',rank:2};snap.sections.robinhood.rows.push(dup);
 assert.equal(S.validate(snap).ok,false,'publisher validator rejects it');
 const r=await S.serve('robinhood',{env:{RADAR_V4_OPPORTUNITY_ENABLED:'true'},fetcher:async()=>({ok:true,status:200,text:async()=>JSON.stringify(snap)}),now:NOW});
 assert.equal(r.data,null,'server refuses the whole invalid snapshot rather than serving a duplicate');
 const ok=S.build(engineResult(),sections,{now:NOW});S._reset();
 const good=await S.serve('robinhood',{env:{RADAR_V4_OPPORTUNITY_ENABLED:'true'},fetcher:async()=>({ok:true,status:200,text:async()=>JSON.stringify(ok)}),now:NOW});
 const pons=new Set(ok.sections.pons.rows.map(x=>x.address));assert.ok(good.data.tokens.every(x=>!pons.has(x.address)));
});
test('category regression: Ethereum "NEAR" is never an early-stage project by ticker; exact Rainbow NEAR is bridged established',()=>{
 assert.equal(CAT.classify({chainId:1,address:'0x85f17cf997934a597031b2e18a9ab6ebd4b9f6a4',symbol:'NEAR',name:'NEAR'},'ethereum',NOW).category,'BRIDGED_ESTABLISHED_ASSET');
 assert.equal(CAT.classify({chainId:1,address:A(42),symbol:'NEAR',name:'NEAR'},'ethereum',NOW).category,'MAJOR_ASSET_TICKER_WITHOUT_IDENTITY');
 assert.ok(CAT.BLOCKED.has('MAJOR_ASSET_TICKER_WITHOUT_IDENTITY'));
 assert.equal(CAT.classify({chainId:1,address:'0x7e37ac5d67ebe99851193cd036d7725b6730c53d',symbol:'NEARon',name:'iShares Short Duration Bond Active ETF (Ondo Tokenized)'},'ethereum',NOW).category,'TOKENIZED_EQUITY');
 assert.equal(CAT.classify({chainId:1,address:A(43),symbol:'NEARX',name:'Nearby App'},'ethereum',NOW).category,'EARLY_STAGE_CANDIDATE','no substring matching');
});
test('category regression from primary-source research: WPRL is a bridge wrapper, GDLR is gold-backed, "Wrapped X" names are wrappers',()=>{
 assert.equal(CAT.classify({chainId:1,address:'0x07696dcab55e62cfef953666b29fe1970518cb00',symbol:'WPRL',name:'Wrapped Pearl'},'ethereum',NOW).category,'WRAPPED_OR_BASE_ASSET');
 assert.equal(CAT.classify({chainId:1,address:'0xa038a26bf960451b8ce75ec4c92013c6307f8e4e',symbol:'GDLR',name:'GDollar'},'ethereum',NOW).category,'COMMODITY_BACKED');
 assert.equal(CAT.classify({chainId:4663,address:A(44),symbol:'WFOO',name:'Wrapped Foo'},'robinhood',NOW).category,'WRAPPED_OR_BASE_ASSET');
 assert.equal(CAT.classify({chainId:4663,address:A(45),symbol:'WRAPX',name:'Wrapstar Protocol'},'robinhood',NOW).category,'EARLY_STAGE_CANDIDATE');
});
test('category regression (live Arc): XAUM-style precious-metal tickers are never early-stage without an issuer record',()=>{
 for(const sym of ['XAUM','XAUt','PAXG','XAG']) {const c=CAT.classify({chainId:5042,address:A(46),symbol:sym,name:sym},'arc',NOW).category;assert.equal(c,'COMMODITY_TICKER_WITHOUT_IDENTITY',sym);}
 assert.equal(CAT.classify({chainId:5042,address:A(47),symbol:'XAUNCH',name:'Xaunch'},'arc',NOW).category,'EARLY_STAGE_CANDIDATE');
});
test('Info sentence: parts never contain the UI separator (live preview regression)',()=>{
 const o=OPP.evaluate({candidate:cand(),evidence:{product:product()},network:'robinhood',now:NOW});
 const t=OPP.infoReason(o,{eligibility:'REVIEW',dossier:{status:'PARTIAL_EVIDENCE'}});
 assert.ok(t.split(';').every(p=>!/[()]/.test(p)||/\(.*\)/.test(p)),t);
 assert.match(t,/kısmi kanıt \(resmi site kontratı yayınlıyor, bağlantı eksik\)/);
});
