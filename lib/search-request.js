const {AsyncLocalStorage}=require('node:async_hooks'),scope=new AsyncLocalStorage();
// Only explicit Search refresh requests bypass volatile values. Holder storage,
// reviewed source/ABI caches and chain/platform discovery retain their policies.
const volatile=/^(control|control-card|activity|liquidity|dex-pairs|gecko-activity|gecko-pairs|project-metadata|market|unlock|goplus):/;
function ttl(key,value){const request=scope.getStore();return request?.fresh&&volatile.test(key)?request.scanId?60000:0:value;}
function key(value){const request=scope.getStore();return request?.fresh&&request.scanId&&volatile.test(value)?value+':scan:'+request.scanId:value;}
function startedAt(){return scope.getStore()?.startedAt||Date.now();}
function route(fn){return require('./core').route((a,req)=>scope.run({fresh:req.query.refresh==='1',scanId:/^[a-zA-Z0-9-]{1,80}$/.test(req.query.scanId||'')?req.query.scanId:null,startedAt:Date.now()},()=>fn(a,req)));}
function stale(key,previous,next,error){
 // Historical responses are display-only. Never feed old control/implementation
 // state or raw provider datasets into a new mechanics/source verification.
 if(!scope.getStore()?.fresh||!/^(control-card|activity|liquidity|market|unlock):/.test(key)||previous?.value?.dataState!=='DATA_FOUND')return null;
 const fields=Object.values(next?.fields||{}),hasData=next?.dataState==='DATA_FOUND'||fields.some(f=>f?.dataState==='DATA_FOUND');
 const failed=error||next?.dataState==='SOURCE_API_FAILED'||fields.some(f=>f?.dataState==='SOURCE_API_FAILED')||next?.attempts?.some(a=>a.dataState==='SOURCE_API_FAILED');
 if(hasData||!failed)return null;
 const value=structuredClone(previous.value);value.freshness={state:'LAST_VERIFIED',observedAt:value.freshness?.observedAt||previous.observedAt,refresh:'FAILED'};value.refreshFailure=error?require('./core').failure(error):next;return value;
}
module.exports={route,ttl,key,startedAt,stale};
