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
 const range=q.range||'30D',address=q.address.toLowerCase();
 // Explicit operator-controlled licensing flag, NEVER sourced from request parameters.
 // GeckoTerminal public API access does not itself prove redistribution rights.
 if(process.env.ARCY_CHART_DATA_LICENSE_APPROVED!=='true')
  return res.status(503).json({ok:false,network:q.chain,address,range,
   error:'CHART_SOURCE_PENDING',
   reason:'Source permission for republishing historical chart prices has not been verified. No estimated or synthetic candles are served.'});
 try{
  const data=await require('../lib/price-history').load(q.chain,address,{range});
  if(data?.ok!==true||data.network!==q.chain||data.address!==address||data.range!==range)
   throw Error('Source identity mismatch');
  return res.status(200).json(data);
 }catch(error){
  return res.status(503).json({ok:false,network:q.chain,address,range,
   error:'CHART_SOURCE_UNAVAILABLE',
   reason:'Verified exact-pool historical prices are temporarily unavailable. No estimated or synthetic candles are served.'});
 }
};
