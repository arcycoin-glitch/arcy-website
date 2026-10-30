'use strict';
// Radar V2 is mounted as an action under the EXISTING /api/search function (Vercel Hobby limit: 12 functions).
// Fail closed: without a permitted source tier and the operator's publication approvals nothing is published.
const radar=require('../../../lib/radar-v2');
const GENERIC={ok:false,error:'RADAR_SOURCE_UNAVAILABLE',message:'Provider data could not be verified; no ranking is displayed.'};
const STATUS={RADAR_NOT_CONFIGURED:503,RADAR_SOURCE_KEY_REQUIRED:503,RADAR_INVALID_NETWORK:400,RADAR_PROVIDER_RATE_LIMITED:503,RADAR_NO_VERIFIED_TOKENS:503,RADAR_PONS_MEMBERSHIP_UNAVAILABLE:503};
// The JSON action exists to render ARCY's own Radar page, not as a public data feed. Provider terms prohibit syndicating
// API access and are silent on re-serving data, so browser calls from this site are the only intended use. This is an
// intent signal (headers can be forged by non-browser clients), not an access-control guarantee.
function ownPage(req){
 const h=req.headers||{},site=h['sec-fetch-site'];
 if(site)return site==='same-origin';
 const origin=h.origin||h.referer;
 if(!origin||!h.host)return false;
 try{return new URL(origin).host===h.host;}catch{return false;}
}
// Preview-only help for the operator: the NAMES (never values) of the configuration items that are not set. Never emitted on Production.
function configDiagnostics(){
 if(process.env.VERCEL_ENV!=='preview')return {};
 const env=process.env,missing=[];
 if(env.MARKET_RADAR_PUBLIC_DISPLAY_APPROVED!=='true')missing.push('MARKET_RADAR_PUBLIC_DISPLAY_APPROVED');
 if(env.MARKET_RADAR_JSON_DELIVERY_APPROVED!=='true')missing.push('MARKET_RADAR_JSON_DELIVERY_APPROVED');
 if(!env.COINGECKO_DEMO_API_KEY&&!env.COINGECKO_PRO_API_KEY)missing.push('COINGECKO_DEMO_API_KEY');
 if(env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED!=='true')missing.push('DEXSCREENER_PUBLIC_DISPLAY_APPROVED (optional: without it only the DEX Screener cross-check is off)');
 return {previewDiagnostics:{environment:'preview',missing}};
}
module.exports=async function(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
 res.setHeader('Vary','Sec-Fetch-Site, Origin');
 const network=req.query?.chain;
 if(typeof network!=='string'||!Object.hasOwn(radar.NETWORKS,network))return res.status(400).json({ok:false,error:'INVALID_NETWORK'});
 try{
  if(!ownPage(req)&&require('../../../lib/radar-v2/sources').publicationAllowed(process.env).ok)return res.status(403).json({ok:false,error:'RADAR_SITE_ONLY',message:'Market Radar data is served to the ARCY SEARCH page only.'});
  const rpcUrl=network==='pons'?require('../lib/chains').rpcUrl('robinhood',process.env):undefined;
  const data=await radar.load(network,{env:process.env,rpcUrl});
  // Long edge cache protects the provider quota (Demo plan: 10k credits/month). Stale-if-error is bounded in the library.
  const ttl=Math.max(600,Math.floor(Number(process.env.RADAR_V2_TTL_MS||1800000)/1000));
  res.setHeader('Cache-Control',`public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${ttl}`);
  return res.status(200).json(data);
 }catch(error){
  const code=typeof error?.code==='string'&&/^RADAR_[A-Z0-9_]{3,60}$/.test(error.code)?error.code:'RADAR_SOURCE_UNAVAILABLE';
  const body=code==='RADAR_NOT_CONFIGURED'||code==='RADAR_SOURCE_KEY_REQUIRED'
   ?{ok:false,error:code,message:'Market Radar awaits an approved, licensed source configuration. No estimated rankings are published.',...configDiagnostics()}
   :{...GENERIC,reasonCode:code,network};
  if(code==='RADAR_PROVIDER_RATE_LIMITED'&&Number.isFinite(error.retryInMs))res.setHeader('Retry-After',String(Math.ceil(error.retryInMs/1000)));
  return res.status(STATUS[code]||503).json(body);
 }
};
