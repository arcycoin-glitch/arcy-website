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
 try{return res.status(200).json(await service.report({network,address,onProgress:req.onSearchProgress}))}
 catch{
  // Distinguish a proven Arc concentrated-liquidity pool from a real provider outage.
  // Worker classification is pinned on-chain; never classify from a reverted getter,
  // a 502, an arbitrary address list, or a failed/unauthenticated status request.
  if(network==='arc')try{
   const normalized=address.toLowerCase();
   const result=await require('../../../lib/holder-queue-client').status(normalized);
   if(result?.ok===true&&result.address===normalized&&
    result.job?.state==='UNSUPPORTED'&&
    result.job?.reasonCode==='HOLDER_CONTRACT_IS_LIQUIDITY_POOL'&&
    result.job?.hasCompleteSnapshot===false){
    return res.status(422).json({ok:false,chainId:5042,network,address:normalized,
     error:'CONTRACT_IS_LIQUIDITY_POOL',contractType:'CONCENTRATED_LIQUIDITY_POOL',
     holderAnalysis:'NOT_APPLICABLE',reason:
     'This address is a concentrated-liquidity pool, not an ERC-20 token. Token holder analysis does not apply to this contract.'});
   }
  }catch{} // Fail closed: an unavailable worker classification is not proof of a pool.
  return res.status(502).json({ok:false,chainId:require('../lib/chains').chain(network).chainId,network,
   address:address.toLowerCase(),error:'CHAIN_SCAN_UNAVAILABLE',
   reason:'Mainnet RPC or required contract evidence could not be verified.'});
 }
};