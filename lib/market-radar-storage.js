'use strict';
// Signed Market Radar snapshots + private incremental indexer state on the Railway volume.
// Same Ed25519 envelope scheme as lib/unlock-storage.js. A snapshot is only ever written
// after the indexer proved the full 24h window is covered.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const NETWORKS=Object.freeze(['arc','ethereum','robinhood']);
const base=()=>process.env.ARC_RADAR_DIR||path.join(process.env.ARC_HOLDER_PUBLISHED_DIR||path.join(__dirname,'../data/holder-snapshots'),'market-radar');
const signingKey=()=>process.env.ARC_RADAR_SIGNING_KEY||process.env.ARC_HOLDER_SIGNING_KEY||null;
const publicKey=()=>process.env.ARC_RADAR_PUBLIC_KEY||process.env.ARC_HOLDER_PUBLIC_KEY||(signingKey()?crypto.createPublicKey(signingKey()):null);
const KINDS=Object.freeze([...NETWORKS,'pons']);
const okNet=n=>KINDS.includes(n);
const file=(kind,n)=>{if(!okNet(n))throw new Error('RADAR_INVALID_NETWORK');return path.join(base(),kind+'-'+n+'.json');};
async function readJson(f){try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return null;}}
async function writeJson(f,v){await fs.mkdir(base(),{recursive:true});const t=f+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(t,JSON.stringify(v));await fs.rename(t,f);}
function envelope(snapshot){
 const payload=JSON.stringify(snapshot),key=signingKey();
 if(!key)throw Object.assign(Error('RADAR_SIGNING_KEY_MISSING'),{code:'RADAR_SIGNING_KEY_MISSING'});
 return {payload,signature:crypto.sign(null,Buffer.from(payload),key).toString('base64')};
}
// Returns the parsed snapshot or null. A missing key/signature or a bad signature is always null.
function unpack(data,key=publicKey()){
 try{
  if(!data?.payload||!data.signature||!key)return null;
  if(!crypto.verify(null,Buffer.from(data.payload),key,Buffer.from(data.signature,'base64')))return null;
  return JSON.parse(data.payload);
 }catch{return null;}
}
async function publish(network,snapshot){await writeJson(file('snapshot',network),envelope(snapshot));}
async function envelopeOf(network){return readJson(file('snapshot',network));}
async function latest(network){return unpack(await envelopeOf(network));}
async function readState(network){return readJson(file('state',network));}
async function writeState(network,state){await writeJson(file('state',network),state);}
async function readKeys(network){return readJson(file('keys',network));}
async function writeKeys(network,v){await writeJson(file('keys',network),v);}
async function readAudit(network){return readJson(file('audit',network));}
async function writeAudit(network,audit){await writeJson(file('audit',network),audit);}
module.exports={NETWORKS,KINDS,base,publish,envelopeOf,latest,unpack,readState,writeState,readKeys,writeKeys,readAudit,writeAudit};
