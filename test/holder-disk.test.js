'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const D=require('../lib/holder-disk');
const tmpdir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'holder-disk-'));
test('DISK-1 low free space: write refused, previous file intact, no temp file left',async()=>{
 const dir=tmpdir(),file=path.join(dir,'0x'+'1'.repeat(40)+'.v2.json');fs.writeFileSync(file,'{"old":true}');
 const statfs=async()=>({capacity:500*2**20,free:70*2**20});
 await assert.rejects(D.atomicWrite(file,'x'.repeat(4*2**20),{statfs,env:{}}),e=>e.code==='STORAGE_LOW_DISK');
 assert.equal(fs.readFileSync(file,'utf8'),'{"old":true}');assert.deepEqual(fs.readdirSync(dir).filter(f=>D.TMP.test(f)),[]);
 await D.atomicWrite(file,'{"new":true}',{statfs:async()=>({capacity:500*2**20,free:400*2**20}),env:{}});
 assert.equal(fs.readFileSync(file,'utf8'),'{"new":true}');
});
test('DISK-2 a failing write never leaves an orphan temp file',async()=>{
 const dir=tmpdir(),file=path.join(dir,'blocked','x.json');fs.mkdirSync(path.join(dir,'blocked'));fs.mkdirSync(file); // rename onto a directory fails
 await assert.rejects(D.atomicWrite(file,'{}',{statfs:async()=>null}));
 assert.deepEqual(fs.readdirSync(path.join(dir,'blocked')).filter(f=>D.TMP.test(f)),[]);
});
test('DISK-3 sweep removes only old atomicWrite temp files; report separates categories and volume numbers',async()=>{
 const dir=tmpdir(),A='0x'+'a'.repeat(40);
 const oldTmp=path.join(dir,A+'.v2.json.0f8fad5b-d9cb-469f-a165-70867728950e.tmp'),newTmp=path.join(dir,A+'.v2.json.1f8fad5b-d9cb-469f-a165-70867728950e.tmp');
 fs.writeFileSync(oldTmp,'x'.repeat(100));fs.writeFileSync(newTmp,'y');fs.writeFileSync(path.join(dir,A+'.v2.json'),'{}');fs.writeFileSync(path.join(dir,'note.tmp'),'keep');
 const past=new Date(Date.now()-3600e3);fs.utimesSync(oldTmp,past,past);
 const r=await D.sweepTmp(dir);assert.equal(r.removed,1);assert.ok(!fs.existsSync(oldTmp));assert.ok(fs.existsSync(newTmp));assert.ok(fs.existsSync(path.join(dir,'note.tmp')));
 fs.mkdirSync(path.join(dir,'chain-4663'));fs.writeFileSync(path.join(dir,'chain-4663',A+'.v2.json'),'z'.repeat(50));fs.writeFileSync(path.join(dir,A+'-candidates.v2.json'),'c'.repeat(20));
 const rep=await D.report({index:dir},{statfs:async()=>({capacity:500,free:100})});
 assert.deepEqual(rep.volumes.index,{capacity:500,free:100});assert.equal(rep.files.index.ledgerCheckpoints.files,2);assert.equal(rep.files.index.candidateCheckpoints.bytes,20);assert.equal(rep.files.index.orphanTmp.files,1);
});
