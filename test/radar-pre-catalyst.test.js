'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../lib/radar-v2/pre-catalyst');
const {probe}=require('../scripts/probe-radar-pre-catalyst.cjs');
const NOW=Date.parse('2026-11-17T12:00:00Z'),DAY=86400000;
const ADDR='0x'+'a'.repeat(40),POOL='0x'+'b'.repeat(40),QUOTE='0x'+'c'.repeat(40);
const source='https://example.org/official/release';
const iso=n=>new Date(NOW-n*DAY).toISOString();
function candidate(network='ethereum'){
 const chainId={arc:5042,ethereum:1,robinhood:4663,pons:4663}[network];
 return {network,chainId,address:ADDR,pool:POOL,poolCount:1,poolCreatedAt:iso(40),symbol:'TST',name:'Test Project',priceUsd:1,
  radarAsOf:iso(0),radarFreshness:'FRESH',
  discovery:{version:'arcy-discovery-2',score:68},...(network==='pons'?{launch:{status:'ONCHAIN_VERIFIED',factory:'0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb',block:'0x100'}}:{})};
}
function history(c,prices=()=>1,options={}){
 const floor={arc:[5000,20000],ethereum:[100000,200000],robinhood:[10000,25000],pons:[1000,3000]}[c.network];
 const candles=[],historicalLiquidity=[];
 for(let d=30;d>=0;d--){const t=Math.floor((NOW-d*DAY)/1000),p=prices(d);
  candles.push([t,p,p,p,p,options.dustDay===d?1:floor[0]]);
  historicalLiquidity.push({timestamp:t,liquidityUsd:options.dustDay===d?1:floor[1]*2,status:'ONCHAIN_VERIFIED',
   method:'HISTORICAL_RESERVE_AT_BLOCK',blockNumber:100000+d,sourceUrl:source,observedAt:iso(0),sampleAt:new Date(t*1000).toISOString(),
   chainId:c.chainId,pool:POOL,tokenAddress:c.address});
 }
 return {network:c.network,chainId:c.chainId,address:POOL,tokenAddress:c.address,quoteAddress:QUOTE,tokenSide:'base',
  source:'COINGECKO_POOL_OHLCV',planAuthorized:true,
  sourceUrl:'https://api.coingecko.com/api/v3/onchain/networks/'+(c.network==='ethereum'?'eth':c.network==='pons'?'robinhood':c.network)+'/pools/'+POOL+'/ohlcv/day',
  asOf:iso(0),candles,historicalLiquidity};
}
function evidence(c,prices){
 const bind={chainId:c.chainId,address:c.address,sourceUrl:source,observedAt:iso(1),publisherVerified:true};
 return {identity:{...bind,status:'OFFICIAL_TOKEN_MATCHED',proofKind:'OFFICIAL_TOKEN_ADDRESS',officialHosts:['example.org']},history:[history(c,prices)],
  product:{...bind,status:'VERIFIED_ACTIVE',updates:[{...bind,status:'VERIFIED_RELEASE',sourceUrl:'https://example.org/release/1'},
   {...bind,status:'VERIFIED_RELEASE',sourceUrl:'https://example.org/release/2'}]},
  catalyst:{...bind,status:'CONFIRMED_PUBLIC_EVENT',kind:'TESTNET',claim:'Official public testnet release scheduled.',eventAt:new Date(NOW+10*DAY).toISOString()},
  risk:{sell:{...bind,status:'SELL_ENABLED_VERIFIED'},mint:{...bind,status:'MINT_BOUNDED_VERIFIED'},
   admin:{...bind,status:'ADMIN_REVIEWED'},holders:{...bind,status:'DISTRIBUTED_VERIFIED'}},
  exit:{...bind,status:'EXIT_SIMULATED',executableUsd:10000,poolLiquidityUsd:1e6},
  demand:{...bind,status:'ONCHAIN_VERIFIED',distinctBuyers:30,clusterReview:'REVIEWED_NO_CONCENTRATION',washReview:'REVIEWED_NO_SELF_TRADE'}};
}
const decision=(c,e)=>P.evaluate(c,e,NOW);
test('verified sustained 8x and 20x are excluded; 9x then 90% down remains excluded',()=>{
 const c=candidate();
 for(const multiple of [8,20,9]){
  const e=evidence(c,d=>d>=11&&d<=13?multiple:1);
  const r=decision(c,e);assert.equal(r.decision,'EXCLUDE');assert.ok(r.reasons.includes('EXCLUDE_ALREADY_RAN_8X'));
  assert.equal(r.runup.status,'EXCLUDE_ALREADY_RAN_8X');
 }
});
test('two independent verified pool-level 24h gains >=700% veto a late 8x token without historical provider calls',()=>{
 const c=candidate(),e=evidence(c);
 c.change24hPct=704;
 c.fields={change24hPct:{status:'CROSS_VERIFIED',value:704,
  sources:[{provider:'GeckoTerminal',value:704},{provider:'DEX Screener',value:701}]}};
 const result=decision(c,{...e,history:[]});
 assert.equal(result.decision,'EXCLUDE');
 assert.ok(result.reasons.includes('EXCLUDE_VERIFIED_24H_8X'));
 assert.equal(result.recentRunup.status,'EXCLUDE_VERIFIED_24H_8X');
 assert.equal(result.runup.status,'RUNUP_NOT_VERIFIED','recent proof never pretends to clear 30d history');
 assert.equal(result.recentRunup.window,'OBSERVED_24H');
});
test('single-source, mismatched, young pool, sparse and 699% reports cannot assert a verified 8x',()=>{
 const c=candidate(),e=evidence(c);
 c.change24hPct=704;
 c.fields={change24hPct:{status:'SOURCE_REPORTED',value:704,
  sources:[{provider:'GeckoTerminal',value:704}]}};
 assert.equal(decision(c,{...e,history:[]}).decision,'REVIEW');
 c.fields.change24hPct.status='CROSS_VERIFIED';
 c.fields.change24hPct.sources.push({provider:'DEX Screener',value:699});
 assert.notEqual(decision(c,{...e,history:[]}).recentRunup.status,'EXCLUDE_VERIFIED_24H_8X');
 c.fields.change24hPct.sources[1].value=704;
 c.fields.change24hPct.scope='TOKEN';
 assert.notEqual(decision(c,{...e,history:[]}).recentRunup.status,'EXCLUDE_VERIFIED_24H_8X');
 delete c.fields.change24hPct.scope;
 c.poolCreatedAt=iso(0);
 assert.notEqual(decision(c,{...e,history:[]}).recentRunup.status,'EXCLUDE_VERIFIED_24H_8X');
 c.poolCreatedAt=iso(40);
 c.change24hPct=-95;c.fields.change24hPct.value=-95;
 c.fields.change24hPct.sources.forEach(x=>x.value=-95);
 assert.equal(decision(c,{...e,history:[]}).decision,'REVIEW','deep drawdown is not a negative or positive shortcut');
});
test('30d runup is found even when 7d is clean; 7d runup is independently found',()=>{
 const c=candidate();
 let r=decision(c,evidence(c,d=>d>=10&&d<=12?9:1));
 assert.equal(r.runup.pools[0].windows.day30.status,'EXCLUDE_ALREADY_RAN_8X');
 assert.equal(r.runup.pools[0].windows.day7.status,'RUNUP_CLEARED');
 r=decision(c,evidence(c,d=>d>=2&&d<=4?9:1));
 assert.equal(r.runup.pools[0].windows.day7.status,'EXCLUDE_ALREADY_RAN_8X');
});
test('one-candle wick and dust low do not manufacture an 8x baseline or peak',()=>{
 const c=candidate();
 const wick=evidence(c);wick.history[0].candles[15][2]=20;
 assert.equal(decision(c,wick).decision,'ELIGIBLE');
 const dust=evidence(c);dust.history[0].candles[0][1]=.01;dust.history[0].candles[0][2]=.01;dust.history[0].candles[0][3]=.01;dust.history[0].candles[0][4]=.01;
 dust.history[0].candles[0][5]=1;dust.history[0].historicalLiquidity[0].liquidityUsd=1;
 assert.notEqual(decision(c,dust).runup.status,'EXCLUDE_ALREADY_RAN_8X');
});
test('sustained 5x to below 8x is review, never an automatic opportunity credit',()=>{
 const c=candidate(),r=decision(c,evidence(c,d=>d>=11&&d<=13?6:1));
 assert.equal(r.decision,'REVIEW');assert.equal(r.runup.pools[0].windows.day30.reason,'PRIOR_5X_TO_8X');
});
test('migration, missing history and unsupported source never clear the pump gate',()=>{
 const c=candidate(),e=evidence(c);c.poolCount=2;
 assert.equal(decision(c,e).runup.status,'RUNUP_NOT_VERIFIED');
 assert.equal(decision(c,{...e,history:[]}).decision,'REVIEW');
 const pumped=evidence(c,d=>d>=11&&d<=13?9:1);
 assert.equal(decision(c,pumped).runup.status,'EXCLUDE_ALREADY_RAN_8X','a verified pump in one pool cannot be hidden by a later migration');
 e.history[0].planAuthorized=false;assert.equal(decision(c,e).runup.status,'RUNUP_NOT_VERIFIED');
});
test('wrong chain, ticker impostor and young pool cannot become eligible',()=>{
 const c=candidate(),e=evidence(c);e.history[0].chainId=5042;
 assert.equal(decision(c,e).runup.status,'RUNUP_NOT_VERIFIED');
 assert.equal(decision({...c,chainId:5042},e).decision,'EXCLUDE');
 assert.equal(decision({...c,name:'Tesla',symbol:'TSLA'},e).decision,'EXCLUDE');
 assert.equal(decision({...c,poolCreatedAt:iso(0)},e).runup.reason,'POOL_UNDER_24H');
});
test('no official affiliation, rumor, old announcement, sparse releases and abandonment fail closed',()=>{
 const c=candidate(),e=evidence(c);
 assert.equal(decision(c,e).decision,'ELIGIBLE');
 assert.ok(decision(c,{...e,identity:null}).reasons.includes('IDENTITY_NOT_VERIFIED'));
 assert.ok(decision(c,{...e,identity:{...e.identity,officialHosts:['impostor.example']}}).reasons.includes('IDENTITY_NOT_VERIFIED'));
 assert.ok(decision(c,{...e,catalyst:{...e.catalyst,status:'RUMOR_UNVERIFIED'}}).reasons.includes('RUMOR_UNVERIFIED'));
 assert.ok(decision(c,{...e,catalyst:{...e.catalyst,kind:'EXCHANGE_LISTING',claim:'Rumored Binance listing next month.'}}).reasons.includes('CATALYST_NOT_VERIFIED'));
 assert.ok(decision(c,{...e,catalyst:{...e.catalyst,eventAt:iso(2)}}).reasons.includes('CATALYST_NOT_VERIFIED'));
 assert.ok(decision(c,{...e,product:{...e.product,updates:e.product.updates.slice(0,1)}}).reasons.includes('PRODUCT_CONTINUITY_NOT_VERIFIED'));
 assert.ok(decision(c,{...e,product:{...e.product,status:'ABANDONED_VERIFIED'}}).reasons.includes('ABANDONED_PROJECT'));
});
test('trades do not count as distinct buyers; churn, dangerous rights and exit limits stay gated',()=>{
 const c=candidate(),e=evidence(c);
 assert.ok(decision(c,{...e,demand:{...e.demand,distinctBuyers:1,trades:10000}}).reasons.includes('ORGANIC_BUYER_BREADTH_NOT_VERIFIED'));
 assert.ok(decision(c,{...e,demand:{...e.demand,clusterReview:'NOT_VERIFIED'}}).reasons.includes('ORGANIC_BUYER_BREADTH_NOT_VERIFIED'));
 assert.ok(decision(c,{...e,demand:{...e.demand,washReview:'NOT_VERIFIED'}}).reasons.includes('ORGANIC_BUYER_BREADTH_NOT_VERIFIED'));
 assert.ok(decision(c,{...e,risk:{...e.risk,mint:{...e.risk.mint,status:'UNLIMITED_MINT_VERIFIED'}}}).reasons.includes('UNLIMITED_MINT'));
 assert.ok(decision(c,{...e,risk:{...e.risk,sell:{...e.risk.sell,status:'SELL_DISABLED_VERIFIED'}}}).reasons.includes('SELL_DISABLED'));
 assert.ok(decision(c,{...e,exit:{...e.exit,status:'EXIT_FAILED_VERIFIED'}}).reasons.includes('LOW_EXIT_LIQUIDITY'));
 assert.ok(decision(c,{...e,sourceConsistency:'CONTRADICTED'}).reasons.includes('SOURCE_CONTRADICTION'));
});
test('stale/429/503/timeout-equivalent missing source observations never promote',()=>{
 const c=candidate(),e=evidence(c);
 for(const state of ['STALE','RATE_LIMITED_429','UNAVAILABLE_503','TIMEOUT']){
  const degraded={...e,history:state==='STALE'?[{...e.history[0],asOf:iso(2)}]:null};
  assert.equal(decision(c,degraded).decision,'REVIEW');
  assert.ok(decision(c,degraded).reasons.includes('RUNUP_NOT_VERIFIED'));
 }
});
test('Arc, Ethereum, Robinhood and Pons use exact chain identity and fixed existing score ordering',()=>{
 for(const network of ['arc','ethereum','robinhood','pons']){
  const c=candidate(network),e=evidence(c);assert.equal(decision(c,e).decision,'ELIGIBLE',network);
  const empty=P.shortlist([c],{},NOW);assert.equal(empty.eligible.length,0);assert.equal(empty.counts.review,1);
 }
 const c=candidate(),e=evidence(c),c2={...c,address:'0x'+'d'.repeat(40),discovery:{version:'arcy-discovery-2',score:99}};
 const result=P.shortlist([c,c,c2],{[c.chainId+':'+c.address]:e},NOW);
 assert.equal(result.eligible.length,1);assert.equal(result.eligible[0].discoveryScore,68);
 assert.ok(result.diagnostics.some(x=>x.reasons.includes('DUPLICATE_EXACT_CONTRACT')));
});
test('official OHLCV six-column parser binds exact base token, quote and pool',()=>{
 const c=candidate(),raw={data:{type:'ohlcv_request_response',attributes:{ohlcv_list:history(c).candles}},
  meta:{base:{address:c.address},quote:{address:QUOTE}}};
 const request={candidate:c,pool:POOL,quoteAddress:QUOTE,planAuthorized:true,sourceUrl:history(c).sourceUrl,asOf:iso(0)};
 const parsed=P.parsePoolOhlcv(raw,request);
 assert.equal(parsed.candles.length,31);
 assert.equal(P.inspectHistory(c,[parsed],NOW).status,'RUNUP_NOT_VERIFIED','OHLCV alone lacks historical liquidity proof');
 assert.equal(P.parsePoolOhlcv({...raw,meta:{...raw.meta,base:{address:QUOTE}}},request).status,'RUNUP_NOT_VERIFIED');
 assert.equal(P.parsePoolOhlcv(raw,{...request,quoteAddress:ADDR}).status,'RUNUP_NOT_VERIFIED');
 assert.equal(P.inspectHistory(c,[{...history(c),sourceUrl:'https://example.org/fake'}],NOW).status,'RUNUP_NOT_VERIFIED');
});
test('shadow probe is bounded to four existing API reads and publishes no eligible claim without proof',async()=>{
 const seen=[],fetcher=async url=>{seen.push(url);const chain=new URL(url).searchParams.get('chain');
  if(chain==='ethereum')return {ok:false,status:503};
  return {ok:true,status:200,json:async()=>({ok:true,network:chain,tokens:[candidate(chain)],freshness:'FRESH',asOf:iso(0),usage:{geckoterminal:3},coverage:{poolsInspected:20}})};
 };
 const result=await probe({fetcher,now:NOW});
 assert.equal(seen.length,4);assert.equal(result.requests,4);
 assert.equal(result.sections.ethereum.status,'SOURCE_UNAVAILABLE');
 for(const network of ['arc','robinhood','pons']){assert.equal(result.sections[network].eligible,0);assert.equal(result.sections[network].review,1);}
 await assert.rejects(()=>probe({fetcher,base:'https://not-arcy.example',now:NOW}),/SHADOW_BASE_NOT_ALLOWED/);
});
test('shadow probe reports 429, 503 and timeout without retrying or publishing',async()=>{
 const seen=[];
 const result=await probe({now:NOW,fetcher:async url=>{
  const chain=new URL(url).searchParams.get('chain');seen.push(chain);
  if(chain==='arc')return {ok:false,status:429};
  if(chain==='ethereum')return {ok:false,status:503};
  throw Object.assign(Error('simulated timeout'),{name:'TimeoutError'});
 }});
 assert.deepEqual(seen,['arc','ethereum','robinhood','pons']);
 assert.equal(result.sections.arc.http,429);assert.equal(result.sections.ethereum.http,503);
 assert.equal(result.sections.robinhood.error,'TIMEOUT');assert.equal(result.sections.pons.eligible,0);
});
