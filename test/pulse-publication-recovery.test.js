'use strict';
// 2026-11-07 Arc Pulse incident. Evidence (CI probe 42361994663): every content source answered; only the content-less
// catalog reference https://arction.app/docs/roadmap failed (301 -> arktion.app, then HTTP 403). At the Monday 06:00
// cron no current-cycle item existed yet, so that single failure raised PULSE_SOURCE_COVERAGE_INCOMPLETE and, with one
// attempt per week, edition #6 was never signed. These tests pin the fix without relaxing content-source coverage.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const edition=require('../lib/pulse-edition'),retry=require('../lib/pulse-worker-refresh');
const ok=body=>({ok:true,status:200,headers:{get:()=>null},text:async()=>body,body:null});
const bad=status=>({ok:false,status,headers:{get:()=>null},text:async()=>'',body:null});
const MONDAY=Date.parse('2026-11-02T06:06:00Z');
// A dated (pre-cycle, therefore stale) first-party page: research articles parse, listing pages have no current links.
const ARTICLE='<html><head><title>Arc research</title><script type="application/ld+json">{"@type":"Article","headline":"Arc research report","datePublished":"2026-10-14T00:00:00Z"}</script></head></html>';
// Every content source answers with an empty-but-valid page (a genuine quiet start of the week); `fail` marks failing URLs.
function fetcher({fail=[]}={}){return async url=>{
 if(fail.some(f=>url.includes(f)))return bad(403);
 return ok(ARTICLE);
};}

test('a failing content-less catalog reference no longer blocks a truthful quiet week; the failure stays in the audit',async()=>{
 const d=await edition.generate({now:MONDAY,fetcher:fetcher({fail:['arction.app']}),trigger:'cron'});
 assert.equal(d.status,'quiet_week');assert.equal(d.number,6);
 assert.equal(d.audit.sourceFailures.length,1);assert.equal(d.audit.sourceFailures[0].url,'https://arction.app/docs/roadmap');
 assert.equal(d.audit.requiredSourceFailures,0);assert.equal(d.audit.optionalSourceFailures,1);
 assert.match(d.take,/1 optional project reference could not be reached; it never supplies dated developments\./,'quiet-week text discloses the gap');
 assert.ok(require('../lib/pulse-storage').valid(d),'signed-publication schema unchanged');
});

test('any failing content source still fails closed with PULSE_SOURCE_COVERAGE_INCOMPLETE (no fabricated quiet week)',async()=>{
 for(const url of ['www.arc.io/blog','community.arc.io/public/blogs','circle.com/pressroom','circle.com/blog','bitquery.io']){
  await assert.rejects(edition.generate({now:MONDAY,fetcher:fetcher({fail:[url]})}),e=>e.code==='PULSE_SOURCE_COVERAGE_INCOMPLETE'&&e.audit.requiredSourceFailures>=1,url);
 }
 const catalogs=edition.SOURCES.filter(s=>s.required===false);
 assert.deepEqual(catalogs.map(s=>s.type),['catalog'],'only the content-less catalog is optional');
});

test('all sources answering keeps the original quiet-week wording exactly',async()=>{
 const d=await edition.generate({now:MONDAY,fetcher:fetcher()});
 assert.equal(d.status,'quiet_week');assert.equal(d.audit.optionalSourceFailures,0);
 assert.equal(d.take,'No major verified update this week. The configured first-party Arc sources were checked, and no stale announcement was reused. Track published schedules in Token Unlocks.');
});

// ---- bounded worker retry ----
function memoryStorage({latest=null,failureAt=null}={}){const s={latest,audit:failureAt?{lastFailure:{at:new Date(failureAt).toISOString()}}:null,published:[],failures:[]};
 return {state:s,latest:async()=>s.latest,audit:async()=>s.audit,publish:async d=>{s.published.push(d);s.latest=d;},failure:async(e,now)=>{s.failures.push(e.code);s.audit={lastFailure:{at:new Date(now).toISOString(),code:e.code}};}};}
const fakeEdition=(gen)=>({cycle:edition.cycle,number:edition.number,generate:gen});
const env={ARC_HOLDER_PUBLISHED_DIR:'/data/published',ARC_HOLDER_SIGNING_KEY:'present'};
const previous={number:5,cycle:{start:'2026-10-26T00:00:00.000Z'}};

test('retry is due only when the current cycle has no signed edition, after the cron window and the back-off',async()=>{
 const mon=Date.parse('2026-11-02T00:00:00Z');
 assert.equal((await retry.due({now:mon+6*3600000,storage:memoryStorage({latest:previous}),edition})).reason,'CRON_WINDOW');
 assert.equal((await retry.due({now:mon+8*3600000,storage:memoryStorage({latest:previous,failureAt:mon+6.1*3600000}),edition})).reason,'RETRY_BACKOFF');
 assert.equal((await retry.due({now:mon+13*3600000,storage:memoryStorage({latest:previous,failureAt:mon+6.1*3600000}),edition})).due,true);
 assert.equal((await retry.due({now:mon+30*3600000,storage:memoryStorage({latest:{number:6,cycle:{start:'2026-11-02T00:00:00.000Z'}}}),edition})).reason,'CURRENT_CYCLE_PUBLISHED');
 assert.equal((await retry.due({now:mon+30*3600000,storage:memoryStorage({latest:{number:9,cycle:{start:'2026-11-23T00:00:00.000Z'}}}),edition})).reason,'NUMBER_NOT_NEWER','never regress');
});

test('a due retry publishes the generated current edition once; a failure is recorded and backs off',async()=>{
 const now=Date.parse('2026-11-07T10:00:00Z');let calls=0;
 const store=memoryStorage({latest:previous,failureAt:Date.parse('2026-11-02T06:06:03Z')});
 const gen=async({now:t,trigger})=>{calls++;assert.equal(trigger,'worker');return {number:edition.number(t),status:'updated',cycle:{start:new Date(edition.cycle(t).start).toISOString()}};};
 const r=await retry.refreshIfDue({now,env,storage:store,edition:fakeEdition(gen)});
 assert.deepEqual([r.state,r.number,r.status],['PUBLISHED',6,'updated']);assert.equal(store.state.published.length,1);
 assert.equal(await retry.refreshIfDue({now:now+60000,env,storage:store,edition:fakeEdition(gen)}),null,'same cycle is never re-published');assert.equal(calls,1);
 const failing=memoryStorage({latest:previous});const err=async()=>{throw Object.assign(Error(),{code:'PULSE_SOURCE_COVERAGE_INCOMPLETE'});};
 assert.equal((await retry.refreshIfDue({now,env,storage:failing,edition:fakeEdition(err)})).reasonCode,'PULSE_SOURCE_COVERAGE_INCOMPLETE');
 assert.deepEqual(failing.state.failures,['PULSE_SOURCE_COVERAGE_INCOMPLETE']);assert.equal(failing.state.published.length,0,'failure never publishes');
 assert.equal(await retry.refreshIfDue({now:now+3600000,env,storage:failing,edition:fakeEdition(err)}),null,'backs off for 6 h');
});

test('no durable volume or no signing key means no retry and no network work',async()=>{
 const gen=async()=>{throw Error('must not run');};
 for(const e of [{},{ARC_HOLDER_PUBLISHED_DIR:'/d'},{ARC_HOLDER_SIGNING_KEY:'k'}])assert.equal(await retry.refreshIfDue({now:Date.now(),env:e,storage:memoryStorage(),edition:fakeEdition(gen)}),null);
});

test('persistent on-chain monitoring is opt-in and isolated from signed edition publishing',async()=>{
 let calls=0;const onchainMonitor={refreshAll:async options=>{calls++;assert.equal(options.env.ARC_PULSE_ONCHAIN_DIR,'/durable');return {arc:{status:'NO_QUALIFYING_EVENTS',complete:true}};}};
 const env={ARC_PULSE_ONCHAIN_ENABLED:'1',ARC_PULSE_ONCHAIN_DIR:'/durable'};
 const r=await retry.refreshIfDue({now:MONDAY,env,storage:memoryStorage(),edition:fakeEdition(async()=>{throw Error('not due');}),onchainMonitor});
 assert.equal(r.state,'ONCHAIN_MONITORED');assert.equal(r.onchain.arc.complete,true);assert.equal(calls,1);
 assert.equal(await retry.refreshIfDue({now:MONDAY,env:{ARC_PULSE_ONCHAIN_DIR:'/durable'},storage:memoryStorage(),edition:fakeEdition(async()=>{throw Error('must not run');}),onchainMonitor}),null);
 assert.equal(calls,1);
});

test('end to end on a real signed volume: edition #6 is signed, verifiable, archived; #5 stays byte-identical',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-pulse-recovery-')),saved={...process.env},pair=crypto.generateKeyPairSync('ed25519');
 process.env.ARC_HOLDER_PUBLISHED_DIR=dir;process.env.ARC_HOLDER_SIGNING_KEY=pair.privateKey.export({type:'pkcs8',format:'pem'});delete process.env.ARC_PULSE_EDITION_DIR;delete process.env.ARC_PULSE_SIGNING_KEY;delete process.env.ARC_PULSE_PUBLIC_KEY;delete process.env.ARC_HOLDER_PUBLIC_KEY;
 const storage=require('../lib/pulse-storage');
 try{
  const five=await edition.generate({now:Date.parse('2026-10-26T06:06:00Z'),fetcher:fetcher()});await storage.publish(five);
  const fiveFile=path.join(storage.base(),'pulse-5.json'),before=await fs.readFile(fiveFile,'utf8');
  await storage.failure(Object.assign(Error(),{code:'PULSE_SOURCE_COVERAGE_INCOMPLETE'}),Date.parse('2026-11-02T06:06:03Z'),'cron');
  const r=await retry.refreshIfDue({now:Date.parse('2026-11-07T10:00:00Z'),fetcher:fetcher({fail:['arction.app']}),env:process.env,storage});
  assert.equal(r.state,'PUBLISHED');assert.equal(r.number,6);
  const latest=await storage.latest();assert.equal(latest.number,6);assert.equal(latest.trigger,'worker');assert.equal(latest.cycle.start,'2026-11-02T00:00:00.000Z');
  const env6=JSON.parse(await fs.readFile(path.join(storage.base(),'pulse-6.json'),'utf8'));
  assert.ok(crypto.verify(null,Buffer.from(env6.payload),pair.publicKey,Buffer.from(env6.signature,'base64')),'Ed25519 signature verifies');
  assert.equal(await fs.readFile(fiveFile,'utf8'),before,'historical edition unchanged');assert.equal((await storage.edition(5)).number,5);
  const audit=await storage.audit();assert.equal(audit.lastSuccessful.number,6);assert.equal(audit.lastSuccessful.trigger,'worker');
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);await fs.rm(dir,{recursive:true,force:true});}
});
