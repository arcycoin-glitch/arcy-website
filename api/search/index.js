'use strict';
const handlers=Object.freeze({
 health:require('../../search/server/api/health'),
 discover:require('../../search/server/api/discover'),
 report:require('../../search/server/api/report'),
 token:require('../../search/server/api/token'),
 chart:require('../../search/server/api/chart')
});
function parsedQuery(req){
 // Vercel's req.query may contain platform-internal route keys. Use the
 // original URL's query parameters, with an explicit duplicate-key guard.
 // Legacy dev.cjs fixtures supply req.query without req.url.
 if(typeof req.url==='string'&&req.url.includes('?')){
  const input=new URL(req.url,'https://arcy.invalid');
  const params=Object.create(null);
  for(const [key,value] of input.searchParams){
   if(Object.hasOwn(params,key))return null;
   params[key]=value;
  }
  return params;
 }
 const input=req.query;
 return input&&typeof input==='object'&&!Array.isArray(input)?input:null;
}
module.exports=async function(req,res){
 const params=parsedQuery(req);
 if(!params)return res.status(400).json({ok:false,error:'INVALID_QUERY'});
 const {action,...rest}=params;
 if(typeof action!=='string'||!Object.hasOwn(handlers,action))
  return res.status(404).json({ok:false,error:'UNKNOWN_SEARCH_ACTION'});
 // Keep the underlying Node request as the prototype, but never pass the
 // action/router metadata into strict contract-scoped report handlers.
 const child=Object.create(req);
 Object.defineProperty(child,'query',{value:rest});
 return handlers[action](child,res);
};
