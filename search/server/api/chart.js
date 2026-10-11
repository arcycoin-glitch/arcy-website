'use strict';
const {ADDRESS}=require('../lib/eth');
const {enforce}=require('../lib/rate-limit');
const history=require('../lib/price-history');
module.exports=async function handler(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','public, s-maxage=120, stale-while-revalidate=180');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET_REQUIRED'});
 const q=req.query;
 if(!q||typeof q!=='object'||Array.isArray(q)||Object.keys(q).length>2||
  !Object.keys(q).every(k=>['chain','address'].includes(k))||
  typeof q.chain!=='string'||typeof q.address!=='string'||!ADDRESS.test(q.address))
  return res.status(400).json({ok:false,error:'INVALID_CHART_QUERY'});
 if(!['arc','ethereum'].includes(q.chain))
  return res.status(404).json({ok:false,error:'CHART_NETWORK_NOT_SUPPORTED',
   reason:'Historical pool data has not been verified for this chain.'});
 if(!enforce(req,res))return;
 try{return res.status(200).json(await history.load(q.chain,q.address))}
 catch{return res.status(200).json({ok:false,network:q.chain,address:q.address.toLowerCase(),
  error:'CHART_SOURCE_NOT_VERIFIED',
  reason:'No exact-network, exact-token historical pool series could be established. Never infer historical prices.'})}
};
