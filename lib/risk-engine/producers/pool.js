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
//     same pool from the same reads (it is part of the agreement signature).
//  4. Liquidity (usd-cent) = 2 x quote reserve x anchor. For a constant-product pair this is the pool value at its own
//     marginal price; raising it requires depositing real quote asset, so it is not inflatable by price alone.
//  5. Exit impact (bps): sell $1,000 of the token. amountIn = 1000 USD / (pool marginal price x anchor). Price impact is
//     the constant-product slippage EXCLUDING the reviewed pool fee (fee is reported separately); the reviewed router's
//     getAmountsOut at the same block must equal the model output exactly. Token transfer taxes are NOT modelled.
// Both records are POOL-SCOPED (scope = selected pair). The rule gate accepts liquidity in both polarities (a measured
// pool fact) and exit impact positive-only (a low model impact says nothing about taxes or restrictions).
const keccak=require('../../keccak');
const v2=require('../../liquidity-exit-v2');
const {runOperators,buildRecord,fail}=require('./operators');
const PRODUCER=Object.freeze({id:'arcy-risk-pool-producer',version:1});
const ADDRESS=/^0x[0-9a-f]{40}$/,WORD=/^0x[0-9a-f]{64}$/i,ZERO='0x'+'0'.repeat(40);
const sel=s=>'0x'+keccak(Buffer.from(s)).slice(2,10);
const SEL=Object.freeze({description:sel('description()'),decimals:sel('decimals()'),latestRoundData:sel('latestRoundData()'),...v2.SELECTORS});
// Reviewed Chainlink EACAggregatorProxy feeds on Ethereum mainnet. Identity is re-checked on chain every run (description,
// decimals); a wrong address fails closed. Heartbeats are the published deviation/heartbeat maxima for these feeds.
const ANCHORS=Object.freeze({ethereum:Object.freeze([
 Object.freeze({asset:'USDC',token:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',tokenDecimals:6,feed:'0x8fffffd4afb6115b954bd326cbe7b4ba576818f6',description:'USDC / USD',heartbeatS:86400}),
 Object.freeze({asset:'WETH',token:'0xc02aaa39b223fe8d0a0e5c4f27ead083c756cc2',tokenDecimals:18,feed:'0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',description:'ETH / USD',heartbeatS:3600}),
 Object.freeze({asset:'USDT',token:'0xdac17f958d2ee523a2206206994597c13d831ec7',tokenDecimals:6,feed:'0x3e7d1eab13ad0104d2750b8863b489d65364e32d',description:'USDT / USD',heartbeatS:86400})
])});
const FEED_DECIMALS=8n,STALE_SLACK_S=1800,PROBE_USD=1000n,LIQUIDITY_THRESHOLD_CENTS=2_500_000n;
const LIMITS=Object.freeze({callsPerEndpoint:48,timeoutMs:3000,deadlineMs:9000,maxBodyBytes:256*1024});
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
 const usable=quotes.filter(q=>!q.reason);
 const candidates=[];
 for(const p of v2.protocols(network))for(const q of usable){
  const r=await must(p.factory,SEL.getPair+pad(token)+pad(q.token));
  if(!r.ok)continue;const pair=addr(r.result);if(pair===ZERO)continue;
  const [f,t0,t1,res]=[await must(pair,SEL.factory),await must(pair,SEL.token0),await must(pair,SEL.token1),await must(pair,SEL.getReserves)];
  if(!f.ok||!t0.ok||!t1.ok||!res.ok){candidates.push({pair,protocol:p.id,quote:q.asset,reason:'NOT_V2_COMPATIBLE_POOL'});continue;}
  const token0=addr(t0.result),token1=addr(t1.result);
  if(addr(f.result)!==p.factory){candidates.push({pair,protocol:p.id,quote:q.asset,reason:'POOL_NOT_REGISTERED_BY_FACTORY'});continue;}
  if(new Set([token0,token1]).size!==2||![token0,token1].includes(token)||![token0,token1].includes(q.token)){candidates.push({pair,protocol:p.id,quote:q.asset,reason:'INVALID_POOL_TOKEN_PAIR'});continue;}
  if(res.result.length<194)throw fail('RPC_MALFORMED_RESPONSE');
  const r0=BigInt('0x'+res.result.slice(2,66)),r1=BigInt('0x'+res.result.slice(66,130)),last=Number(BigInt('0x'+res.result.slice(130,194)));
  const [b0,b1]=[await must(token0,SEL.balanceOf+pad(pair)),await must(token1,SEL.balanceOf+pad(pair))];
  if(!b0.ok||!b1.ok){candidates.push({pair,protocol:p.id,quote:q.asset,reason:'POOL_BALANCE_UNREADABLE'});continue;}
  if(word(b0.result)<r0||word(b1.result)<r1){candidates.push({pair,protocol:p.id,quote:q.asset,reason:'RESERVE_EXCEEDS_BALANCE'});continue;}
  if(r0===0n||r1===0n){candidates.push({pair,protocol:p.id,quote:q.asset,reason:'ZERO_POOL_RESERVE'});continue;}
  const tokenIs0=token0===token,reserveToken=tokenIs0?r0:r1,reserveQuote=tokenIs0?r1:r0;
  // quote-side USD in cents: reserveQuote * answer * 100 / (10^8 * 10^decimals)
  const quoteCents=reserveQuote*q.answer*100n/(10n**FEED_DECIMALS*10n**BigInt(q.decimals));
  candidates.push({pair,protocol:p.id,router:p.router,feeBps:p.feeBps,quote:q.asset,quoteToken:q.token,reserveToken,reserveQuote,blockTimestampLast:last,quoteCents,answer:q.answer,decimals:q.decimals,reason:null});
 }
 const valid=candidates.filter(c=>!c.reason);
 let selected=null;for(const c of valid)if(!selected||c.quoteCents>selected.quoteCents)selected=c;
 const out={quotes:quotes.map(q=>({asset:q.asset,feed:q.feed,reason:q.reason,answer:q.answer===null?null:q.answer.toString(),updatedAt:q.updatedAt})),
  candidates:candidates.map(c=>({pair:c.pair,protocol:c.protocol,quote:c.quote,reason:c.reason,reserveToken:c.reserveToken?.toString()??null,reserveQuote:c.reserveQuote?.toString()??null,quoteCents:c.quoteCents?.toString()??null})),
  pool:null,liquidityCents:null,exit:null,reasonCode:null};
 if(!usable.length){out.reasonCode=quotes.length?quotes[0].reason:'NO_REVIEWED_QUOTE_ASSET';return out;}
 if(!selected){out.reasonCode=candidates.length?'NO_VALID_REVIEWED_POOL':'NO_REVIEWED_POOL_FOR_TOKEN';return out;}
 out.pool={address:selected.pair,protocol:selected.protocol,quote:selected.quote,quoteToken:selected.quoteToken,feeBps:selected.feeBps,blockTimestampLast:selected.blockTimestampLast,
  lastUpdateAgeSeconds:Math.max(0,anchor.timestamp-selected.blockTimestampLast)};
 out.liquidityCents=(selected.quoteCents*2n).toString();
 return out;
}
const signature=o=>JSON.stringify(o?{pool:o.pool,quotes:o.quotes,candidates:o.candidates,exit:o.exit&&{amountIn:o.exit.amountIn||null,amountOut:o.exit.amountOut||null,reasonCode:o.exit.reasonCode||null}}:null);

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
   pick:o=>o.liquidityCents?{value:o.liquidityCents}:{reasonCode:o.reasonCode||'LIQUIDITY_NOT_DETERMINABLE'}}));
  records.push(buildRecord({...common,metricId:'risk.exit-impact',unit:'bps',method:'pinned-fixed-usd-1000-exit-replay',reference:pool,
   pick:o=>o.exit&&o.exit.reasonCode===null?{value:Math.min(10000,o.exit.priceImpactBps)}:{reasonCode:o.exit?.reasonCode||o.reasonCode||'EXIT_NOT_DETERMINABLE'}}));
 }
 const reasonCode=pool?null:pools.size>1?'OPERATORS_SELECTED_DIFFERENT_POOLS':ok[0]?.outcome?.reasonCode||run.rows.find(r=>r.reasonCode)?.reasonCode||'NO_OPERATOR_RESULT';
 return {producer:{...PRODUCER},network,supported:true,reasonCode,block:{number:run.blockNumber,hex:run.blockHex},pool,independence:run.independence,
  operators:run.rows.map(r=>({role:r.role,operator:r.operator,state:r.state,reasonCode:r.reasonCode||null,watchdogState:r.watchdogState||null,rpcCalls:r.cost.rpcCalls,ms:r.cost.ms,outcome:r.outcome||null})),
  records,cost:run.cost};
}
module.exports={PRODUCER,produce,supported,ANCHORS,LIMITS,SEL,LIQUIDITY_THRESHOLD_CENTS,_internals:{abiString,read,signature}};
