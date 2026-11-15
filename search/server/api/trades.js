'use strict';
// Live Trading — recent verified DEX swaps for one exact token contract, mounted as an action under the EXISTING
// /api/search function (Vercel Hobby limit: 12 functions).  GET /api/search?action=trades&chain=<arc|ethereum|robinhood|pons>&address=0x…
// Read-only. Pons assets are Robinhood Chain contracts and are answered with the Robinhood chain identity.
// Unsupported tokens, missing pools and provider outages are explicit states; no synthetic trade is ever returned.
const {ADDRESS}=require('../lib/eth');
const {enforce}=require('../lib/rate-limit');
const trades=require('../lib/live-trades');
const CHAINS=Object.freeze({arc:'arc',ethereum:'ethereum',robinhood:'robinhood',pons:'robinhood'});
module.exports=async function(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method&&req.method!=='GET')return res.status(405).json({ok:false,error:'GET_REQUIRED'});
 const p=req.query||{},network=Object.hasOwn(CHAINS,p.chain)?CHAINS[p.chain]:null;
 if(!network)return res.status(400).json({ok:false,error:'UNSUPPORTED_CHAIN'});
 if(typeof p.address!=='string'||!ADDRESS.test(p.address.trim()))return res.status(400).json({ok:false,error:'VALID_TOKEN_REQUIRED'});
 if(!enforce(req,res))return;
 const out=await trades.cached({network,address:p.address.trim().toLowerCase()});
 // V3: one chain read serves every visitor of the same token for a short window (edge cache + stale-while-revalidate), so each
 // user does not trigger a new scan and all screen sizes render the SAME snapshot. Failures/busy states are never cached.
 if(out.status!=='UNAVAILABLE'&&out.status!=='BUSY')res.setHeader('Cache-Control','public, max-age=0, s-maxage=15, stale-while-revalidate=45');
 return res.status(out.status==='UNAVAILABLE'?502:out.status==='BUSY'?503:200).json(out);
};
