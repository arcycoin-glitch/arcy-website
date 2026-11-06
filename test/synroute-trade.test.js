'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const trade=require('../lib/synroute-trade');
const ui=require('../synroute-swap');
const WALLET='0x1111111111111111111111111111111111111111';
const TXTO='0x3333333333333333333333333333333333333333';
const HASH='0x'+'a'.repeat(64);
const makeQuote=(id='base_eth_usdc',chosen='external')=>{
 const p=trade.PAIRS[id];
 return {
  state:'Success',quoteId:'tq_12345678-1234-4567-890a-123456789abc',expiresAt:Date.now()+120000,
  request:{user:WALLET,recipient:WALLET,sourceChainId:p.sourceChainId,destinationChainId:p.destinationChainId,
    tokenIn:p.tokenIn,tokenOut:p.tokenOut,amount:'10000000000000000',tradeType:'EXACT_INPUT'},
  chosen,
  quote:{state:'Success',amountOut:'32000000',minimumAmountOut:'31840000',
    gasEstimateUsd:0.02,executionRequestId:HASH,
    steps:[{kind:'transaction',items:[{kind:'transaction',data:{from:WALLET,to:TXTO,data:'0xabcdef',value:'10000000000000000',chainId:p.sourceChainId},
      check:{method:'GET',endpoint:'/v1/swap/status?requestId='+HASH}}]}]}
 };
};
function input(id='base_eth_usdc'){return {wallet:WALLET,pairId:id,pair:trade.PAIRS[id],raw:'10000000000000000'};}
test('launch guard: ARCY never appears in curated trading pairs',()=>{
 assert.equal(Object.keys(trade.PAIRS).length,2);
 assert.equal(Object.values(trade.PAIRS).some(p=>/ARCY/i.test(JSON.stringify(p))),false);
 assert.equal(trade.PAIRS.base_eth_usdc.tokenOut.address.toLowerCase(),'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
 assert.equal(trade.PAIRS.robinhood_eth_base_usdc.sourceChainId,4663);
});
test('amount uses exact bigint units, disallows negatives, infinity and huge values',()=>{
 assert.equal(trade.rawAmount('0.01'),'10000000000000000');
 assert.equal(trade.rawAmount('0.001'),'1000000000000000');
 for(const v of ['1.1','0','0.000001','0.000999999999999999','-1','1e3','NaN','1.0000000000000000001','01',''])assert.equal(trade.rawAmount(v),null,v);
});
test('verify fixed-pair quote and full wallet-bound identity',()=>{
 const q=trade.inspectQuote(makeQuote(),input());
 assert.equal(q.ok,true);assert.equal(q.estimatedOut,'32');
 assert.equal(q.minimumOut,'31.84');assert.equal(q.route,'External SynRoute');
 assert.equal(q.transaction.to,TXTO);assert.equal(q.requestId,HASH);
 assert.equal(q.revenueEligibleRoute,true);
});
test('reject quote for different wallet, token, chain, output or amount',()=>{
 for(const property of ['user','recipient','sourceChainId','destinationChainId','amount','tokenIn','tokenOut']){
  const q=makeQuote();
  q.request[property]=property==='tokenIn'||property==='tokenOut'?{address:'0x9999999999999999999999999999999999999999',decimals:18}:'BAD';
  assert.equal(trade.inspectQuote(q,input()).ok,false,property);
 }
});
test('fail closed on stale, unsigned, invalid or multi-step execution',()=>{
 const a=makeQuote();a.expiresAt=Date.now()-1;
 assert.equal(trade.inspectQuote(a,input()).code,'QUOTE_EXPIRED');
 const b=makeQuote();b.quote.steps[0].items[0].kind='signature';
 assert.equal(trade.inspectQuote(b,input()).code,'ROUTE_REQUIRES_ADDITIONAL_STEPS');
 const c=makeQuote();c.quote.steps.push(c.quote.steps[0]);
 assert.equal(trade.inspectQuote(c,input()).code,'ROUTE_REQUIRES_ADDITIONAL_STEPS');
 const d=makeQuote();d.quote.steps[0].items[0].data.to='0x0000000000000000000000000000000000000000';
 assert.equal(trade.inspectQuote(d,input()).code,'ROUTE_REQUIRES_ADDITIONAL_STEPS');
});
test('cross-chain route requires status-check tied to same request ID',()=>{
 assert.equal(trade.inspectQuote(makeQuote('robinhood_eth_base_usdc'),input('robinhood_eth_base_usdc')).ok,true);
 const altered=makeQuote('robinhood_eth_base_usdc');
 altered.quote.steps[0].items[0].check.endpoint='/v1/swap/status?requestId='+('0x'+'f'.repeat(64));
 assert.equal(trade.inspectQuote(altered,input('robinhood_eth_base_usdc')).ok,false);
});
test('live quote is server-side and never returns secret or raw upstream data',async()=>{
 let captured=null;const secret='sk_live_my-private-secret';
 const q=await trade.requestQuote(input(),{key:secret,fetcher:async(url,opts)=>{
  captured={url,opts};return {ok:true,json:async()=>makeQuote()};
 }});
 assert.equal(q.status,200);assert.equal(captured.url,'https://ghost-trading-api.synthra.org/v1/swap/quote');
 assert.equal(captured.opts.headers['x-api-key'],secret);
 assert.equal(JSON.parse(captured.opts.body).user,WALLET);
 assert.equal(JSON.stringify(q.body).includes(secret),false);
});
test('bad keys and failures never expose upstream response payload',async()=>{
 const a=await trade.requestQuote(input(),{key:'sk_test_wrong'});
 assert.equal(a.status,503);
 const b=await trade.requestQuote(input(),{key:'sk_live_valid',fetcher:async()=>({ok:false,status:403})});
 assert.equal(b.body.code,'QUOTE_UNAVAILABLE');
 assert.equal(JSON.stringify(b).includes('sk_live_valid'),false);
});
test('status requires requestId and destination tx hash to claim settlement',async()=>{
 assert.equal((await trade.requestStatus('BAD',{key:'sk_live_valid'})).status,400);
 const s=await trade.requestStatus(HASH,{key:'sk_live_valid',fetcher:async()=>({ok:true,json:async()=>({state:'Success'})})});
 assert.equal(s.body.state,'pending');
 const t=await trade.requestStatus(HASH,{key:'sk_live_valid',fetcher:async()=>({ok:true,json:async()=>({state:'Success',destinationTxHash:HASH})})});
 assert.equal(t.body.state,'settled');
});
test('the same original Synthra external CTA remains; new modal only inside #buy',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const start=html.indexOf('<section id="buy">'),end=html.indexOf('</section>',start);
 const part=html.slice(start,end);
 assert.equal((part.match(/data-synthra-open/g)||[]).length,1);
 assert.equal((part.match(/data-synroute-launch/g)||[]).length,0,'protected static HTML remains unchanged');
 assert.match(part,/Open Synthra Swap/);
 const redirect=fs.readFileSync('synthra-redirect.js','utf8');
 const modal=fs.readFileSync('synroute-swap.js','utf8');
 assert.match(redirect,/loader\.src='\/synroute-swap\.js'/);
 assert.match(modal,/original\.insertAdjacentElement\('afterend',launcher\)/);
 assert.equal(ui.PAIRS.base_eth_usdc.chainId,8453);
 assert.equal(ui.PAIRS.robinhood_eth_base_usdc.chainId,4663);
});
test('browser never receives production key, server-only URLs or credential materials',()=>{
 const js=fs.readFileSync('synroute-swap.js','utf8');
 for(const illegal of [/SYNTHRA_API_KEY/,/ghost-trading-api/,/x-api-key/,/privateKey/i,/mnemonic|seed phrase|recovery phrase/i])
   assert.doesNotMatch(js,illegal);
 assert.match(js,/eth_sendTransaction/);
 assert.match(js,/eth_requestAccounts/);
 assert.match(js,/eth_getTransactionReceipt/);
});
