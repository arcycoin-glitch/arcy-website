'use strict';
// Read-only acceptance: the GitHub raw CDN can cache an OLD branch snapshot for 300s
// while the corresponding immutable commit URL is current. No external HTTP used here.
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/radar-v2/v4-snapshot'),RH=require('../lib/radar-v2/intel/risk-holds');
const SHA='a'.repeat(40),NOW=Date.parse('2026-11-18T20:25:00Z');
const env={VERCEL:'1',RADAR_V4_OPPORTUNITY_ENABLED:'true'};
function snap(){return {schema:S.SCHEMA,opportunityVersion:S.OPPORTUNITY_VERSION,
 generatedAt:new Date(NOW-60000).toISOString(),engineCommit:'reviewed-engine-123',
 riskLedger:RH.list(RH.initial(null)),
 sections:{arc:{status:'BUILT',asOf:new Date(NOW-60000).toISOString(),rows:[],display:{shown:0,byClass:{}},counts:{candidates:0}}}};}
const endpoint='https://api.github.com/repos/arcycoin-glitch/arcy-website/git/ref/heads/radar-v4-snapshots';
const imm='https://raw.githubusercontent.com/arcycoin-glitch/arcy-website/'+SHA+'/radar-v4/snapshot.json';
test('Vercel resolves exact current branch SHA then reads immutable snapshot, never the stale branch raw URL',async()=>{
 const calls=[],doc=snap();
 const fetcher=async(u,opts)=>{calls.push(u);assert.equal(opts.redirect,'error');
  if(u===endpoint)return {ok:true,status:200,text:async()=>JSON.stringify({ref:'refs/heads/radar-v4-snapshots',object:{sha:SHA}})};
  assert.equal(u,imm);return {ok:true,status:200,text:async()=>JSON.stringify(doc)};};
 S._reset();
 const result=await S.serve('arc',{env,fetcher,now:NOW});
 assert.equal(result.data.opportunity.servedList,'V4_OPPORTUNITY');
 assert.equal(result.data.opportunity.engineCommit,'reviewed-engine-123');
 assert.deepEqual(calls,[endpoint,imm]);
 const again=await S.read({env,fetcher,now:NOW+1000});
 assert.equal(again.snapshot.engineCommit,'reviewed-engine-123');
 assert.equal(calls.length,2,'warm requests do not increase public GitHub API quota');
 S._reset();
});
test('ref endpoint 403/429 prevents silent old-branch-cache promotion to FRESH',async()=>{
 for(const status of [403,429]){
  S._reset();const called=[];
  const r=await S.read({env,now:NOW,fetcher:async u=>{called.push(u);return {ok:false,status,text:async()=>''};}});
  assert.equal(r.snapshot,null);
  assert.equal(r.reason,'SNAPSHOT_REF_HTTP_'+status);
  assert.deepEqual(called,[endpoint]);
 }
 S._reset();
});
test('spoofed branch identity and malformed commit hashes fail closed before a raw request',async()=>{
 const bad=[
  {ref:'refs/heads/other',object:{sha:SHA}},
  {ref:'refs/heads/radar-v4-snapshots',object:{sha:'../../etc/passwd'}},
  {ref:'refs/heads/radar-v4-snapshots',object:{sha:'b'.repeat(39)}}
 ];
 for(const body of bad){
  S._reset();let count=0;const r=await S.read({env,now:NOW,fetcher:async()=>{count++;return {ok:true,status:200,text:async()=>JSON.stringify(body)};}});
  assert.equal(r.snapshot,null);
  assert.equal(r.reason,'SNAPSHOT_REF_INVALID');
  assert.equal(count,1,'never fetch an attacker-controlled URL');
 }
 S._reset();
});
test('invalid operator snapshot refs are constrained to the approved static branch, Preview refs remain explicit',async()=>{
 for(const [ref,expected] of [['../../secret','radar-v4-snapshots'],['radar-v4-snapshots-preview','radar-v4-snapshots-preview']]){
  S._reset();
  const urls=[];
  const e={...env,RADAR_V4_SNAPSHOT_REF:ref};
  await S.read({env:e,now:NOW,fetcher:async u=>{urls.push(u);return {ok:false,status:429,text:async()=>''};}});
  assert.equal(urls[0],'https://api.github.com/repos/arcycoin-glitch/arcy-website/git/ref/heads/'+expected);
 }
 S._reset();
});
test('non-Vercel legacy test path still reads the reviewed existing URL contract',async()=>{
 S._reset();const calls=[];
 const r=await S.read({env:{RADAR_V4_OPPORTUNITY_ENABLED:'true'},now:NOW,
  fetcher:async u=>{calls.push(u);return {ok:true,status:200,text:async()=>JSON.stringify(snap())};}});
 assert.equal(r.snapshot.engineCommit,'reviewed-engine-123');
 assert.deepEqual(calls,[S.url({})]);
 S._reset();
});
