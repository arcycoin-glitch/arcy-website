'use strict';
const {normalizeQuery}=require('../lib/discover');
const service=require('../lib/multichain-service');
const {enforce}=require('../lib/rate-limit');
module.exports=async function handler(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET_REQUIRED'});
 const p=req.query;
 if(!p||typeof p!=='object'||Array.isArray(p)||!Object.keys(p).every(k=>['q','chain'].includes(k))||
  Object.keys(p).length>2||typeof p.q!=='string'||(p.chain!==undefined&&typeof p.chain!=='string'))
  return res.status(400).json({ok:false,error:'VALID_QUERY_REQUIRED'});
 const q=normalizeQuery(p.q);
 if(!q)return res.status(400).json({ok:false,error:'VALID_QUERY_REQUIRED'});
 let network;
 try{network=service.parseChain(p.chain)}catch{return res.status(400).json({ok:false,error:'UNSUPPORTED_CHAIN'})}
 if(!enforce(req,res))return;
 try{return res.status(200).json(await service.discover({network,query:q}))}
 catch{return res.status(502).json({ok:false,network,error:'TOKEN_DISCOVERY_UNAVAILABLE',
  reason:'Exact-network discovery sources did not respond with usable results.'})}
};