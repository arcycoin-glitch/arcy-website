const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const store=require('../lib/quota-store');
test('volume quota is serialized, survives module restart, preserves cooldown and fails closed on corruption',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-quota-'));let t=Date.now();const b={month:'2026-10',credits:4,cap:20,mode:'reserve',perMinute:20};
 const opt={config:{},durableDir:dir,now:()=>t};
 try{
  const r=await Promise.all(Array.from({length:12},()=>store.apply(b,opt)));assert.equal(r.filter(x=>x.granted).length,5);assert.ok(r.every(x=>x.ok));
  delete require.cache[require.resolve('../lib/quota-volume')];assert.equal((await store.apply(b,opt)).granted,false);
  await store.apply({...b,mode:'settle',credits:-4},opt);t+=61000;
  assert.equal((await store.apply(b,opt)).granted,true);
  await store.apply({month:b.month,mode:'cooldown',ms:60000},opt);await store.apply({month:b.month,mode:'cooldown',ms:1000},opt);
  t+=2000;assert.equal((await store.apply(b,opt)).reason,'COOLDOWN');
  await fs.writeFile(path.join(dir,'radar-quota.json'),'{broken');assert.equal((await store.apply(b,opt)).reasonCode,'QUOTA_STORE_UNAVAILABLE');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
