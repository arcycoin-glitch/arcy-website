// Public COMPLETE evidence only. Search never loads worker checkpoints or Redis.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const valid=require('./holder-storage').validSnapshot;
const directory=()=>process.env.ARC_HOLDER_PUBLISHED_DIR||path.join(__dirname,'../data/holder-snapshots');
const identity=a=>/^0x[0-9a-f]{40}$/.test(a);
// Ephemeral delivery cache only; the signed publication and worker volume remain durable authority.
const completed=new Map();
const cacheKey=a=>JSON.stringify([directory(),process.env.ARC_HOLDER_PUBLISHED_URL||'',process.env.ARC_HOLDER_PUBLIC_KEY||'',a]);
function retained(a){const s=completed.get(cacheKey(a));return s?structuredClone(s):null;}
function remember(a,s){if(!s||!valid(s,a))return retained(a);const key=cacheKey(a),old=completed.get(key);if(!old||BigInt(s.block)>=BigInt(old.block)){completed.delete(key);completed.set(key,structuredClone(s));if(completed.size>256)completed.delete(completed.keys().next().value);}return retained(a);}
function checked(d,a){if(d?.chainId!==5042||d.address!==a||!valid(d.snapshot,a))return null;return d.snapshot;}
function unpack(d){if(!d.payload)return d;const key=process.env.ARC_HOLDER_PUBLIC_KEY||(process.env.ARC_HOLDER_SIGNING_KEY?crypto.createPublicKey(process.env.ARC_HOLDER_SIGNING_KEY):null);if(!key||!crypto.verify(null,Buffer.from(d.payload),key,Buffer.from(d.signature,'base64')))return null;return JSON.parse(d.payload);}
async function read(a){if(!identity(a))return null;try{return remember(a,checked(unpack(JSON.parse(await fs.readFile(path.join(directory(),a+'.json'),'utf8'))),a));}catch{return retained(a);}}
async function remote(a){const base=process.env.ARC_HOLDER_PUBLISHED_URL,key=process.env.ARC_HOLDER_PUBLIC_KEY;if(!base||!key)return null;
 const url=new URL(a+'.json',base.endsWith('/')?base:base+'/');if(url.protocol!=='https:')return null;
 try{const response=await fetch(url,{signal:AbortSignal.timeout(1500),cache:'no-store',headers:{'cache-control':'no-cache'}});if(!response.ok)return retained(a);const d=await response.json();if(!d.payload)return retained(a);return remember(a,checked(unpack(d),a));}catch{return retained(a);}}
async function publish(a,snapshot){if(!identity(a)||!valid(snapshot,a))throw Error('Only COMPLETE pinned holder evidence may be published');
 await fs.mkdir(directory(),{recursive:true});const file=path.join(directory(),a+'.json');const old=await read(a);if(old&&BigInt(old.block)>BigInt(snapshot.block))throw Error('Published snapshot block regression');
 const payload=JSON.stringify({chainId:5042,address:a,snapshot});const key=process.env.ARC_HOLDER_SIGNING_KEY;
 const d=key?{payload,signature:crypto.sign(null,Buffer.from(payload),key).toString('base64')}:JSON.parse(payload);
 const tmp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(d));await fs.rename(tmp,file);remember(a,snapshot);
}
module.exports={read,remote,publish,checked,directory};
