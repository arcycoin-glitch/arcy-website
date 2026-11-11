'use strict';
// Liquidity & Exit V2 — verified single-pool exit model (reviewed V2 and V3 pools), mounted as an action under the EXISTING /api/search
// function (Vercel Hobby limit: 12 functions; api/liquidity.js and the Liquidity card payload are not modified).
//   GET /api/search?action=exitquote&chain=<arc|ethereum|robinhood>&pool=0x...&token=0x...[&amount=<raw integer>]
// Default OFF: answers EXIT_QUOTE_NOT_ENABLED unless LIQUIDITY_EXIT_QUOTE_ENABLED=1 is set by the operator.
// Read-only pinned-block reads (no transaction is ever sent), per-client rate limit, cached per pool.
// An unsupported pool, a provider outage and conflicting evidence are three different answers; none of them is
// ever rendered as a quote, a zero or "no liquidity".
const {ADDRESS}=require('../lib/eth');
const {enforce}=require('../lib/rate-limit');
const exit=require('../../../lib/liquidity-exit');
const CHAINS=['arc','ethereum','robinhood'];
module.exports=async function(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET_REQUIRED'});
 if(process.env.LIQUIDITY_EXIT_QUOTE_ENABLED!=='1')return res.status(404).json({ok:false,error:'EXIT_QUOTE_NOT_ENABLED'});
 const p=req.query||{};
 if(!CHAINS.includes(p.chain))return res.status(400).json({ok:false,error:'UNSUPPORTED_CHAIN'});
 if(typeof p.pool!=='string'||!ADDRESS.test(p.pool.trim()))return res.status(400).json({ok:false,error:'VALID_POOL_REQUIRED'});
 if(typeof p.token!=='string'||!ADDRESS.test(p.token.trim()))return res.status(400).json({ok:false,error:'VALID_TOKEN_REQUIRED'});
 if(p.amount!==undefined&&(!/^[1-9][0-9]{0,77}$/.test(p.amount)))return res.status(400).json({ok:false,error:'VALID_AMOUNT_REQUIRED'});
 if(!enforce(req,res))return;
 try{
  return res.status(200).json({ok:true,readOnly:true,...await exit.cached({network:p.chain,pool:p.pool.trim(),tokenIn:p.token.trim(),amountsIn:p.amount?[p.amount]:undefined})});
 }catch(e){
  const failure=exit.classifyFailure(e);
  // HTTP 200 with an explicit state for "outside the reviewed model"; 502 only when a provider could not answer.
  return res.status(failure.state==='PROVIDER_UNAVAILABLE'?502:failure.state==='INVALID_REQUEST'?400:200).json({ok:false,readOnly:true,quotes:null,...failure});
 }
};
