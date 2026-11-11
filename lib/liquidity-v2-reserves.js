'use strict';
// Additive single-pool V2 reserve reader. No public route/UI integration or execution guarantees.
const {chain,rpcUrl,verifyChainId}=require('../search/server/lib/chains');
const ADDRESS=/^0x[0-9a-f]{40}$/i,HEX=/^0x[0-9a-f]*$/i,MAX112=(1n<<112n)-1n;
const SELECTORS={token0:'0x0dfe1681',token1:'0xd21220a7',getReserves:'0x0902f1ac'};
function addressWord(raw){
 if(typeof raw!=='string'||!/^0x[0-9a-f]{64}$/i.test(raw)||!/^0x0{24}/i.test(raw))throw Error('INVALID_POOL_TOKEN_RESPONSE');
 return '0x'+raw.slice(-40).toLowerCase();
}
function reserveWords(raw){
 if(typeof raw!=='string'||!HEX.test(raw)||raw.length<194)throw Error('INVALID_RESERVE_RESPONSE');
 const reserve0=BigInt('0x'+raw.slice(2,66)),reserve1=BigInt('0x'+raw.slice(66,130)),timestamp=BigInt('0x'+raw.slice(130,194));
 if(reserve0>MAX112||reserve1>MAX112||timestamp>0xffffffffn)throw Error('INVALID_RESERVE_RESPONSE');
 return {reserve0,reserve1,blockTimestampLast:Number(timestamp)};
}
function quoteExactIn({amountIn,reserveIn,reserveOut,feeBps}){
 if([amountIn,reserveIn,reserveOut].some(v=>typeof v!=='bigint'||v<=0n))throw Error('INVALID_QUOTE_AMOUNT');
 if(!Number.isInteger(feeBps)||feeBps<0||feeBps>=10000)throw Error('UNVERIFIED_OR_INVALID_FEE');
 const scaled=amountIn*BigInt(10000-feeBps);
 const output=scaled*reserveOut/(reserveIn*10000n+scaled);
 if(output<=0n||output>=reserveOut)throw Error('QUOTE_UNAVAILABLE');
 const bps=10000n-(output*reserveIn*10000n/(amountIn*reserveOut));
 return {amountIn:amountIn.toString(),amountOut:output.toString(),feeBps,
  spotPriceImpactBps:Number(bps<0n?0n:bps>10000n?10000n:bps),
  remainingReserveOut:(reserveOut-output).toString(),
  model:'UNISWAP_V2_CONSTANT_PRODUCT_EXACT_IN',
  limitations:'Single pool model; includes stated fee, excludes gas, MEV, tax-on-transfer, routing, and execution guarantees.'};
}
async function inspect({network,pair,tokenIn,amountIn,feeBps,fetcher=fetch,timeoutMs=5000}){
 if(!ADDRESS.test(pair||'')||!ADDRESS.test(tokenIn||''))throw Error('INVALID_ADDRESS');
 if(typeof amountIn!=='string'||!/^[1-9][0-9]*$/.test(amountIn)||amountIn.length>78)throw Error('INVALID_AMOUNT_IN');
 if(!Number.isInteger(feeBps)||feeBps<0||feeBps>=10000)throw Error('UNVERIFIED_OR_INVALID_FEE');
 const chainId=chain(network).chainId,url=rpcUrl(network),pool=pair.toLowerCase();let calls=0;
 async function rpc(method,params){
  if(!['eth_chainId','eth_blockNumber','eth_getCode','eth_call'].includes(method))throw Error('RPC_METHOD_NOT_ALLOWED');
  if(++calls>7)throw Error('RPC_BUDGET_EXCEEDED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:calls,method,params}),signal:controller.signal});
   if(!response.ok)throw Error('RPC_HTTP_ERROR');
   const body=await response.json();
   if(body?.jsonrpc!=='2.0'||body.id!==calls||body.error||typeof body.result!=='string')throw Error('RPC_RESPONSE_ERROR');
   return body.result;
  }finally{clearTimeout(timer);}
 }
 verifyChainId(network,await rpc('eth_chainId',[]));
 const block=await rpc('eth_blockNumber',[]);
 if(!/^0x[0-9a-f]+$/i.test(block))throw Error('INVALID_BLOCK');
 const code=await rpc('eth_getCode',[pool,block]);
 if(!HEX.test(code)||code==='0x')throw Error('POOL_HAS_NO_CODE');
 const call=selector=>rpc('eth_call',[{to:pool,data:selector},block]);
 const token0=addressWord(await call(SELECTORS.token0)),token1=addressWord(await call(SELECTORS.token1));
 const {reserve0,reserve1,blockTimestampLast}=reserveWords(await call(SELECTORS.getReserves));
 if(token0===token1)throw Error('INVALID_POOL_TOKEN_PAIR');
 const input=tokenIn.toLowerCase();
 if(input!==token0&&input!==token1)throw Error('TOKEN_NOT_IN_POOL');
 const reserveIn=input===token0?reserve0:reserve1,reserveOut=input===token0?reserve1:reserve0;
 if(reserveIn<=0n||reserveOut<=0n)throw Error('ZERO_POOL_RESERVE');
 return {network,chainId,pair:pool,token0,token1,tokenIn:input,tokenOut:input===token0?token1:token0,
  block,blockTimestampLast,reserve0:reserve0.toString(),reserve1:reserve1.toString(),
  quote:quoteExactIn({amountIn:BigInt(amountIn),reserveIn,reserveOut,feeBps}),
  evidence:{method:'eth_call token0/token1/getReserves at a pinned block',
   verificationClass:'SINGLE_SOURCE_ONCHAIN',rpcCalls:calls,
   scope:'One contract; single RPC. Pool authenticity and fee tier must be independently verified before using this quote.'},
  limitations:'Hypothetical constant-product quote only; not verified executable exit liquidity.'};
}
module.exports={inspect,quoteExactIn,addressWord,reserveWords};
