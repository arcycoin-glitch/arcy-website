'use strict';
// Minimal, non-sensitive liveness metadata for automated deployment smoke tests.
// This is NOT an assertion that external RPC, DEX, or holder providers are live.
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
  capabilities:['health','token','report','discover','chart'],
  note:'Liveness only. External provider reliability and exact-contract data must be checked separately.'
 });
};
