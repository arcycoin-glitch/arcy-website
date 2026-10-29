'use strict';
// Radar is mounted as an action under the EXISTING /api/search function.
// No new Vercel Serverless Function (Hobby plan limit: 12).
//
// Source: first-party onchain Uniswap v4 swap events read from the
// chain RPC (lib/market-radar-onchain.js). No third-party market-data licence is
// involved. It is still OFF unless MARKET_RADAR_ONCHAIN_ENABLED=true (rollout switch, not a licence).
//
// The CoinGecko Onchain path (lib/market-radar.js) is unchanged and stays
// fail-closed: it is selectable only with MARKET_RADAR_PROVIDER=coingecko AND
// the existing operator approvals AND a server-side Pro key.
const radar=require('../../../lib/market-radar');
const onchain=require('../../../lib/market-radar-onchain');
const snapshot=require('../../../lib/market-radar-snapshot');
const GENERIC_UNAVAILABLE={ok:false,error:'RADAR_SOURCE_UNAVAILABLE',
 message:'Provider data could not be verified; no ranking is displayed.'};
module.exports=async function(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
 const network=req.query?.chain;
 if(typeof network!=='string'||!Object.hasOwn(radar.IDS,network))
  return res.status(400).json({ok:false,error:'INVALID_NETWORK'});
 if(process.env.MARKET_RADAR_PROVIDER==='coingecko'){
  const enabled=process.env.MARKET_RADAR_PUBLIC_DISPLAY_APPROVED==='true'&&
   process.env.MARKET_RADAR_JSON_DELIVERY_APPROVED==='true'&&
   !!process.env.COINGECKO_PRO_API_KEY;
  if(!enabled)return res.status(503).json({ok:false,error:'RADAR_NOT_CONFIGURED',
   message:'Market Radar awaits licensed source configuration. No estimated rankings are published.'});
  try{
   const data=await radar.load(network,{apiKey:process.env.COINGECKO_PRO_API_KEY});
   res.setHeader('Cache-Control','public, max-age=0, s-maxage=600');
   return res.status(200).json(data);
  }catch{return res.status(503).json(GENERIC_UNAVAILABLE);}
 }
 // Fail-closed rollout switch: merging this code never activates the public Radar.
 // An operator enables it per environment (e.g. Vercel Preview first) only after the
 // live three-chain RPC measurement (scripts/probe-market-radar-onchain.cjs) is reviewed.
 if(process.env.MARKET_RADAR_ONCHAIN_ENABLED!=='true')return res.status(503).json({ok:false,error:'RADAR_NOT_ENABLED',
  message:'Market Radar is not enabled in this environment. No rankings are published.'});
 // Sanitized diagnostics (phase, window, scan counters, failure class) are exposed ONLY outside
 // production, in the response and in function logs. They never contain RPC URLs or credentials.
 const preview=process.env.VERCEL_ENV==='preview'||(process.env.VERCEL_ENV===undefined&&process.env.NODE_ENV!=='production');
 const log=(level,payload)=>{if(preview)try{console[level]('[radar]',JSON.stringify(payload));}catch{}};
 try{
  // MARKET_RADAR_SOURCE=snapshot reads the signed, continuously indexed Railway snapshot
  // (no RPC scan inside the 60s Vercel function). Default 'live' scans on demand.
  const data=process.env.MARKET_RADAR_SOURCE==='snapshot'?await snapshot.load(network):await onchain.load(network);
  const {_diagnostics,...publicBody}=data;
  log('log',{network,ok:true,diagnostics:_diagnostics});
  // Only a successful, complete scan is cacheable at the edge. Failures are never cached.
  res.setHeader('Cache-Control','public, max-age=0, s-maxage=600');
  return res.status(200).json(preview&&req.query?.diagnose==='1'?{...publicBody,diagnostics:_diagnostics}:publicBody);
 }catch(error){
  const code=typeof error?.code==='string'&&/^RADAR_[A-Z_]{3,60}$/.test(error.code)?error.code:'RADAR_SOURCE_UNAVAILABLE';
  log('warn',{network,ok:false,code,diagnostics:error?.diagnostics||null});
  const body={...GENERIC_UNAVAILABLE,reasonCode:code,network};
  if(preview&&error?.diagnostics)body.diagnostics=error.diagnostics;
  return res.status(503).json(body);
 }
};
