'use strict';
// Radar is mounted as an action under the EXISTING /api/search function.
// No new Vercel Serverless Function (Hobby plan limit: 12).
const radar=require('../../../lib/market-radar');
module.exports=async function(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
 const network=req.query?.chain;
 if(typeof network!=='string'||!Object.hasOwn(radar.IDS,network))
  return res.status(400).json({ok:false,error:'INVALID_NETWORK'});
 const enabled=process.env.MARKET_RADAR_PUBLIC_DISPLAY_APPROVED==='true'&&
  process.env.MARKET_RADAR_JSON_DELIVERY_APPROVED==='true'&&
  !!process.env.COINGECKO_PRO_API_KEY;
 if(!enabled)return res.status(503).json({ok:false,error:'RADAR_NOT_CONFIGURED',
  message:'Market Radar awaits licensed source configuration. No estimated rankings are published.'});
 try{
  const data=await radar.load(network,{apiKey:process.env.COINGECKO_PRO_API_KEY});
  res.setHeader('Cache-Control','public, max-age=0, s-maxage=600');
  return res.status(200).json(data);
 }catch{
  return res.status(503).json({ok:false,error:'RADAR_SOURCE_UNAVAILABLE',
   message:'Provider data could not be verified; no ranking is displayed.'});
 }
};
