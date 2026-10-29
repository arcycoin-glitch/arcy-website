'use strict';
// Reads the signed Market Radar snapshot published by the Railway indexer.
// Fail-closed: bad/missing signature, wrong network/chain, stale head, short window or
// malformed rows => an error with a specific RADAR_SNAPSHOT_* code, never partial data.
const storage=require('./market-radar-storage');
const {CHAINS}=require('./market-radar-onchain');
const fail=(code,detail)=>Object.assign(new Error(code),{code,detail});
const publicKey=()=>process.env.ARC_RADAR_PUBLIC_KEY||process.env.ARC_HOLDER_PUBLIC_KEY||null;
function baseUrl(env=process.env){
 try{const u=new URL(env.ARC_RADAR_PUBLISHED_URL||env.ARC_HOLDER_PUBLISHED_URL||env.ARC_HOLDER_QUEUE_URL||'');
  return u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))?u:null;}catch{return null;}
}
function validate(network,snap,{now=Date.now(),maxAgeSec=Number(process.env.ARC_RADAR_MAX_AGE_SEC)||1200}={}){
 const cfg=CHAINS[network];
 if(!snap||snap.ok!==true)throw fail('RADAR_SNAPSHOT_INVALID');
 if(snap.network!==network||snap.chainId!==cfg.chainId||snap.snapshot?.network!==network||snap.snapshot?.chainId!==cfg.chainId)throw fail('RADAR_SNAPSHOT_CHAIN_MISMATCH');
 const head=Number(snap.snapshot?.headTimestamp);
 if(!Number.isFinite(head))throw fail('RADAR_SNAPSHOT_INVALID');
 const age=Math.floor(now/1000)-head;
 if(age>maxAgeSec||age<-300)throw fail('RADAR_SNAPSHOT_STALE',{ageSeconds:age,maxAgeSec});
 if(!(Number(snap.snapshot.windowSeconds)>=86400))throw fail('RADAR_SNAPSHOT_WINDOW_SHORT',{windowSeconds:snap.snapshot.windowSeconds});
 if(!Array.isArray(snap.tokens)||snap.tokens.length>10)throw fail('RADAR_SNAPSHOT_INVALID');
 const seen=new Set();
 for(const t of snap.tokens){
  if(!/^0x[0-9a-f]{40}$/.test(t?.address||'')||seen.has(t.address)||!(t.volume24hUsd>0)||!Number.isFinite(t.volume24hUsd)||!t.symbol)throw fail('RADAR_SNAPSHOT_INVALID');
  seen.add(t.address);
 }
 return {...snap,servedFrom:'signed-snapshot',snapshotAgeSeconds:age};
}
async function load(network,{fetcher=fetch,env=process.env,now=Date.now(),key=publicKey(),timeoutMs=6000,store=null}={}){
 if(!CHAINS[network]&&network!=='pons')throw fail('RADAR_INVALID_NETWORK');
 if(!key)throw fail('RADAR_SNAPSHOT_UNVERIFIED',{reason:'no public key configured'});
 let envelope;
 if(store)envelope=await store.envelopeOf(network);
 else{
  const base=baseUrl(env);if(!base)throw fail('RADAR_SNAPSHOT_NOT_CONFIGURED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{const r=await fetcher(new URL('/radar/snapshot/'+network,base.origin),{signal:controller.signal,cache:'no-store',redirect:'error'});
   if(r.status===404)throw fail('RADAR_SNAPSHOT_MISSING');
   if(!r.ok)throw fail('RADAR_SNAPSHOT_FETCH_FAILED',{status:r.status});
   envelope=await r.json();}
  catch(e){if(e.code)throw e;throw fail('RADAR_SNAPSHOT_FETCH_FAILED',{reason:e?.name==='AbortError'?'timeout':'transport'});}
  finally{clearTimeout(timer);}
 }
 const snap=storage.unpack(envelope,key);
 if(!snap)throw fail('RADAR_SNAPSHOT_UNVERIFIED',{reason:'signature missing or invalid'});
 return network==='pons'?require('./pons-launch-radar').validateSnapshot(snap,{now}):validate(network,snap,{now});
}
module.exports={load,validate,baseUrl};
