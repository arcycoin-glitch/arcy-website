'use strict';
// Deferred decorative token artwork, never part of the Search evidence or
// issuer-verification protocol. Uses the existing action-dispatched function,
// and the same exact-chain, raster-validated image pipeline as Search itself.
const {chain}=require('../lib/chains');
const logos=require('../lib/search-logo');
const {enforce}=require('../lib/rate-limit');
const {withTimeout}=require('../lib/timeout');
const ADDRESS=/^0x[0-9a-f]{40}$/i;
function parse(query){
 if(!query||typeof query!=='object'||Array.isArray(query)||
   Object.keys(query).some(k=>!['chain','addresses'].includes(k))||
   typeof query.chain!=='string'||typeof query.addresses!=='string')return null;
 if(!['arc','ethereum','robinhood'].includes(query.chain))return null;
 const addresses=query.addresses.split(',').map(s=>s.trim().toLowerCase());
 if(addresses.length<1||addresses.length>8||addresses.some(s=>!ADDRESS.test(s))||
   new Set(addresses).size!==addresses.length)return null;
 return {network:query.chain,addresses};
}
module.exports=async function(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET_REQUIRED'});
 const p=parse(req.query);
 if(!p)return res.status(400).json({ok:false,error:'VALID_QUERY_REQUIRED'});
 if(!enforce(req,res))return;
 // All candidate inputs are unverified and contain no user-controlled logo URL.
 // The existing pipeline only selects images for matching DEX baseToken or
 // known local exact-chain art, validates CDN allowlist, MIME, size and bytes.
 const cfg=chain(p.network);
 const candidates=p.addresses.map(address=>({network:p.network,chainId:cfg.chainId,
  address,symbol:'',logoUrl:null,registryMatched:false,
  identity:{status:'NOT_VERIFIED'}}));
 try{
  const items=await withTimeout(logos.enhance(p.network,candidates),12800,'Artwork lookup deadline');
  return res.status(200).json({ok:true,network:p.network,chainId:cfg.chainId,
   items:items.filter(x=>x.logoUrl).map(x=>({address:x.address,logoUrl:x.logoUrl,
    source:x.logoSource||'Decorative artwork, not issuer evidence'}))});
 }catch{
  // Image outages must never fail the original token research results.
  return res.status(200).json({ok:true,network:p.network,chainId:cfg.chainId,items:[],sourceStatus:'UNAVAILABLE'});
 }
};
module.exports.parse=parse;
