'use strict';
// Minimal, non-sensitive liveness metadata for automated deployment smoke tests.
// This is NOT an assertion that external RPC or GeckoTerminal is live.
const {CHAIN_CONFIG}=require('../lib/chains');
const schema=require('../schema');
module.exports=function health(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET_REQUIRED'});
 const networks=['arc','ethereum','robinhood'];
 return res.status(200).json({
  ok:true,product:'ARCY SEARCH',readOnly:true,
  networks,chainIds:networks.map(name=>CHAIN_CONFIG[name].chainId),
  expectedCards:schema.length,expectedMetrics:schema.reduce((sum,c)=>sum+c.fields.length,0),
  capabilities:['health','token','report','discover','chart-ui'],
  marketSources:['read-only chain RPC','official issuer/asset registries',
   'DEX Screener compact source-reported Ethereum/Robinhood pool observations',
   'GoPlus Security detection observations'],
  disabledProviders:['CoinGecko circulating-supply API','GeckoTerminal raw OHLCV API'],
  marketDataState:'CONTRACT_SCOPED_SOURCE_REPORTED',
  chartDataState:'OFFICIAL_PROVIDER_IFRAME_ONLY',
  note:'Liveness only. DEX price/liquidity and GoPlus checks are provider-reported, not on-chain verified; raw historical candles and unsupported metrics are withheld. This endpoint does not prove live provider availability.'
 });
};
