'use strict';
const gecko=require('./gecko-market');
const {card,error,unknown}=require('./evidence');
function parse(body,token){return gecko.parseMarket(body,'ethereum',String(token||'').toLowerCase()).fields}
async function inspect(address){const result=await gecko.inspect('ethereum',address);return card(result.fields,'GeckoTerminal exact-token pools');}
function failure(e){
 const missing=key=>error(e,'GeckoTerminal');
 return card({liquidityUsd:missing('liquidityUsd'),volume24h:missing('volume24h'),
  dexPairCount:missing('dexPairCount'),lpStatus:unknown('Pool liquidity does not prove LP custody.'),
  priceUsd:missing('priceUsd'),valuation:missing('valuation'),change24h:missing('change24h')},
  'GeckoTerminal token pools are unavailable.');
}
module.exports={parse,inspect,failure};
