'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const keccak=require('../lib/keccak');
const pool=require('../lib/risk-engine/producers/pool');
const conc=require('../lib/risk-engine/producers/concentration');
const {evaluateRisk}=require('../lib/risk-engine');
const evidence=require('../lib/verification/metric-evidence');
const observer=require('../lib/verification/onchain-observer');
const v2=require('../lib/liquidity-exit-v2');
const v3=require('../lib/liquidity-exit-v3');
const V3F=v3.PROTOCOLS.ethereum[0].factory,V3POOL='0x'+'53'.repeat(20);

const NOW=Date.parse('2026-11-14T00:00:00.000Z'),BLOCK='0x64',HASH='0x'+'11'.repeat(32),TS=Math.floor((NOW-60000)/1000);
const TOKEN='0x'+'ab'.repeat(20),PAIR='0x'+'50'.repeat(20),PAIR2='0x'+'51'.repeat(20);
const A=pool.ANCHORS.ethereum,USDC=A[0],WETH=A[1],USDT=A[2];
const [UNI,SUSHI]=v2.PROTOCOLS.ethereum;
const sel=s=>'0x'+keccak(Buffer.from(s)).slice(2,10);
const W=v=>'0x'+BigInt.asUintN(256,BigInt(v)).toString(16).padStart(64,'0');
const ADDRW=a=>'0x'+a.slice(2).padStart(64,'0');
const abiStr=s=>{const h=Buffer.from(s).toString('hex');return '0x'+(32).toString(16).padStart(64,'0')+s.length.toString(16).padStart(64,'0')+h.padEnd(64*Math.ceil(Math.max(1,h.length)/64),'0');};
const quote=(amountIn,rin,rout,fee)=>{const s=amountIn*BigInt(10000-fee);return s*rout/(rin*10000n+s);};
beforeEach(()=>observer._resetHealth());

// Ethereum fake: one UNI V2 pair TOKEN/USDC with 1,000,000 TOKEN and 500,000 USDC ($0.50 per token, $1,000,000 pool).
function poolChain(over={}){
 const calls=[];
 const base={chainId:'0x1',hash:HASH,ts:TS,usdcAnswer:100000000n,usdcUpdated:BigInt(TS-600),ethAnswer:300000000000n,desc:{},pairs:{[UNI.factory+USDC.token]:PAIR},
  pairFactory:UNI.factory,reserves:{[PAIR]:[10n**24n,500000n*10n**6n]},balancesExtra:0n,routerSkew:0n,tokenIs0:true,...over};
 const fetcher=async(url,init)=>{
  const host=new URL(url).hostname,q=JSON.parse(init.body),b={...base,...(over.hosts?.[host]||{})};calls.push({host,method:q.method,params:q.params});
  const ok=result=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
  const revert=()=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:3,message:'execution reverted'}}));
  if(b.http)return new Response('x',{status:b.http});
  if(q.method==='eth_chainId')return ok(b.chainId);
  if(q.method==='eth_getBlockByNumber')return ok({number:q.params[0],hash:b.hash,timestamp:'0x'+b.ts.toString(16)});
  if(q.method!=='eth_call')return revert();
  const {to,data}=q.params[0],s=data.slice(0,10);
  const feed=A.find(x=>x.feed===to);
  if(feed){
   if(s===sel('description()'))return ok(abiStr(b.desc[feed.asset]??feed.description));
   if(s===sel('decimals()'))return ok(W(b.feedDecimals??8));
   if(s===sel('latestRoundData()')){const ans=feed.asset==='WETH'?b.ethAnswer:b.usdcAnswer,upd=b.usdcUpdated;return ok('0x'+[W(7),W(ans),W(upd),W(upd),W(b.answeredIn??7)].map(x=>x.slice(2)).join(''));}
  }
  const asset=A.find(x=>x.token===to);
  if(asset&&s===sel('decimals()'))return ok(W(b.quoteDecimals?.[asset.asset]??asset.tokenDecimals));
  if(s===v2.SELECTORS.getPair){const t=[('0x'+data.slice(34,74)),('0x'+data.slice(98,138))];const p=b.pairs[to+t[1]]||b.pairs[to+t[0]];return ok(ADDRW(p||'0x'+'0'.repeat(40)));}
  const r=b.reserves[to];
  if(r){
   const [rt,rq]=r,t0=b.tokenIs0?TOKEN:USDC.token,t1=b.tokenIs0?USDC.token:TOKEN;
   if(s===v2.SELECTORS.factory)return ok(ADDRW(b.pairFactories?.[to]||b.pairFactory));
   if(s===v2.SELECTORS.token0)return b.badToken0?ok('0x1234'):ok(ADDRW(b.token0??t0));
   if(s===v2.SELECTORS.token1)return ok(ADDRW(t1));
   if(s===v2.SELECTORS.getReserves){const [r0,r1]=b.tokenIs0?[rt,rq]:[rq,rt];return ok('0x'+[W(r0),W(r1),W(TS-30)].map(x=>x.slice(2)).join(''));}
  }
  if(to===V3F&&s===v3.SELECTORS.getPool){const fee=Number(BigInt('0x'+data.slice(138,202)));return ok(ADDRW(b.v3Pools?.[fee]||'0x'+'0'.repeat(40)));}
  if(s===v2.SELECTORS.balanceOf&&b.v3Balances?.['0x'+data.slice(34,74)]!==undefined)return ok(W(b.v3Balances['0x'+data.slice(34,74)]));
  if(s===v2.SELECTORS.balanceOf){const who='0x'+data.slice(34,74),rr=b.reserves[who];if(!rr)return ok(W(0));const isTok=to===TOKEN;return ok(W((isTok?rr[0]:rr[1])+b.balancesExtra));}
  if(to===UNI.router&&s===v2.SELECTORS.getAmountsOut){const amountIn=BigInt('0x'+data.slice(10,74)),[rt,rq]=b.reserves[PAIR];const out=quote(amountIn,rt,rq,30)+b.routerSkew;
   return ok('0x'+[W(32),W(2),W(amountIn),W(out)].map(x=>x.slice(2)).join(''));}
  return revert();
 };
 return {fetcher,calls};
}
const FAST={ARC_RISK_RPC_MIN_INTERVAL_MS:'0'};
const run=(sim,extra={})=>pool.produce({network:'ethereum',token:TOKEN,block:BLOCK,env:FAST,fetcher:sim.fetcher,now:()=>NOW,...extra});
const rec=(r,id)=>r.records.find(x=>x.metricId===id);
const findingFor=(r,rule,{now=NOW,scope=r.pool}={})=>evaluateRisk({network:'ethereum',chainId:1,token:TOKEN,scope,evidence:r.records,now}).findings.find(f=>f.ruleId===rule);

test('pool producer: $1M V2 pool is verified liquid on two operators; $1,000 exit impact is measured but never a safety verdict',async()=>{
 const sim=poolChain(),r=await run(sim);
 assert.equal(r.pool,PAIR);
 const liq=rec(r,'risk.pool-liquidity'),exit=rec(r,'risk.exit-impact');
 assert.equal(liq.state,'VERIFIED_ONCHAIN',liq.reasonCode);assert.equal(liq.value,'100000000');assert.equal(liq.scope,PAIR);
 assert.doesNotThrow(()=>evidence.parseMetricEvidence(liq));assert.doesNotThrow(()=>evidence.parseMetricEvidence(exit));
 assert.equal(exit.state,'VERIFIED_ONCHAIN');assert.equal(exit.value,20); // 2,000 tokens into 1,000,000: ~0.2%, fee excluded
 assert.equal(findingFor(r,'low-pool-liquidity').status,'NOT_CONFIRMED');
 // Low impact is positive-only: the gate refuses the negative verdict.
 const f=findingFor(r,'high-exit-impact');assert.equal(f.status,'UNKNOWN');assert.equal(f.reasonCode,'PRODUCER_NOT_REVIEWED');
 const o=r.operators[0].outcome;assert.equal(o.exit.feeBps,30);assert.equal(o.exit.amountIn,(2000n*10n**18n).toString());assert.equal(o.exit.routerAmountOut,o.exit.amountOut);
 assert.ok(sim.calls.every(c=>['eth_chainId','eth_getBlockByNumber','eth_call'].includes(c.method)));
 for(const op of r.operators)assert.ok(op.rpcCalls<=pool.LIMITS.callsPerEndpoint);
});

test('pool producer: a thin pool is CONFIRMED low liquidity and a $1,000 sale with >= 5% impact is CONFIRMED',async()=>{
 // 20,000 TOKEN / 10,000 USDC => $20,000 pool, $0.50 per token: $1,000 = 2,000 TOKEN = 10% of the token reserve.
 const r=await run(poolChain({reserves:{[PAIR]:[20000n*10n**18n,10000n*10n**6n]}}));
 assert.equal(rec(r,'risk.pool-liquidity').value,'2000000');
 assert.equal(findingFor(r,'low-pool-liquidity').status,'CONFIRMED');
 assert.ok(rec(r,'risk.exit-impact').value>=500);assert.equal(findingFor(r,'high-exit-impact').status,'CONFIRMED');
 // A pool far too small for $1,000 still yields a bounded impact, never an invented number.
 const tiny=await run(poolChain({reserves:{[PAIR]:[100n*10n**18n,50n*10n**6n]}}));
 assert.ok(rec(tiny,'risk.exit-impact').value>9000&&rec(tiny,'risk.exit-impact').value<=10000);
});

test('pool producer: every reviewed constant is a well-formed address',()=>{
 for(const a of Object.values(pool.ANCHORS).flat()){assert.match(a.token,/^0x[0-9a-f]{40}$/);assert.match(a.feed,/^0x[0-9a-f]{40}$/);}
 assert.equal(pool.ANCHORS.ethereum.find(a=>a.asset==='WETH').token,'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
});

test('pool producer: invalid USD anchors, wrong identity, unreviewed factories and model mismatches never produce a verdict',async()=>{
 const none=r=>{assert.equal(r.records.length,0,JSON.stringify(r.reasonCode));};
 // Feed identity / decimals / stale / non-positive / incomplete round: the quote asset is removed, no default price.
 for(const [over,reason] of [[{desc:{USDC:'USDT / USD',WETH:'x',USDT:'y'}},'ANCHOR_IDENTITY_MISMATCH'],[{feedDecimals:18},'ANCHOR_DECIMALS_MISMATCH'],
  [{usdcUpdated:BigInt(TS-200000),ethAnswer:300000000000n},'ANCHOR_STALE'],[{usdcAnswer:0n},'ANCHOR_NON_POSITIVE'],[{answeredIn:6},'ANCHOR_ROUND_INCOMPLETE'],[{quoteDecimals:{USDC:18,WETH:6,USDT:18}},'QUOTE_DECIMALS_MISMATCH']]){
  observer._resetHealth();const r=await run(poolChain(over));
  const q=r.operators[0].outcome.quotes.find(x=>x.asset==='USDC');assert.equal(q.reason,reason);assert.equal(q.answer,null);
  if(reason!=='ANCHOR_STALE')none(r); // stale only hits the 24 h USDC/USDT feeds here; ETH is fresh but has no pair
 }
 observer._resetHealth();
 // Pool says its factory is another one / token0 is not the token / reserves exceed balances / zero reserve.
 none(await run(poolChain({pairFactory:'0x'+'99'.repeat(20)})));
 none(await run(poolChain({token0:'0x'+'77'.repeat(20)})));
 none(await run(poolChain({balancesExtra:-1n})));
 none(await run(poolChain({reserves:{[PAIR]:[0n,500000n*10n**6n]}})));
 // No reviewed pair for the token at all.
 none(await run(poolChain({pairs:{}})));
 // Router disagrees with the constant-product model: liquidity is still a pool fact, exit impact is not determinable.
 const skew=await run(poolChain({routerSkew:1n}));
 assert.equal(rec(skew,'risk.exit-impact').state,'NOT_VERIFIED');assert.equal(rec(skew,'risk.exit-impact').reasonCode,'QUOTE_MODEL_MISMATCH');
 assert.equal(rec(skew,'risk.pool-liquidity').state,'VERIFIED_ONCHAIN');
 // Arc and Robinhood: no reviewed USD anchor => no request at all.
 for(const network of ['arc','robinhood']){const sim=poolChain();const r=await pool.produce({network,token:TOKEN,block:BLOCK,env:FAST,fetcher:sim.fetcher,now:()=>NOW});
  assert.equal(r.reasonCode,'PRICE_ANCHOR_NOT_REVIEWED');assert.equal(sim.calls.length,0);assert.equal(r.records.length,0);}
});

test('pool producer: operators must agree on the pool, reserves, anchor and block; failures and 429 degrade, never confirm',async()=>{
 // Different reserves on the second operator: liquidity values conflict.
 const diff=await run(poolChain({hosts:{'eth.drpc.org':{reserves:{[PAIR]:[10n**24n,400000n*10n**6n]}}}}));
 assert.equal(rec(diff,'risk.pool-liquidity').state,'CONFLICTING');assert.equal(findingFor(diff,'low-pool-liquidity').status,'CONFLICTING');
 // Same reserves but a different anchor answer => different liquidity value => conflict, never an average.
 const anchor=await run(poolChain({hosts:{'eth.drpc.org':{usdcAnswer:99000000n}}}));
 assert.equal(rec(anchor,'risk.pool-liquidity').state,'CONFLICTING');
 // Different block hash.
 const fork=await run(poolChain({hosts:{'eth.drpc.org':{hash:'0x'+'22'.repeat(32)}}}));
 assert.equal(rec(fork,'risk.pool-liquidity').reasonCode,'BLOCK_HASH_MISMATCH');
 // Operators select different pools (one sees an extra deeper Sushi pair): no record, explicit reason.
 const split=await run(poolChain({hosts:{'eth.drpc.org':{pairFactories:{[PAIR2]:SUSHI.factory},pairs:{[UNI.factory+USDC.token]:PAIR,[SUSHI.factory+USDC.token]:PAIR2},reserves:{[PAIR]:[10n**24n,500000n*10n**6n],[PAIR2]:[10n**24n,900000n*10n**6n]}}}}));
 assert.equal(split.reasonCode,'OPERATORS_SELECTED_DIFFERENT_POOLS');assert.equal(split.records.length,0);
 // 429 on one operator => SINGLE_SOURCE => UNKNOWN.
 observer._resetHealth();
 const limited=await run(poolChain({hosts:{'eth.drpc.org':{http:429}}}));
 assert.equal(rec(limited,'risk.pool-liquidity').state,'SINGLE_SOURCE');assert.equal(findingFor(limited,'low-pool-liquidity').status,'UNKNOWN');
 // Stale evidence: the same record 20 minutes later is STALE (15 min window), never a fresh verdict.
 observer._resetHealth();
 const ok=await run(poolChain());
 assert.equal(findingFor(ok,'low-pool-liquidity',{now:NOW+20*60000}).status,'STALE');
 // Evidence for another pool scope is not evidence for this one.
 assert.equal(findingFor(ok,'low-pool-liquidity',{scope:PAIR2}).reasonCode,'EVIDENCE_MISSING');
});

// ---- concentration ----
const EOA=i=>'0x'+(0x10+i).toString(16).padStart(2,'0').repeat(20),CONTRACT='0x'+'cc'.repeat(20),DEAD='0x000000000000000000000000000000000000dead';
function concChain(over={}){
 const calls=[];
 const base={chainId:'0x1',hash:HASH,supply:1000000n,balances:{[CONTRACT]:390000n,[DEAD]:100000n,...Object.fromEntries(Array.from({length:12},(_,i)=>[EOA(i),i<10?50000n:1000n]))},contracts:[CONTRACT],...over};
 const fetcher=async(url,init)=>{
  if(!url.includes('rpc')&&!url.includes('drpc'))throw Error('unexpected '+url);
  const host=new URL(url).hostname,q=JSON.parse(init.body),b={...base,...(over.hosts?.[host]||{})};calls.push({host,method:q.method,params:q.params});
  const ok=result=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
  if(b.http)return new Response('x',{status:b.http});
  if(q.method==='eth_chainId')return ok('0x1');
  if(q.method==='eth_getBlockByNumber')return ok({number:q.params[0],hash:b.hash,timestamp:'0x'+TS.toString(16)});
  if(q.method==='eth_getCode')return ok(b.contracts.includes(q.params[0])?'0x6080':'0x');
  const data=q.params[0].data;
  if(data===sel('totalSupply()'))return ok(W(b.supply));
  if(data.startsWith(sel('balanceOf(address)'))){const who='0x'+data.slice(34,74);return ok(W(b.balances[who]||0n));}
  return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:3,message:'execution reverted'}}));
 };
 return {fetcher,calls};
}
const LIST=[CONTRACT,...Array.from({length:12},(_,i)=>EOA(i))];
const crun=(sim,extra={})=>conc.produce({network:'ethereum',token:TOKEN,block:BLOCK,env:FAST,fetcher:sim.fetcher,now:()=>NOW,candidateList:LIST,...extra});
const cfind=(r,now=NOW)=>evaluateRisk({network:'ethereum',chainId:1,token:TOKEN,scope:null,evidence:r.records,now}).findings.find(f=>f.ruleId==='top-ten-holder-concentration');

test('concentration: ten verified EOAs holding >= 50% of non-burned supply is CONFIRMED; contracts and burns are excluded',async()=>{
 const sim=concChain(),r=await crun(sim),x=r.records[0];
 // eligible = 1,000,000 - 100,000 dead = 900,000; top ten EOAs = 500,000 => 5555 bps. The 390,000 contract is excluded.
 assert.equal(x.state,'VERIFIED_ONCHAIN',x.reasonCode);assert.equal(x.value,5555);assert.doesNotThrow(()=>evidence.parseMetricEvidence(x));
 assert.equal(cfind(r).status,'CONFIRMED');
 assert.ok(sim.calls.every(c=>['eth_chainId','eth_getBlockByNumber','eth_call','eth_getCode'].includes(c.method)));
 // Below the threshold is NOT a negative verdict: a complete census would be needed.
 const low=await crun(concChain({balances:{[CONTRACT]:700000n,...Object.fromEntries(Array.from({length:12},(_,i)=>[EOA(i),20000n]))}}));
 assert.equal(low.records[0].state,'NOT_VERIFIED');assert.equal(low.records[0].reasonCode,'BELOW_THRESHOLD_NEGATIVE_NOT_REVIEWED');assert.equal(cfind(low).status,'UNKNOWN');
 // Burn misclassification cannot help: a contract counted as burn would need to be 0x0 or 0xdead.
 const forged=structuredClone(x);forged.value=4000;for(const o of forged.observations)o.value=4000;
 assert.equal(cfind({records:[forged]}).reasonCode,'PRODUCER_NOT_REVIEWED');
});

test('concentration: supply inconsistencies, disagreements, 429 and missing candidates never confirm',async()=>{
 // Candidate balances exceed supply (rebasing / broken token): reconciliation fails.
 const bad=await crun(concChain({supply:400000n}));assert.equal(bad.records[0].reasonCode,'SUPPLY_RECONCILIATION_FAILED');assert.equal(cfind(bad).status,'UNKNOWN');
 // Burned >= supply.
 assert.equal((await crun(concChain({balances:{[DEAD]:1000000n}}))).records[0].reasonCode,'SUPPLY_RECONCILIATION_FAILED');
 // A holder is a contract on one operator only (EIP-7702 delegation / inconsistent node): identity mismatch.
 const code=await crun(concChain({hosts:{'eth.drpc.org':{contracts:[CONTRACT,EOA(0)]}}}));
 assert.notEqual(code.records[0].state,'VERIFIED_ONCHAIN');assert.notEqual(cfind(code).status,'CONFIRMED');
 // Different balances on the second operator.
 const split=await crun(concChain({hosts:{'eth.drpc.org':{supply:2000000n}}}));
 assert.notEqual(split.records[0].state,'VERIFIED_ONCHAIN');
 observer._resetHealth();
 const limited=await crun(concChain({hosts:{'eth.drpc.org':{http:429}}}));
 assert.equal(limited.records[0].state,'SINGLE_SOURCE');assert.equal(cfind(limited).status,'UNKNOWN');
 // Stale after 24 h.
 observer._resetHealth();
 const ok=await crun(concChain());assert.equal(cfind(ok,NOW+25*3600000).status,'STALE');
 // Explorer unreachable / empty: no record, no RPC.
 const sim=concChain(),none=await conc.produce({network:'ethereum',token:TOKEN,block:BLOCK,env:FAST,now:()=>NOW,fetcher:async url=>{if(url.includes('blockscout'))return new Response('{}',{status:503});return sim.fetcher(url);}});
 assert.equal(none.reasonCode,'CANDIDATE_SOURCE_HTTP_503');assert.equal(none.records.length,0);
 // The explorer list is used for addresses only; burns are dropped and the list is bounded.
 const listed=await conc.candidates('ethereum',TOKEN,{fetcher:async()=>new Response(JSON.stringify({items:[{address:{hash:DEAD}},...Array.from({length:60},(_,i)=>({address:{hash:'0x'+i.toString(16).padStart(40,'0')},value:'999999999'}))]}))});
 assert.equal(listed.addresses.length,20);assert.ok(!listed.addresses.includes(DEAD));assert.ok(!listed.addresses.includes('0x'+'0'.repeat(40)));
});

test('pool producer: a tiny V2 pool next to a deeper Uniswap V3 pool never yields a liquidity or exit-impact risk verdict',async()=>{
 const thin={reserves:{[PAIR]:[20000n*10n**18n,10000n*10n**6n]}};
 const deep=await run(poolChain({...thin,v3Pools:{500:V3POOL},v3Balances:{[V3POOL]:5000000n*10n**6n}}));
 assert.equal(rec(deep,'risk.pool-liquidity').reasonCode,'DEEPER_REVIEWED_VENUE_EXISTS');assert.equal(rec(deep,'risk.exit-impact').reasonCode,'DEEPER_REVIEWED_VENUE_EXISTS');
 assert.equal(findingFor(deep,'low-pool-liquidity').status,'UNKNOWN');assert.equal(findingFor(deep,'high-exit-impact').status,'UNKNOWN');
 assert.equal(deep.operators[0].outcome.deeperVenue.pool,V3POOL);
 // A shallower V3 pool does not suppress anything.
 const shallow=await run(poolChain({...thin,v3Pools:{3000:V3POOL},v3Balances:{[V3POOL]:100n*10n**6n}}));
 assert.equal(findingFor(shallow,'low-pool-liquidity').status,'CONFIRMED');assert.equal(shallow.operators[0].outcome.deeperVenue,null);
 // The measured >= $25,000 pool fact is still a NOT_CONFIRMED even with a deeper venue elsewhere.
 const big=await run(poolChain({v3Pools:{500:V3POOL},v3Balances:{[V3POOL]:9n*10n**12n}}));
 assert.equal(findingFor(big,'low-pool-liquidity').status,'NOT_CONFIRMED');
 // Operators disagreeing about the V3 venue is an identity mismatch, not a verdict.
 const split=await run(poolChain({...thin,hosts:{'eth.drpc.org':{v3Pools:{500:V3POOL},v3Balances:{[V3POOL]:5000000n*10n**6n}}}}));
 assert.notEqual(findingFor(split,'low-pool-liquidity').status,'CONFIRMED');
 // A malformed answer from one candidate contract drops that candidate only.
 const malformed=await run(poolChain({badToken0:true}));
 assert.equal(malformed.operators[0].state,'OK');assert.equal(malformed.operators[0].outcome.candidates[0].reason,'NOT_V2_COMPATIBLE_POOL');assert.equal(malformed.records.length,0);
});
