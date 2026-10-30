'use strict';
// Data audit: the committed/volume holder copy must not shadow a newer signed remote publication (production evidence 2026-10-30).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const publication=require('../lib/holder-publication'),index=require('../lib/holder-index');
const a='0x'+'7'.repeat(40),w1='0x'+'1'.repeat(40),w2='0x'+'2'.repeat(40),anchor='0x'+'a'.repeat(64);
const snap=(block,holders)=>{const s=index.aggregate(holders,100n,[{block,anchor,source:'fixture'}]);return {...s,block,snapshot:{block,completedAt:new Date().toISOString()}};};
async function env(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-fresh-')),before={...process.env};
 const pair=crypto.generateKeyPairSync('ed25519');process.env.ARC_HOLDER_SIGNING_KEY=pair.privateKey.export({type:'pkcs8',format:'pem'});process.env.ARC_HOLDER_PUBLIC_KEY=pair.publicKey.export({type:'spki',format:'pem'});process.env.ARC_HOLDER_PUBLISHED_URL='https://publications.example/5042/';
 const original=global.fetch;try{publication._resetMemo();await fn(dir);}finally{global.fetch=original;publication._resetMemo();for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);await fs.rm(dir,{recursive:true,force:true});}}
async function publishedDoc(dir,s){process.env.ARC_HOLDER_PUBLISHED_DIR=dir;await publication.publish(a,s);return JSON.parse(await fs.readFile(path.join(dir,a+'.json'),'utf8'));}
test('freshest(): a newer signed remote publication beats an older local copy; remote lookups are memoised',()=>env(async dir=>{
 const remoteDoc=await publishedDoc(path.join(dir,'remote'),snap('0x14',[[w1,'60'],[w2,'40']]));
 process.env.ARC_HOLDER_PUBLISHED_DIR=path.join(dir,'local');await publication.publish(a,snap('0xa',[[w1,'100']]));publication._resetMemo();
 let calls=0;global.fetch=async()=>{calls++;return {ok:true,json:async()=>remoteDoc};};
 const s=await publication.freshest(a);assert.equal(s.block,'0x14');assert.equal(s.holderCount,2,'remote wins by pinned block');
 for(let i=0;i<5;i++)await publication.freshest(a);assert.equal(calls,1,'memoised: one worker fetch per minute, not per request');
}));
test('freshest(): remote outage or an older remote keeps the local COMPLETE copy',()=>env(async dir=>{
 const oldRemote=await publishedDoc(path.join(dir,'remote'),snap('0x5',[[w1,'100']]));
 process.env.ARC_HOLDER_PUBLISHED_DIR=path.join(dir,'local');await publication.publish(a,snap('0xa',[[w1,'60'],[w2,'40']]));
 global.fetch=async()=>{throw Error('worker down');};publication._resetMemo();
 assert.equal((await publication.freshest(a)).block,'0xa','remote down: local');
 global.fetch=async()=>({ok:true,json:async()=>oldRemote});publication._resetMemo();
 assert.equal((await publication.freshest(a)).block,'0xa','remote older: local');
 global.fetch=async()=>({ok:true,json:async()=>{const d=JSON.parse(JSON.stringify(oldRemote));d.payload=d.payload.replace('"holderCount":1','"holderCount":9');return d;}});publication._resetMemo();
 assert.equal((await publication.freshest(a)).block,'0xa','tampered remote rejected');
 assert.equal(await publication.freshest('0x'+'9'.repeat(40)),null,'unknown token: nothing invented');
}));
