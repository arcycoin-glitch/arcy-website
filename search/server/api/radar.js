'use strict';
// Radar V2 is mounted as an action under the EXISTING /api/search function (Vercel Hobby limit: 12 functions).
// Fail closed: without a permitted source tier and the operator's publication approvals nothing is published.
const radar=require('../../../lib/radar-v2');
const GENERIC={ok:false,error:'RADAR_SOURCE_UNAVAILABLE',message:'Provider data could not be verified; no ranking is displayed.'};
const STATUS={RADAR_NOT_CONFIGURED:503,RADAR_SOURCE_KEY_REQUIRED:503,RADAR_INVALID_NETWORK:400,RADAR_PROVIDER_RATE_LIMITED:503,RADAR_NO_VERIFIED_TOKENS:503,RADAR_PONS_MEMBERSHIP_UNAVAILABLE:503};
module.exports=async function(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
 const network=req.query?.chain;
 if(typeof network!=='string'||!Object.hasOwn(radar.NETWORKS,network))return res.status(400).json({ok:false,error:'INVALID_NETWORK'});
 try{
  const rpcUrl=network==='pons'?require('../lib/chains').rpcUrl('robinhood',process.env):undefined;
  const data=await radar.load(network,{env:process.env,rpcUrl});
  // Long edge cache protects the provider quota (Demo plan: 10k credits/month). Stale-if-error is bounded in the library.
  const ttl=Math.max(600,Math.floor(Number(process.env.RADAR_V2_TTL_MS||1800000)/1000));
  res.setHeader('Cache-Control',`public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${ttl}`);
  return res.status(200).json(data);
 }catch(error){
  const code=typeof error?.code==='string'&&/^RADAR_[A-Z0-9_]{3,60}$/.test(error.code)?error.code:'RADAR_SOURCE_UNAVAILABLE';
  const body=code==='RADAR_NOT_CONFIGURED'||code==='RADAR_SOURCE_KEY_REQUIRED'
   ?{ok:false,error:code,message:'Market Radar awaits an approved, licensed source configuration. No estimated rankings are published.'}
   :{...GENERIC,reasonCode:code,network};
  if(code==='RADAR_PROVIDER_RATE_LIMITED'&&Number.isFinite(error.retryInMs))res.setHeader('Retry-After',String(Math.ceil(error.retryInMs/1000)));
  return res.status(STATUS[code]||503).json(body);
 }
};
