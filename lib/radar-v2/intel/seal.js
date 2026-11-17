'use strict';
// Evidence provenance seal (issue #279).
// Only objects produced by ARCY's own adapters inside this process are sealed. A JSON body, a query string, a caller-supplied
// object or anything deserialized from storage can never be in this WeakSet, so "publisherVerified:true" typed by anyone else
// is not proof. Sealed objects are deep-frozen so they cannot be edited after the adapter produced them.
const sealed=new WeakSet();
function deepFreeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.freeze(x);for(const v of Object.values(x))deepFreeze(v);}return x;}
function seal(obj){if(!obj||typeof obj!=='object')throw Error('SEAL_REQUIRES_OBJECT');deepFreeze(obj);sealed.add(obj);return obj;}
const isSealed=obj=>Boolean(obj&&typeof obj==='object'&&sealed.has(obj));
// Returns only the sealed parts of an evidence bundle; anything else is dropped (and reported) so it reads as NOT_VERIFIED.
function trusted(bundle){
 const out={},dropped=[];
 if(!bundle||typeof bundle!=='object')return {evidence:out,dropped};
 for(const [k,v] of Object.entries(bundle)){
  if(k==='history'){
   if(Array.isArray(v)){const ok=v.filter(isSealed);if(ok.length!==v.length)dropped.push(k);if(ok.length)out.history=ok;}
   continue;
  }
  if(k==='risk'){
   if(v&&typeof v==='object'){const r={};for(const [rk,rv] of Object.entries(v)){if(isSealed(rv))r[rk]=rv;else dropped.push('risk.'+rk);}out.risk=r;}
   continue;
  }
  if(k==='sourceConsistency'){if(v==='CONTRADICTED'||v==='CONSISTENT')out[k]=v;continue;}
  if(isSealed(v))out[k]=v;else dropped.push(k);
 }
 return {evidence:out,dropped};
}
module.exports={seal,isSealed,trusted,deepFreeze};
