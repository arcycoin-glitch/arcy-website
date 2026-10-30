// Public COMPLETE evidence only. Search never loads worker checkpoints or Redis.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const valid=require('./holder-storage').validSnapshot;
const directory=()=>process.env.ARC_HOLDER_PUBLISHED_DIR||path.join(__dirname,'../data/holder-snapshots');
const identity=a=>/^0x[0-9a-f]{40}$/.test(a);
// Ephemeral delivery cache only; the signed publication and worker volume remain durable authority.
const completed=new Map();
const pending=new Map();
const lookups=new Map();
function record(a,state,reasonCode){const key=cacheKey(a);lookups.delete(key);lookups.set(key,{state,reasonCode});if(lookups.size>256)lookups.delete(lookups.keys().next().value);}
function lookupState(a){return {...(lookups.get(cacheKey(a))||{state:'UNRESOLVED'})};}
const cacheKey=a=>JSON.stringify([directory(),process.env.ARC_HOLDER_PUBLISHED_URL||'',process.env.ARC_HOLDER_PUBLIC_KEY||'',a]);
function retained(a){const s=completed.get(cacheKey(a));return s?structuredClone(s):null;}
function remember(a,s){if(!s||!valid(s,a))return retained(a);const key=cacheKey(a),old=completed.get(key);if(!old||BigInt(s.block)>=BigInt(old.block)){completed.delete(key);completed.set(key,structuredClone(s));if(completed.size>256)completed.delete(completed.keys().next().value);}return retained(a);}
function checked(d,a){if(d?.chainId!==5042||d.address!==a||!valid(d.snapshot,a))return null;return d.snapshot;}
function unpack(d){if(!d.payload)return d;const key=process.env.ARC_HOLDER_PUBLIC_KEY||(process.env.ARC_HOLDER_SIGNING_KEY?crypto.createPublicKey(process.env.ARC_HOLDER_SIGNING_KEY):null);if(!key||!crypto.verify(null,Buffer.from(d.payload),key,Buffer.from(d.signature,'base64')))return null;return JSON.parse(d.payload);}
async function read(a){if(!identity(a))return null;try{return remember(a,checked(unpack(JSON.parse(await fs.readFile(path.join(directory(),a+'.json'),'utf8'))),a));}catch{return retained(a);}}
async function remote(a){if(!identity(a))return null;const base=process.env.ARC_HOLDER_PUBLISHED_URL,key=process.env.ARC_HOLDER_PUBLIC_KEY;if(!base||!key){record(a,'FAILED','HOLDER_PUBLICATION_NOT_CONFIGURED');return retained(a);}
 const url=new URL(a+'.json',base.endsWith('/')?base:base+'/');if(url.protocol!=='https:')return null;
 const requestKey=cacheKey(a);if(pending.has(requestKey))return pending.get(requestKey);
 const task=(async()=>{try{const response=await fetch(url,{signal:AbortSignal.timeout(5000),cache:'no-store',headers:{'cache-control':'no-cache'}});if(!response.ok){record(a,response.status===404?'ABSENT':'FAILED','HOLDER_PUBLICATION_HTTP_'+response.status);return retained(a);}const d=await response.json(),snapshot=d.payload?checked(unpack(d),a):null;if(!snapshot){record(a,'FAILED','HOLDER_PUBLICATION_INVALID');return retained(a);}record(a,'COMPLETE');return remember(a,snapshot);}catch{record(a,'FAILED','HOLDER_PUBLICATION_REQUEST_FAILED');return retained(a);}})();pending.set(requestKey,task);try{return await task;}finally{pending.delete(requestKey);}}
async function publish(a,snapshot){if(!identity(a)||!valid(snapshot,a))throw Error('Only COMPLETE pinned holder evidence may be published');
 await fs.mkdir(directory(),{recursive:true});const file=path.join(directory(),a+'.json');const old=await read(a);if(old&&BigInt(old.block)>BigInt(snapshot.block))throw Error('Published snapshot block regression');
 const payload=JSON.stringify({chainId:5042,address:a,snapshot});const key=process.env.ARC_HOLDER_SIGNING_KEY;
 const d=key?{payload,signature:crypto.sign(null,Buffer.from(payload),key).toString('base64')}:JSON.parse(payload);
 const tmp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(d));await fs.rename(tmp,file);remember(a,snapshot);
}
// Freshest valid COMPLETE publication. The committed/volume copy (`read`) used to shadow the worker's signed remote publication even when the
// remote one was newer (production, 2026-10-30: committed ARCY snapshot 28 days old with 41 holders vs. remote 19 h old with 37). The higher pinned
// block wins; a tie keeps the local copy. Remote lookups are memoised (60 s on success; failures/absence are re-checked immediately, concurrent calls still coalesce) so traffic cannot become per-request worker fetches.
const remoteMemo=new Map();
function remoteCached(a){const key=cacheKey(a),hit=remoteMemo.get(key);if(hit&&hit.expires>Date.now())return hit.promise;
 const promise=remote(a).catch(()=>null);const entry={promise,expires:Date.now()+60000};remoteMemo.set(key,entry);if(remoteMemo.size>256)remoteMemo.delete(remoteMemo.keys().next().value);
 promise.then(v=>{if(!v&&remoteMemo.get(key)===entry)remoteMemo.delete(key);});return promise;}
async function freshest(a){if(!identity(a))return null;const [local,far]=await Promise.all([read(a),remoteCached(a)]);
 const list=[local,far].filter(Boolean);if(!list.length)return null;return list.reduce((best,s)=>BigInt(s.block)>BigInt(best.block)?s:best);}
function _resetMemo(){remoteMemo.clear();}
module.exports={read,remote,freshest,publish,checked,directory,lookupState,_resetMemo};
