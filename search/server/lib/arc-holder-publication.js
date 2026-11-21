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
// Exact reason for a confirmed-absent publication (HTTP 404 from the signed feed); never used for outages or invalid documents.
const NOT_PUBLISHED='No COMPLETE snapshot published yet.';
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
function verifyDocument(document,address,key,now=Date.now(),chainId=5042){
 if(!document||typeof document!=='object'||typeof document.payload!=='string'||
    typeof document.signature!=='string'||document.payload.length>440000||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(document.signature)||document.signature.length>512)return null;
 let sig;
 try{sig=Buffer.from(document.signature,'base64')}catch{return null}
 if(sig.length!==64||!crypto.verify(null,Buffer.from(document.payload),key,sig))return null;
 let documentPayload;
 try{documentPayload=JSON.parse(document.payload)}catch{return null}
 if(documentPayload?.chainId!==chainId||documentPayload?.address!==address)return null;
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
// Same methodology metadata as the Ethereum / Robinhood paths, read from the signed snapshot (never recomputed or guessed).
function methodology(snapshot){
 const excluded=Array.isArray(snapshot.excluded)?snapshot.excluded.filter(x=>ADDRESS.test(x?.address||'')&&/^\d+$/.test(x?.balanceRaw||'')):[];
 return require('./holder-attribution').concentrationScope(excluded.map(x=>({address:x.address,balance:BigInt(x.balanceRaw)})));
}
// A signed COMPLETE snapshot completed within CURRENT_MAX_AGE_MS is a CURRENT observation (state FRESH); older ones stay explicitly
// historical (LAST_VERIFIED). The worker refreshes COMPLETE tokens every 10 minutes and treats > 1 h as stale (ARC_HOLDER_MAX_SNAPSHOT_AGE_SECONDS).
const CURRENT_MAX_AGE_MS=3600*1000;
function toCard(snapshot,address,{network='arc',now=Date.now()}={}){
 const c=network==='arc'?cfg:chain(network);
 const observedAt=snapshot.snapshot.completedAt,age=now-Date.parse(observedAt),current=Number.isFinite(age)&&age>=-60000&&age<=CURRENT_MAX_AGE_MS;
 const state=current?'FRESH':'LAST_VERIFIED';
 return {description:'Signed COMPLETE reconciled '+c.label+' holder snapshot; '+(current?'current (completed '+Math.max(0,Math.round(age/60000))+' min ago) as of ':'historical as of ')+observedAt+'.',
  snapshot:{block:snapshot.block,completedAt:observedAt,freshness:state},
  fields:Object.fromEntries(KEYS.map(k=>[k,{
   value:snapshot[k],status:'SIGNED_ONCHAIN_SNAPSHOT',dataState:'DATA_FOUND',
   freshness:{state,observedAt,block:snapshot.block,ageSeconds:Number.isFinite(age)?Math.max(0,Math.round(age/1000)):null,currentMaxAgeSeconds:CURRENT_MAX_AGE_MS/1000},
   chainId:c.chainId,network:c.id,
   source:c.label+' signed COMPLETE holder publication',
   evidence:[{network:c.id,chainId:c.chainId,address,
    block:snapshot.block,completedAt:observedAt,
    anchor:snapshot.evidence.find(e=>e.block===snapshot.block&&HASH.test(e.anchor||''))?.anchor,
    method:'Ed25519 signature + original pinned-block reconciliation',
    scope:current?'Verified publication completed within the current window; balances can change after the pinned block.':'Historical verified publication; not a claim about latest balances.',
    ...(k==='holderCount'?{holderCountIncludesBurnAddresses:false}:methodology(snapshot))}]
  }]))};
}
async function load(address,{env=process.env,fetcher=fetch,now=Date.now(),network='arc'}={}){
 const chainId=network==='arc'?5042:chain(network).chainId;
 if(!ADDRESS.test(address))return empty('Invalid '+(network==='arc'?'Arc':chain(network).label)+' contract address');
 const configuration=parseConfiguration(env);
 if(!configuration)return empty('A secure signed holder publication feed is not configured.');
 const url=new URL((chainId===5042?'':chainId+'/')+address+'.json',configuration.url);
 if(url.origin!==configuration.url.origin)return empty('Invalid publication URL.');
 const cacheKey=url.href+'#'+configuration.key.export({format:'der',type:'spki'}).toString('base64');
 const unavailable=reason=>{
  const previous=lastVerified.get(cacheKey);
  if(!previous)return empty(reason);
  const card=toCard(structuredClone(previous),address,{network,now});
  card.description+=' Publication refresh unavailable; previous verified snapshot retained.';
  return card;
 };
 try{
  const response=await fetcher(url.href,{signal:AbortSignal.timeout(5500),
   headers:{accept:'application/json'},cache:'no-store'});
  if(!response.ok)return unavailable(response.status===404?NOT_PUBLISHED:
   'Arc signed publication source unavailable.');
  const body=await readJson(response,512*1024);
  const snapshot=verifyDocument(body,address,configuration.key,now,chainId);
  if(!snapshot)return unavailable('Signature, source chain or COMPLETE snapshot proof invalid.');
  const previous=lastVerified.get(cacheKey);
  const selected=previous&&Date.parse(previous.snapshot.completedAt)>Date.parse(snapshot.snapshot.completedAt)?previous:snapshot;
  lastVerified.delete(cacheKey);lastVerified.set(cacheKey,structuredClone(selected));
  while(lastVerified.size>32)lastVerified.delete(lastVerified.keys().next().value);
  return toCard(structuredClone(selected),address,{network,now});
 }catch{return unavailable('Arc signed publication request failed or timed out.')}
}
module.exports={KEYS,NOT_PUBLISHED,CURRENT_MAX_AGE_MS,load,empty,toCard,parseConfiguration,verifyDocument};
