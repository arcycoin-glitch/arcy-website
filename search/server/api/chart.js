'use strict';
const {ADDRESS}=require('../lib/eth');
const {enforce}=require('../lib/rate-limit');
const RANGES=new Set(['4H','1D','1W','30D']);
module.exports=async function handler(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','public, s-maxage=120, stale-while-revalidate=180');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET_REQUIRED'});
 const q=req.query;
 if(!q||typeof q!=='object'||Array.isArray(q)||Object.keys(q).length>3||
  !Object.keys(q).every(k=>['chain','address','range'].includes(k))||
  (q.range!==undefined&&(typeof q.range!=='string'||!RANGES.has(q.range)))||
  typeof q.chain!=='string'||typeof q.address!=='string'||!ADDRESS.test(q.address))
  return res.status(400).json({ok:false,error:'INVALID_CHART_QUERY'});
 if(!['arc','ethereum','robinhood'].includes(q.chain))
  return res.status(404).json({ok:false,error:'CHART_NETWORK_NOT_SUPPORTED',
   reason:'Historical pool data has not been verified for this chain.'});
 if(!enforce(req,res))return;
 return res.status(503).json({ok:false,network:q.chain,address:q.address.toLowerCase(),
  range:q.range||'30D',error:'CHART_SOURCE_PENDING',
  reason:'Market-data source is disabled pending commercial-use verification. No estimated or synthetic candles are served.'});
};
