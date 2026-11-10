'use strict';
// Mechanics V2 privilege-state analysis, mounted as an action under the EXISTING /api/search function.
//   GET /api/search?action=privileges&chain=<arc|ethereum|robinhood>&address=0x...
// Read-only: bounded pinned-block reads and eth_call simulations (no transaction is ever sent), same per-client
// rate limit as the report action, cached per contract. Additive: the report/card payloads are unchanged.
const {ADDRESS}=require('../lib/eth');
const {enforce}=require('../lib/rate-limit');
const privilege=require('../lib/mechanics-privilege-state');
const CHAINS=['arc','ethereum','robinhood'];
module.exports=async function(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET_REQUIRED'});
 const p=req.query||{};
 if(typeof p.address!=='string'||!ADDRESS.test(p.address.trim()))return res.status(400).json({ok:false,error:'VALID_CONTRACT_REQUIRED'});
 if(!CHAINS.includes(p.chain))return res.status(400).json({ok:false,error:'UNSUPPORTED_CHAIN'});
 if(!enforce(req,res))return;
 try{return res.status(200).json({ok:true,...await privilege.cached({network:p.chain,address:p.address.trim()})});}
 catch{return res.status(502).json({ok:false,error:'PRIVILEGE_ANALYSIS_UNAVAILABLE'});}
};
