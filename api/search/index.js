'use strict';
const handlers=Object.freeze({
 health:require('../../search/server/api/health'),
 discover:require('../../search/server/api/discover'),
 report:require('../../search/server/api/report'),
 token:require('../../search/server/api/token'),
 chart:require('../../search/server/api/chart')
});
const KEYS=Object.freeze({
 health:[],
 discover:['q','chain'],
 token:['address','chain'],
 report:['address','chain'],
 chart:['address','chain','interval','range','timeframe','period']
});
function decodeQuery(req){
 const incoming=req.query&&typeof req.query==='object'&&!Array.isArray(req.query)?
  req.query:Object.create(null);
 const params=Object.create(null);
 // Vercel custom-domain routes may inject framework routing metadata into
 // both req.query and req.url. Read the request's actual query parameters
 // while only allowing values for the exact public endpoint contract.
 if(typeof req.url==='string'&&req.url.includes('?')){
  const url=new URL(req.url,'https://arcy.invalid');
  for(const [key,value] of url.searchParams){
   // Duplicate public keys are ambiguous; reject rather than allow last-win.
   if(Object.hasOwn(params,key))return null;
   params[key]=value;
  }
 }
 // Preserve local-dev fallback and tolerate Vercel rewritten routing URLs.
 const action=typeof params.action==='string'?params.action:incoming.action;
 if(typeof action!=='string'||!Object.hasOwn(handlers,action))return {action};
 const clean=Object.create(null);
 const allowed=KEYS[action];
 for(const key of allowed){
  const raw=Object.hasOwn(params,key)?params[key]:incoming[key];
  if(raw===undefined)continue;
  if(typeof raw!=='string')return null;
  clean[key]=raw;
 }
 return {action,clean};
}
module.exports=async function(req,res){
 const params=decodeQuery(req);
 if(!params)return res.status(400).json({ok:false,error:'INVALID_QUERY'});
 const {action,clean}=params;
 if(typeof action!=='string'||!Object.hasOwn(handlers,action))
  return res.status(404).json({ok:false,error:'UNKNOWN_SEARCH_ACTION'});
 const child=Object.create(req);
 Object.defineProperty(child,'query',{value:clean,configurable:true});
 return handlers[action](child,res);
};
