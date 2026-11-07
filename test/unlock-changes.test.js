'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const C=require('../lib/unlock-changes');
const ev=(name,symbol,date,amount,allocation='Team',extra={})=>({name,symbol,date,amount:amount+' '+symbol,allocation,sourceUrl:'https://example.test/'+symbol,verification:'source-published',...extra});
const ed=(generatedAt,events)=>({schemaVersion:1,success:true,generatedAt,refreshAt:generatedAt,events,windows:{today:[],next7:[],days8to30:[]}});
test('unlock changes: added, removed, rescheduled and material amount changes are separated from window drift',()=>{
 const prev=ed('2026-11-01T06:00:00Z',[ev('Aptos','APT','2026-11-12','11.31M'),ev('Sui','SUI','2026-11-02','64.19M'),ev('Arbitrum','ARB','2026-11-16','92.65M'),ev('Ondo','ONDO','2026-11-20','1.9B'),ev('Gone','GON','2026-11-25','1M')]);
 const next=ed('2026-11-07T06:00:00Z',[ev('Aptos','APT','2026-11-12','11.31M'),ev('Arbitrum','ARB','2026-11-18','92.65M'),ev('Ondo','ONDO','2026-11-20','2.1B'),ev('Fresh','FRS','2026-11-10','5M'),ev('Late','LAT','2026-12-05','3M')]);
 const d=C.diff(prev,next);
 assert.deepEqual(d.counts,{added:1,removed:1,rescheduled:1,amountChanged:1,enteredWindow:1,expired:1});
 assert.equal(d.material,4);
 assert.equal(d.added[0].symbol,'FRS');assert.equal(d.removed[0].symbol,'GON');
 assert.deepEqual([d.rescheduled[0].previousDate,d.rescheduled[0].date],['2026-11-16','2026-11-18']);
 assert.equal(d.amountChanged[0].previousAmount,'1.9B ONDO');
});
test('unlock changes: identity is project + ticker + allocation, never ticker alone; ambiguity is not guessed',()=>{
 const prev=ed('2026-11-01T00:00:00Z',[ev('Alpha','ABC','2026-11-10','1M','Team'),ev('Alpha','ABC','2026-11-10','2M','Investors')]);
 const next=ed('2026-11-02T00:00:00Z',[ev('Beta Protocol','ABC','2026-11-10','1M','Team'),ev('Alpha','ABC','2026-11-10','2M','Investors')]);
 const d=C.diff(prev,next);
 assert.equal(d.counts.added,1);assert.equal(d.counts.removed,1,'same ticker, different project = different event');
 const dup=ed('2026-11-02T00:00:00Z',[ev('Alpha','ABC','2026-11-10','1M','Team'),ev('Alpha','ABC','2026-11-11','1M','Team')]);
 assert.equal(C.diff(prev,dup).ambiguousIdentities,1);
 assert.equal(C.diff(prev,{...next,generatedAt:'2026-10-01T00:00:00Z'}),null,'older edition is never diffed as newer');
 assert.equal(C.diff(null,next),null);
 assert.equal(C.amountOf({amount:'1,250.5k X'}),1250500);assert.equal(C.amountOf({amount:'unknown'}),null);
});
test('unlock storage: signed edition carries changes vs previous verified edition; first edition has none',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unlock-ed-'));const env={...process.env};
 const {privateKey}=crypto.generateKeyPairSync('ed25519');
 process.env.ARC_UNLOCK_EDITION_DIR=dir;process.env.ARC_UNLOCK_SIGNING_KEY=privateKey.export({type:'pkcs8',format:'pem'});
 delete require.cache[require.resolve('../lib/unlock-storage')];const S=require('../lib/unlock-storage');
 try{
  await S.publish(ed('2026-11-01T06:00:00Z',[ev('Aptos','APT','2026-11-12','11.31M')]));
  assert.equal((await S.latest()).changes,undefined);
  await S.publish(ed('2026-11-01T12:00:00Z',[ev('Aptos','APT','2026-11-13','11.31M'),ev('Fresh','FRS','2026-11-10','5M')]));
  const latest=await S.latest();
  assert.deepEqual([latest.changes.counts.added,latest.changes.counts.rescheduled],[1,1]);
  assert.equal((await S.audit()).lastSuccessful.changeCounts.rescheduled,1);
  const raw=JSON.parse(fs.readFileSync(path.join(dir,'latest.json'),'utf8'));assert.ok(raw.signature&&JSON.parse(raw.payload).changes,'changes are inside the signed payload');
 }finally{for(const k of ['ARC_UNLOCK_EDITION_DIR','ARC_UNLOCK_SIGNING_KEY'])if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];delete require.cache[require.resolve('../lib/unlock-storage')];fs.rmSync(dir,{recursive:true,force:true});}
});
