'use strict';
// Pulse V2 on-chain events, mounted as an action under the EXISTING /api/search function (Vercel Hobby limit: 12
// functions; api/pulse.js is a protected baseline file and is not modified).
//   GET /api/search?action=onchain              -> {ok,chains:{arc,ethereum,robinhood}}
//   GET /api/search?action=onchain&chain=<id>   -> {ok,...one network}
// Read-only. One bounded scan per network per cache period per instance (lib/pulse-onchain/index.js), shared by
// concurrent requests, so public traffic cannot multiply RPC load. A provider failure is returned as
// PROVIDER_UNAVAILABLE / PARTIAL_COVERAGE with HTTP 200 and is never rendered as "no events".
const onchain=require('../../../lib/pulse-onchain');
const CHAINS=['arc','ethereum','robinhood'];
module.exports=async function(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control','no-store');
 if(req.method&&req.method!=='GET')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
 const chain=req.query?.chain;
 if(chain!==undefined&&!CHAINS.includes(chain))return res.status(400).json({ok:false,error:'INVALID_PULSE_CHAIN'});
 try{return res.status(200).json(chain?{ok:true,...await onchain.get(chain)}:{ok:true,chains:await onchain.all()});}
 catch{return res.status(503).json({ok:false,error:'ONCHAIN_PULSE_UNAVAILABLE'});}
};
