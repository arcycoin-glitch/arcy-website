'use strict';
// Reviewed pool producer v1 for `low-pool-liquidity` (risk.pool-liquidity) and `high-exit-impact` (risk.exit-impact).
//
// Scope: Ethereum Uniswap-V2-style pairs of the reviewed factories (lib/liquidity-exit-v2.js PROTOCOLS) against a quote
// asset that has a reviewed Chainlink USD feed. Arc and Robinhood have no reviewed USD anchor: no record, no RPC call.
//
// Per registered operator, all at ONE pinned block (lib/risk-engine/producers/operators.js):
//  1. USD anchor per quote asset: feed description(), decimals() == 8, latestRoundData() with answer > 0, answeredInRound
//     >= roundId and updatedAt within heartbeat + 30 min of the block; quote token decimals() as reviewed. A failed
//     check removes that quote asset (never a default price).
//  2. Candidate pools: reviewedFactory.getPair(token, quote). Identity: pair.factory() == that factory, token0/token1 are
//     exactly {token, quote}, balances >= reserves (no unsynced deficit), both reserves > 0.
//  3. Selected pool = the candidate with the most quote-side USD; ties keep table order. Both operators must select the
//     same pool from the same reads (it is part of the agreement signature). Then Uniswap V3 getPool(token, quote, fee)
//     for every reviewed quote and fee tier: if a V3 pool holds more quote value, the V2 pool is not the token's
//     deepest reviewed market and RISK verdicts (low liquidity, high impact) are withheld (DEEPER_REVIEWED_VENUE_EXISTS).
//     Other venues (Curve, Balancer, CEX) are not checked; that limit is part of every public finding.
//  4. Liquidity (usd-cent) = 2 x quote reserve x anchor. For a constant-product pair this is the pool value at its own
//     marginal price; raising it requires depositing real quote asset, so it is not inflatable by price alone.
//  5. Exit impact (bps): sell $1,000 of the token. amountIn = 1000 USD / (pool marginal price x anchor). Price impact is
//     the constant-product slippage EXCLUDING the reviewed pool fee (fee is reported separately); the reviewed router's
//     getAmountsOut at the same block must equal the model output exactly. Token transfer taxes are NOT modelled.
// Both records are POOL-SCOPED (scope = selected pair). The rule gate accepts liquidity in both polarities (a measured
// pool fact) and exit impact positive-only (a low model impact says nothing about taxes or restrictions).
const keccak=require('../../keccak');
const v2=require('../../liquidity-exit-v2');
const v3=require('../../liquidity-exit-v3');
const {runOperators,buildRecord,fail}=require('./operators');
const PRODUCER=Object.freeze({id:'arcy-risk-pool-producer',version:1});
const ADDRESS=/^0x[0-9a-f]{40}$/,WORD=/^0x[0-9a-f]{64}$/i,ZERO='0x'+'0'.repeat(40);
const sel=s=>'0x'+keccak(Buffer.from(s)).slice(2,10);
const SEL=Object.freeze({description:sel('description()'),decimals:sel('decimals()'),latestRoundData:sel('latestRoundData()'),...v2.SELECTORS});
// Reviewed Chainlink EACAggregatorProxy feeds on Ethereum mainnet. Identity is re-checked on chain every run (description,
// decimals); a wrong address fails closed. Heartbeats are the published deviation/heartbeat maxima for these feeds.
const ANCHORS=Object.freeze({ethereum:Object.freeze([
 Object.freeze({asset:'USDC',token:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',tokenDecimals:6,feed:'0x8fffffd4afb6115b954bd326cbe7b4ba576818f6',description:'USDC / USD',heartbeatS:86400}),
 Object.freeze({asset:'WETH',token:'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',tokenDecimals:18,feed:'0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',description:'ETH / USD',heartbeatS:3600}),
 Object.freeze({asset:'USDT',token:'0xdac17f958d2ee523a2206206994597c13d831ec7',tokenDecimals:6,feed:'0x3e7d1eab13ad0104d2750b8863b489d65364e32d',description:'USDT / USD',heartbeatS:86400})
])});
// Fail at load, not at run time, if a reviewed constant is not a well-formed address (a typo once sent invalid params).
for(const a of Object.values(ANCHORS).flat())if(!ADDRESS.test(a.token)||!ADDRESS.test(a.feed))throw Error('Invalid reviewed anchor address '+a.asset);
const FEED_DECIMALS=8n,STALE_SLACK_S=1800,PROBE_USD=1000n,LIQUIDITY_THRESHOLD_CENTS=2_500_000n;
const LIMITS=Object.freeze({callsPerEndpoint:96,timeoutMs:3000,deadlineMs:20000,maxBodyBytes:256*1024,minIntervalMs:100});
const V3_FEES=Object.freeze([100,500,3000,10000]);
const pad=a=>a.slice(2).padStart(64,'0');
const word=raw=>{if(!WORD.test(raw||''))throw fail('RPC_MALFORMED_RESPONSE');return BigInt(raw);};
const addr=raw=>{if(!WORD.test(raw||'')||!/^0x0{24}/i.test(raw))throw fail('RPC_MALFORMED_RESPONSE');return '0x'+raw.slice(-40).toLowerCase();};
const signed=v=>v>=(1n<<255n)?v-(1n<<256n):v;
function abiString(raw){
 if(typeof raw!=='string'||!/^0x[0-9a-f]*$/i.test(raw)||raw.length<130)return null;
 const off=Number(BigInt('0x'+raw.slice(2,66))),len=Number(BigInt('0x'+raw.slice(2+off*2,66+off*2)));
 if(!Number.isSafeInteger(len)||len>64)return null;
 return Buffer.from(raw.slice(66+off*2,66+off*2+len*2),'hex').toString('utf8');
}
const supported=network=>Boolean(ANCHORS[network]&&v2.protocols(network).length);

async function read({call,block,anchor},{network,token}){
 const must=async(to,data)=>{const r=await call('eth_call',[{to,data},block]);if(r.error)throw fail(r.error);return r;};
 const quotes=[];
 for(const a of ANCHORS[network]){
  if(a.token===token)continue;
  const [desc,dec,round,qdec]=[await must(a.feed,SEL.description),await must(a.feed,SEL.decimals),await must(a.feed,SEL.latestRoundData),await must(a.token,SEL.decimals)];
  let reason=null,answer=null,updatedAt=null;
  if(!desc.ok||abiString(desc.result)!==a.description)reason='ANCHOR_IDENTITY_MISMATCH';
  else if(!dec.ok||word(dec.result)!==FEED_DECIMALS)reason='ANCHOR_DECIMALS_MISMATCH';
  else if(!qdec.ok||word(qdec.result)!==BigInt(a.tokenDecimals))reason='QUOTE_DECIMALS_MISMATCH';
  else if(!round.ok||round.result.length<322)reason='ANCHOR_ROUND_UNAVAILABLE';
  else{
   const w=i=>BigInt('0x'+round.result.slice(2+64*i,66+64*i));
   const roundId=w(0);answer=signed(w(1));updatedAt=w(3);const answeredIn=w(4);
   if(answer<=0n)reason='ANCHOR_NON_POSITIVE';
   else if(answeredIn<roundId)reason='ANCHOR_ROUND_INCOMPLETE';
   else if(updatedAt>BigInt(anchor.timestamp)+60n||BigInt(anchor.timestamp)-updatedAt>BigInt(a.heartbeatS+STALE_SLACK_S))reason='ANCHOR_STALE';
  }
  quotes.push({asset:a.asset,token:a.token,decimals:a.tokenDecimals,feed:a.feed,reason,answer:reason?null:answer,updatedAt:reason?null:Number(updatedAt)});
 }
 const usable=quotes.filter(q=>!q.reason);
 const candidates=[];
 for(const p of v2.protocols(network))for(const q of usable){
  const r=await must(p.factory,SEL.getPair+pad(token)+pad(q.token));
  if(!r.ok)continue;const pair=addr(r.result);if(pair===ZERO)continue;
  const [f,t0,t1,res]=[await must(pair,SEL.factory),await must(pair,SEL.token0),await must(pair,SEL.token1),await must(pair,SEL.getReserves)];
  const bad=reason=>candidates.push({pair,protocol:p.id,quote:q.asset,reason});
  if(!f.ok||!t0.ok||!t1.ok||!res.ok){bad('NOT_V2_COMPATIBLE_POOL');continue;}
  // A malformed answer from one candidate contract is that candidate's problem, not an operator failure.
  let token0,token1,factory,r0,r1,last;
  try{token0=addr(t0.result);token1=addr(t1.result);factory=addr(f.result);
   if(typeof res.result!=='string'||!/^0x[0-9a-f]{192,}$/i.test(res.result))throw fail('X');
   r0=BigInt('0x'+res.result.slice(2,66));r1=BigInt('0x'+res.result.slice(66,130));last=Number(BigInt('0x'+res.result.slice(130,194)));}
  catch{bad('NOT_V2_COMPATIBLE_POOL');continue;}
  if(factory!==p.factory){bad('POOL_NOT_REGISTERED_BY_FACTORY');continue;}
  if(new Set([token0,token1]).size!==2||![token0,token1].includes(token)||![token0,token1].includes(q.token)){bad('INVALID_POOL_TOKEN_PAIR');continue;}
  const [b0,b1]=[await must(token0,SEL.balanceOf+pad(pair)),await must(token1,SEL.balanceOf+pad(pair))];
  let bal0,bal1;try{if(!b0.ok||!b1.ok)throw fail('X');bal0=word(b0.result);bal1=word(b1.result);}catch{bad('POOL_BALANCE_UNREADABLE');continue;}
  if(bal0<r0||bal1<r1){bad('RESERVE_EXCEEDS_BALANCE');continue;}
  if(r0===0n||r1===0n){bad('ZERO_POOL_RESERVE');continue;}
  const tokenIs0=token0===token,reserveToken=tokenIs0?r0:r1,reserveQuote=tokenIs0?r1:r0;
  // quote-side USD in cents: reserveQuote * answer * 100 / (10^8 * 10^decimals)
  const quoteCents=reserveQuote*q.answer*100n/(10n**FEED_DECIMALS*10n**BigInt(q.decimals));
  candidates.push({pair,protocol:p.id,router:p.router,feeBps:p.feeBps,quote:q.asset,quoteToken:q.token,reserveToken,reserveQuote,blockTimestampLast:last,quoteCents,answer:q.answer,decimals:q.decimals,reason:null});
 }
 const valid=candidates.filter(c=>!c.reason);
 let selected=null;for(const c of valid)if(!selected||c.quoteCents>selected.quoteCents)selected=c;
 // Other reviewed venue: Uniswap V3 pools of the same token/quote pairs. Only used to SUPPRESS risk verdicts when the
 // selected V2 pool is not the token's deepest reviewed market (a tiny V2 pool next to a deep V3 pool is not a
 // liquidity risk of the token). Quote balance held by the V3 pool contract is the venue size measure.
 let deepestV3=null;
 if(selected)for(const p3 of v3.protocols(network))for(const q of usable)for(const fee of V3_FEES){
  const r=await must(p3.factory,v3.SELECTORS.getPool+pad(token)+pad(q.token)+fee.toString(16).padStart(64,'0'));
  let pool3;try{if(!r.ok)continue;pool3=addr(r.result);}catch{continue;}
  if(pool3===ZERO)continue;
  const b=await must(q.token,SEL.balanceOf+pad(pool3));
  let bal;try{if(!b.ok)continue;bal=word(b.result);}catch{continue;}
  const cents=bal*q.answer*100n/(10n**FEED_DECIMALS*10n**BigInt(q.decimals));
  if(!deepestV3||cents>deepestV3.quoteCents)deepestV3={pool:pool3,quote:q.asset,fee,quoteCents:cents};
 }
 const out={quotes:quotes.map(q=>({asset:q.asset,feed:q.feed,reason:q.reason,answer:q.answer===null?null:q.answer.toString(),updatedAt:q.updatedAt})),
  candidates:candidates.map(c=>({pair:c.pair,protocol:c.protocol,quote:c.quote,reason:c.reason,reserveToken:c.reserveToken?.toString()??null,reserveQuote:c.reserveQuote?.toString()??null,quoteCents:c.quoteCents?.toString()??null})),
  pool:null,liquidityCents:null,exit:null,deeperVenue:null,reasonCode:null};
 if(!usable.length){out.reasonCode=quotes.length?quotes[0].reason:'NO_REVIEWED_QUOTE_ASSET';return out;}
 if(!selected){out.reasonCode=candidates.length?'NO_VALID_REVIEWED_POOL':'NO_REVIEWED_POOL_FOR_TOKEN';return out;}
 out.pool={address:selected.pair,protocol:selected.protocol,quote:selected.quote,quoteToken:selected.quoteToken,feeBps:selected.feeBps,blockTimestampLast:selected.blockTimestampLast,
  lastUpdateAgeSeconds:Math.max(0,anchor.timestamp-selected.blockTimestampLast)};
 out.liquidityCents=(selected.quoteCents*2n).toString();
 if(deepestV3&&deepestV3.quoteCents>selected.quoteCents)out.deeperVenue={protocol:'uniswap-v3',pool:deepestV3.pool,quote:deepestV3.quote,fee:deepestV3.fee,quoteCents:deepestV3.quoteCents.toString()};
 // $1,000 sell. amountIn = 1000 * 10^8 * 10^dq * reserveToken / (reserveQuote * answer).
 const amountIn=PROBE_USD*(10n**FEED_DECIMALS)*(10n**BigInt(selected.decimals))*selected.reserveToken/(selected.reserveQuote*selected.answer);
 if(amountIn<=0n){out.exit={reasonCode:'PROBE_AMOUNT_BELOW_ONE_UNIT'};return out;}
 const model=v2.decompose({amountIn,reserveIn:selected.reserveToken,reserveOut:selected.reserveQuote,feeBps:selected.feeBps});
 const routed=await call('eth_call',[{to:selected.router,data:SEL.getAmountsOut+amountIn.toString(16).padStart(64,'0')+(64).toString(16).padStart(64,'0')+(2).toString(16).padStart(64,'0')+pad(token)+pad(selected.quoteToken)},block]);
 if(routed.error)throw fail(routed.error);
 let routerOut=null;try{if(routed.ok){const d=v2.decodeAmountsOut(routed.result);if(d.amountIn===amountIn)routerOut=d.amountOut.toString();}}catch{}
 if(routerOut!==model.amountOut){out.exit={reasonCode:'QUOTE_MODEL_MISMATCH',amountIn:amountIn.toString()};return out;}
 const outCents=BigInt(model.amountOut)*selected.answer*100n/(10n**FEED_DECIMALS*10n**BigInt(selected.decimals));
 out.exit={amountIn:amountIn.toString(),amountOut:model.amountOut,routerAmountOut:routerOut,priceImpactBps:Math.ceil(model.priceImpactPpm/100),feeBps:selected.feeBps,
  totalVsMidBps:Math.ceil(model.totalVsMidPpm/100),proceedsCents:outCents.toString(),shareOfReserveInPpm:model.shareOfReserveInPpm,reasonCode:null};
 return out;
}
const signature=o=>JSON.stringify(o?{pool:o.pool,quotes:o.quotes,candidates:o.candidates,deeperVenue:o.deeperVenue,exit:o.exit&&{amountIn:o.exit.amountIn||null,amountOut:o.exit.amountOut||null,reasonCode:o.exit.reasonCode||null}}:null);

async function produce({network,token,block,env=process.env,fetcher=fetch,now=Date.now}={}){
 const address=String(token||'').toLowerCase();
 if(!ADDRESS.test(address)||address===ZERO)throw fail('RISK_PRODUCER_INVALID_TOKEN');
 if(!supported(network))return {producer:{...PRODUCER},network,supported:false,reasonCode:'PRICE_ANCHOR_NOT_REVIEWED',records:[],pool:null,operators:[],cost:{rpcCalls:0,ms:0}};
 const run=await runOperators({network,block,env,fetcher,now,limits:LIMITS,read:ctx=>read(ctx,{network,token:address})});
 const ok=run.rows.filter(r=>r.state==='OK');
 const pools=new Set(ok.map(r=>r.outcome.pool?.address||null));
 const pool=pools.size===1?[...pools][0]:null;
 const generatedAt=new Date(now()).toISOString();
 const records=[];
 if(pool){
  const common={network,token:address,scope:pool,generatedAt,blockNumber:run.blockNumber,rows:run.rows,independence:run.independence,engine:PRODUCER,signature};
  records.push(buildRecord({...common,metricId:'risk.pool-liquidity',unit:'usd-cent',method:'pinned-pool-reserves-oracle-usd',reference:pool,
   // A low-liquidity (risk) value is withheld when a deeper reviewed venue exists; a >= threshold value is a pool fact either way.
   pick:o=>!o.liquidityCents?{reasonCode:o.reasonCode||'LIQUIDITY_NOT_DETERMINABLE'}:o.deeperVenue&&BigInt(o.liquidityCents)<LIQUIDITY_THRESHOLD_CENTS?{reasonCode:'DEEPER_REVIEWED_VENUE_EXISTS'}:{value:o.liquidityCents}}));
  records.push(buildRecord({...common,metricId:'risk.exit-impact',unit:'bps',method:'pinned-fixed-usd-1000-exit-replay',reference:pool,
   pick:o=>o.deeperVenue?{reasonCode:'DEEPER_REVIEWED_VENUE_EXISTS'}:o.exit&&o.exit.reasonCode===null?{value:Math.min(10000,o.exit.priceImpactBps)}:{reasonCode:o.exit?.reasonCode||o.reasonCode||'EXIT_NOT_DETERMINABLE'}}));
 }
 const reasonCode=pool?null:pools.size>1?'OPERATORS_SELECTED_DIFFERENT_POOLS':ok[0]?.outcome?.reasonCode||run.rows.find(r=>r.reasonCode)?.reasonCode||'NO_OPERATOR_RESULT';
 return {producer:{...PRODUCER},network,supported:true,reasonCode,block:{number:run.blockNumber,hex:run.blockHex},pool,independence:run.independence,
  operators:run.rows.map(r=>({role:r.role,operator:r.operator,state:r.state,reasonCode:r.reasonCode||null,failedAt:r.failedAt||null,rpcError:r.rpcError??null,watchdogState:r.watchdogState||null,rpcCalls:r.cost.rpcCalls,ms:r.cost.ms,outcome:r.outcome||null})),
  records,cost:run.cost};
}
module.exports={PRODUCER,produce,supported,ANCHORS,LIMITS,SEL,LIQUIDITY_THRESHOLD_CENTS,_internals:{abiString,read,signature}};
