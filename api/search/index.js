'use strict';
const handlers=Object.freeze({
 health:require('../../search/server/api/health'),
 discover:require('../../search/server/api/discover'),
 report:require('../../search/server/api/report'),
 token:require('../../search/server/api/token'),
 chart:require('../../search/server/api/chart')
});
module.exports=async function(req,res){
 const params=req.query;
 if(!params||typeof params!=='object'||Array.isArray(params))return res.status(400).json({ok:false,error:'INVALID_QUERY'});
 const {action,...rest}=params;
 if(typeof action!=='string'||!Object.hasOwn(handlers,action))return res.status(404).json({ok:false,error:'UNKNOWN_SEARCH_ACTION'});
 const child=Object.create(req);Object.defineProperty(child,'query',{value:rest});
 return handlers[action](child,res);
};
