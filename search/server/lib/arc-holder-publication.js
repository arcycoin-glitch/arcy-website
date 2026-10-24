'use strict';
// Independent, read-only integration with the existing Arc holder worker's
// Ed25519-signed COMPLETE publications. No Redis, worker credentials or indexing
// is ever performed from a Search HTTP request.
const crypto=require('node:crypto');
const {readJson}=require('./http');
const {chain}=require('./chains');
const cfg=chain('arc');
const ADDRESS=/^0x[0-9a-f]{40}$/;
const HASH=/^0x[0-9a-f]{64}$/;
const BLOCK=/^0x[0-9a-f]+$/;
const KEYS=['holderCount','largestWalletPct','top10Pct','top20Pct'];
// Only authenticated COMPLETE publications; exact feed/key/contract isolation.
// Process-local outage protection supplements the existing durable worker.
const lastVerified=new Map();
function parseConfiguration(env=process.env){
 const raw=env.ARC_HOLDER_PUBLISHED_URL,publicKey=env.ARC_HOLDER_PUBLIC_KEY;
 if(!raw||!publicKey)return null;
 let url;
 try{url=new URL(raw)}catch{return null}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||url.port)return null;
 if(!url.pathname.endsWith('/'))url.pathname+='/';
 let key;
 try{key=crypto.createPublicKey(publicKey)}catch{return null}
 if(key.asymmetricKeyType!=='ed25519')return null;
 return {url,key};
}
function verifyDocument(document,address,key,now=Date.now()){
 if(!document||typeof document!=='object'||typeof document.payload!=='string'||
    typeof document.signature!=='string'||document.payload.length>440000||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(document.signature)||document.signature.length>512)return null;
 let sig;
 try{sig=Buffer.from(document.signature,'base64')}catch{return null}
 if(sig.length!==64||!crypto.verify(null,Buffer.from(document.payload),key,sig))return null;
 let documentPayload;
 try{documentPayload=JSON.parse(document.payload)}catch{return null}
 if(documentPayload?.chainId!==5042||documentPayload?.address!==address)return null;
 const x=documentPayload.snapshot;
 if(x?.status!=='ONCHAIN_VERIFIED'||x?.coverage?.complete!==true||
    !BLOCK.test(x.block||'')||x.snapshot?.block!==x.block||
    !Number.isFinite(Date.parse(x.snapshot.completedAt||''))||
    Date.parse(x.snapshot.completedAt)>now+60000||!Array.isArray(x.evidence)||
    !x.evidence.some(e=>e?.block===x.block&&HASH.test(e.anchor||'')))return null;
 if(!Number.isSafeInteger(x.holderCount)||x.holderCount<0)return null;
 if(!KEYS.slice(1).every(k=>typeof x[k]==='number'&&Number.isFinite(x[k])&&
    x[k]>=0&&x[k]<=100))return null;
 if(x.largestWalletPct>x.top10Pct||x.top10Pct>x.top20Pct)return null;
 const anchors=new Set(x.evidence.filter(e=>e?.block===x.block&&HASH.test(e.anchor||'')).map(e=>e.anchor.toLowerCase()));
 if(anchors.size!==1)return null;
 const anchor=[...anchors][0];
 for(const name of KEYS){
  const field=x.fields?.[name];
  if(field?.value!==x[name]||field?.dataState!=='DATA_FOUND'||
   field?.status!=='ONCHAIN_VERIFIED'||!Array.isArray(field.evidence)||
   !field.evidence.some(e=>e?.block===x.block&&HASH.test(e.anchor||'')&&e.anchor.toLowerCase()===anchor))return null;
 }
 return x;
}
function empty(reason='Signed COMPLETE holder snapshot unavailable.'){
 const values=Object.fromEntries(KEYS.map(k=>[k,{value:null,status:'NOT_VERIFIED',
  dataState:'NOT_VERIFIED',source:null,reason,reasonCode:'SIGNED_HOLDER_PUBLICATION_UNAVAILABLE',
  network:cfg.id,chainId:cfg.chainId,evidence:[]}]));
 return {description:'No signed and complete Arc holder publication. No partial or guessed wallet counts.',fields:values};
}
function toCard(snapshot,address){
 const observedAt=snapshot.snapshot.completedAt;
 return {description:'Signed COMPLETE reconciled Arc holder snapshot; historical as of '+observedAt+'.',
  snapshot:{block:snapshot.block,completedAt:observedAt,freshness:'LAST_VERIFIED'},
  fields:Object.fromEntries(KEYS.map(k=>[k,{
   value:snapshot[k],status:'SIGNED_ONCHAIN_SNAPSHOT',dataState:'DATA_FOUND',
   freshness:{state:'LAST_VERIFIED',observedAt,block:snapshot.block},
   chainId:cfg.chainId,network:cfg.id,
   source:'Arc signed COMPLETE holder publication',
   evidence:[{network:cfg.id,chainId:cfg.chainId,address,
    block:snapshot.block,completedAt:observedAt,
    anchor:snapshot.evidence.find(e=>e.block===snapshot.block&&HASH.test(e.anchor||''))?.anchor,
    method:'Ed25519 signature + original pinned-block reconciliation',
    scope:'Historical verified publication; not a claim about latest balances.'}]
  }]))};
}
async function load(address,{env=process.env,fetcher=fetch,now=Date.now()}={}){
 if(!ADDRESS.test(address))return empty('Invalid Arc contract address');
 const configuration=parseConfiguration(env);
 if(!configuration)return empty('A secure signed holder publication feed is not configured.');
 const url=new URL(address+'.json',configuration.url);
 if(url.origin!==configuration.url.origin)return empty('Invalid publication URL.');
 const cacheKey=url.href+'#'+configuration.key.export({format:'der',type:'spki'}).toString('base64');
 const unavailable=reason=>{
  const previous=lastVerified.get(cacheKey);
  if(!previous)return empty(reason);
  const card=toCard(structuredClone(previous),address);
  card.description+=' Publication refresh unavailable; previous verified snapshot retained.';
  return card;
 };
 try{
  const response=await fetcher(url.href,{signal:AbortSignal.timeout(5500),
   headers:{accept:'application/json'},cache:'no-store'});
  if(!response.ok)return unavailable(response.status===404?'No COMPLETE snapshot published yet.':
   'Arc signed publication source unavailable.');
  const body=await readJson(response,512*1024);
  const snapshot=verifyDocument(body,address,configuration.key,now);
  if(!snapshot)return unavailable('Signature, source chain or COMPLETE snapshot proof invalid.');
  const previous=lastVerified.get(cacheKey);
  const selected=previous&&Date.parse(previous.snapshot.completedAt)>Date.parse(snapshot.snapshot.completedAt)?previous:snapshot;
  lastVerified.delete(cacheKey);lastVerified.set(cacheKey,structuredClone(selected));
  while(lastVerified.size>32)lastVerified.delete(lastVerified.keys().next().value);
  return toCard(structuredClone(selected),address);
 }catch{return unavailable('Arc signed publication request failed or timed out.')}
}
module.exports={KEYS,load,empty,toCard,parseConfiguration,verifyDocument};
