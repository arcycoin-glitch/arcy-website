'use strict';
const {ADDRESS}=require('../lib/eth');
const service=require('../lib/multichain-service');
const {enforce}=require('../lib/rate-limit');
module.exports=async function handler(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET_REQUIRED'});
 const p=req.query;
 if(!p||typeof p!=='object'||Array.isArray(p)||!Object.keys(p).every(k=>['address','chain'].includes(k))||
  Object.keys(p).length>2||typeof p.address!=='string'||(p.chain!==undefined&&typeof p.chain!=='string'))
  return res.status(400).json({ok:false,error:'INVALID_QUERY'});
 const address=p.address.trim();
 if(!ADDRESS.test(address))return res.status(400).json({ok:false,error:'VALID_CONTRACT_REQUIRED'});
 let network;
 try{network=service.parseChain(p.chain)}catch{return res.status(400).json({ok:false,error:'UNSUPPORTED_CHAIN'})}
 if(!enforce(req,res))return;
 try{return res.status(200).json(await service.report({network,address}))}
 catch{return res.status(502).json({ok:false,chainId:require('../lib/chains').chain(network).chainId,network,
  address:address.toLowerCase(),error:'CHAIN_SCAN_UNAVAILABLE',
  reason:'Mainnet RPC or required contract evidence could not be verified.'})}
};