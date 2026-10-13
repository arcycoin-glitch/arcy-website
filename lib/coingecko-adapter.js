'use strict';
// The original Arc contract-matched circulating-supply reader. Public production
// display is opt-in only when the operator has the applicable commercial license,
// a PAID CoinGecko API key and visible, linked provider attribution.
// Never use a free Demo key here as a substitute for a commercial license.
const c=require('../lib/core');
const f=require('../lib/fields');
const BASE='https://pro-api.coingecko.com/api/v3';
const PLATFORM='arc'; // CoinGecko's published Arc mainnet asset-platform ID.
const CREDIT='https://www.coingecko.com/en/api';
const fallback={status:'NOT_VERIFIED',circulatingSupply:null,source:'CoinGecko',contractMatched:false};
const unavailable=(reasonCode,reason,dataState='SOURCE_HAS_NO_DATA')=>({...fallback,dataState,reasonCode,reason});
function productionAllowed(env=process.env){
 return env.COINGECKO_PUBLIC_DISPLAY_APPROVED==='true' &&
        env.COINGECKO_ATTRIBUTION_READY==='true' &&
        typeof env.COINGECKO_PRO_API_KEY==='string' &&
        env.COINGECKO_PRO_API_KEY.trim().length>0;
}
function parse(coin,address){
 if(!coin||typeof coin!=='object'||Array.isArray(coin)||
    String(coin.platforms?.[PLATFORM]||'').toLowerCase()!==address)
   return unavailable('CONTRACT_IDENTITY_MISMATCH','CoinGecko contract does not exactly match Arc mainnet.','NOT_VERIFIED');
 const n=coin.market_data?.circulating_supply,total=coin.market_data?.total_supply;
 if(typeof n!=='number'||!Number.isFinite(n)||n<=0)
   return unavailable('NO_POSITIVE_CIRCULATING_SUPPLY','CoinGecko has no positive verified circulating supply.');
 if(typeof total==='number'&&Number.isFinite(total)&&total>0&&n>total)
   return unavailable('CIRCULATING_EXCEEDS_SOURCE_SUPPLY','CoinGecko circulating supply exceeds its source total.','NOT_VERIFIED');
 return {status:'SOURCE_REPORTED',dataState:'DATA_FOUND',circulatingSupply:n,
   source:'CoinGecko',contractMatched:true,platform:PLATFORM,coinId:String(coin.id||'').slice(0,100),
   sourceUrl:CREDIT,attribution:'Data provided by CoinGecko'};
}
const handler=c.route(async(address)=>{
 if(!productionAllowed())return unavailable('PROVIDER_DISABLED_LICENSE_UNVERIFIED',
   'CoinGecko data is disabled until commercial-use permission, paid API access and linked attribution are verified.');
 const headers={accept:'application/json','x-cg-pro-api-key':process.env.COINGECKO_PRO_API_KEY};
 try{
  let coin;
  try{coin=await c.json(BASE+'/coins/'+PLATFORM+'/contract/'+address,{headers});}
  catch(e){if(e.httpStatus===404)return unavailable('CONTRACT_NOT_LISTED',
   'CoinGecko does not list this exact Arc contract.');throw e;}
  const observed=parse(coin,address);
  if(observed.dataState!=='DATA_FOUND')return observed;
  // Never infer circulating supply from totalSupply or a burn-address balance.
  const onchain=await require('../api/supply')({query:{address}},
    {setHeader(){},status(){return this},json(x){return x}});
  const total=Number(onchain?.totalSupply?.amount);
  if(onchain?.ok!==true||!Number.isFinite(total)||total<=0)
   return unavailable('SUPPLY_CROSS_CHECK_FAILED','Arc on-chain total supply cross-check unavailable.','SOURCE_API_FAILED');
  if(observed.circulatingSupply>total)
   return unavailable('CIRCULATING_EXCEEDS_ONCHAIN_SUPPLY','Circulating supply exceeds Arc on-chain total.','NOT_VERIFIED');
  return observed;
 }catch(e){
  return {...fallback,...c.failure(e),reason:'CoinGecko licensed API request failed.'};
 }
});
module.exports=handler;
module.exports.productionAllowed=productionAllowed;
module.exports.parse=parse;
module.exports.CREDIT=CREDIT;
