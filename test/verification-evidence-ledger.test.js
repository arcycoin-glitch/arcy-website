'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const ledger=require('../lib/verification/evidence-ledger');
const {STATES}=require('../lib/verification/metric-evidence');

const token='0x'+'1'.repeat(40),block={number:'123',hash:'0x'+'a'.repeat(64)};
const identity={metricId:'supply.total',network:'arc',token,scope:null};
const env=dir=>({ARC_VERIFICATION_LEDGER_DIR:dir});
const iso=ms=>new Date(ms).toISOString();

function observation(id,value,at,operator=id){
 return {source:{id,class:'ONCHAIN_RPC',operator},value,unit:'raw-token',token,scope:null,observedAt:at,block,chainId:5042,
  provenance:{method:'erc20.total-supply',reference:token}};
}
function verified(ms=1000,value='100'){
 const observedAt=iso(ms),generatedAt=iso(ms+1000),first=observation('first',value,observedAt);
 return {schemaVersion:1,metricId:'supply.total',network:'arc',token,scope:null,value,unit:'raw-token',observedAt,generatedAt,block,
  source:first.source,state:STATES.VERIFIED_ONCHAIN,reasonCode:'EXACT_ONCHAIN_AGREEMENT',dataAgeMs:1000,
  observations:[first,observation('second',value,observedAt)],disagreement:null,engine:{id:'verification',version:1}};
}
function failed(ms,state=STATES.UNAVAILABLE,reasonCode='SOURCE_UNAVAILABLE'){
 return {schemaVersion:1,metricId:'supply.total',network:'arc',token,scope:null,value:null,unit:'raw-token',observedAt:null,generatedAt:iso(ms),
  block:null,source:null,state,reasonCode,dataAgeMs:null,observations:[],disagreement:null,engine:{id:'verification',version:1}};
}
async function temp(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-evidence-ledger-'));
 return {dir,cleanup:()=>fs.rm(dir,{recursive:true,force:true})};
}

test('trusted evidence survives restart and advances last/previous trusted snapshots atomically',async t=>{
 const x=await temp();t.after(x.cleanup);
 const first=verified(1000,'100'),second=verified(3000,'101');
 const a=await ledger.record(first,{env:env(x.dir)});
 assert.equal(a.revision,1);assert.deepEqual(a.current,first);assert.deepEqual(a.lastTrusted,first);assert.equal(a.previousTrusted,null);
 const b=await ledger.record(second,{env:env(x.dir)});
 assert.equal(b.revision,2);assert.deepEqual(b.current,second);assert.deepEqual(b.lastTrusted,second);assert.deepEqual(b.previousTrusted,first);
 assert.deepEqual(b.lastSuccess,{at:second.generatedAt,state:STATES.VERIFIED_ONCHAIN,reasonCode:'EXACT_ONCHAIN_AGREEMENT'});
 assert.equal(b.transitions.length,2);assert.equal(b.transitions[1].valueChanged,true);
 delete require.cache[require.resolve('../lib/verification/evidence-ledger')];
 const restarted=require('../lib/verification/evidence-ledger');
 assert.deepEqual(await restarted.read(identity,{env:env(x.dir)}),b);
});

test('a failure becomes current without promoting or erasing the last trusted evidence',async t=>{
 const x=await temp();t.after(x.cleanup);
 const trusted=verified(1000,'100');await ledger.record(trusted,{env:env(x.dir)});
 const outage=failed(4000,STATES.UNAVAILABLE,'RPC_TIMEOUT');
 const row=await ledger.record(outage,{env:env(x.dir)});
 assert.equal(row.current.state,STATES.UNAVAILABLE);assert.equal(row.current.value,null);
 assert.deepEqual(row.lastTrusted,trusted);assert.equal(row.previousTrusted,null);
 assert.deepEqual(row.lastFailure,{at:outage.generatedAt,state:STATES.UNAVAILABLE,reasonCode:'RPC_TIMEOUT'});
 assert.equal(row.lastSuccess.at,trusted.generatedAt);
 assert.equal(row.transitions.at(-1).from,STATES.VERIFIED_ONCHAIN);assert.equal(row.transitions.at(-1).to,STATES.UNAVAILABLE);
});

test('same evidence is idempotent across concurrent writers and does not inflate revision',async t=>{
 const x=await temp();t.after(x.cleanup);
 const item=verified(1000,'100');
 const [a,b]=await Promise.all([ledger.record(item,{env:env(x.dir)}),ledger.record(item,{env:env(x.dir)})]);
 assert.equal(a.revision,1);assert.equal(b.revision,1);
 assert.equal((await ledger.read(identity,{env:env(x.dir)})).revision,1);
});

test('older writes and same-time conflicting writes fail closed',async t=>{
 const x=await temp();t.after(x.cleanup);
 await ledger.record(verified(5000,'500'),{env:env(x.dir)});
 await assert.rejects(ledger.record(verified(1000,'100'),{env:env(x.dir)}),e=>e.code==='EVIDENCE_LEDGER_REGRESSION');
 const conflict=verified(5000,'999');
 await assert.rejects(ledger.record(conflict,{env:env(x.dir)}),e=>e.code==='EVIDENCE_LEDGER_TIME_CONFLICT');
 const saved=await ledger.read(identity,{env:env(x.dir)});assert.equal(saved.current.value,'500');assert.equal(saved.revision,1);
});

test('corrupt persisted state is never overwritten by a later valid observation',async t=>{
 const x=await temp();t.after(x.cleanup);
 const file=ledger.fileFor(identity,env(x.dir));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'{"broken":');
 await assert.rejects(ledger.read(identity,{env:env(x.dir)}),e=>e.code==='EVIDENCE_LEDGER_CORRUPT');
 await assert.rejects(ledger.record(verified(3000,'300'),{env:env(x.dir)}),e=>e.code==='EVIDENCE_LEDGER_CORRUPT');
 assert.equal(await fs.readFile(file,'utf8'),'{"broken":');
});

test('storage must be explicitly durable-configured and metric identities cannot escape the ledger directory',async()=>{
 assert.throws(()=>ledger.directory({}),e=>e.code==='EVIDENCE_LEDGER_STORAGE_UNCONFIGURED');
 for(const bad of [
  {...identity,metricId:'../escape'},
  {...identity,network:'bsc'},
  {...identity,token:'0x12'},
  {...identity,scope:'../../other'}
 ])assert.throws(()=>ledger.keyFor(bad),e=>e.code==='EVIDENCE_LEDGER_INVALID_IDENTITY');
});
