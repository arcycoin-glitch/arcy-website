'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
const S=require('../scripts/radar-railway-dispatch.cjs');
const NOW=Date.parse('2026-11-27T06:19:05.211Z'),TOKEN='github_pat_fixture_only_12345678901234567890';
const json=(body,status=200,headers={})=>new Response(status===204?null:JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const due=()=>json({generatedAt:new Date(NOW-101*60000).toISOString()});
function harness(fn){const calls=[];return {calls,fetcher:async(url,opts)=>{calls.push({url,opts});return fn(url,opts,calls);}};}
const check=(h,extra={})=>S.check({fetcher:h.fetcher,now:NOW,token:TOKEN,delay:async()=>{},...extra});

test('observed production failure: successful start/read and dispatch403 is an actionable nonzero configuration outcome',async()=>{
 const h=harness(url=>url===S.SNAPSHOT_URL?due():url===S.RUNS_URL?json({workflow_runs:[]}):json({message:TOKEN},403,{'x-github-request-id':'AA:BB:123','x-accepted-github-permissions':'actions=write','x-github-sso':'required; url=https://secret.example/'+TOKEN}));
 const r=await check(h);
 assert.equal(r.state,'CONFIGURATION_REQUIRED');assert.equal(r.reason,'GITHUB_ACTIONS_PERMISSION_DENIED');assert.equal(r.stage,'dispatch');assert.equal(r.httpStatus,403);assert.equal(r.ageMin,101);
 assert.equal(r.githubRequestId,'AA:BB:123');assert.equal(r.actionsWriteRequired,true);assert.equal(r.ssoAuthorizationRequired,true);assert.equal(S.exitCode(r),2);
 assert.equal(h.calls.filter(x=>x.opts.method==='POST').length,1);
 const log=JSON.stringify(S.logRecord('RADAR_SCHEDULER_OUTCOME',r));assert(!log.includes(TOKEN));assert(!log.includes('secret.example'));assert.match(JSON.parse(log).message,/CONFIGURATION_REQUIRED/);
});

test('401403404422 on either GitHub stage are terminal configuration failures, with no authorization retry loop',async()=>{
 for(const stage of ['run-state','dispatch'])for(const status of [401,403,404,422]){
  const h=harness(url=>url===S.SNAPSHOT_URL?due():url===S.RUNS_URL?json({workflow_runs:[]},stage==='run-state'?status:200):json({},status));
  const r=await check(h);assert.equal(r.state,'CONFIGURATION_REQUIRED');assert.equal(r.stage,stage);assert.equal(r.httpStatus,status);
  assert.equal(h.calls.filter(x=>x.url===S.RUNS_URL).length,1);assert.equal(h.calls.filter(x=>x.url===S.DISPATCH_URL).length,stage==='dispatch'?1:0);
 }
});

test('bounded GET retry honors short Retry-After once, while long cooldowns never wait or dispatch blindly',async()=>{
 const waits=[];let runs=0;
 const h=harness(url=>url===S.SNAPSHOT_URL?due():url===S.RUNS_URL?++runs===1?json({},429,{'retry-after':'1'}):json({workflow_runs:[]}):json(null,204));
 assert.equal((await check(h,{delay:async ms=>waits.push(ms)})).state,'DISPATCHED');assert.deepEqual(waits,[1000]);assert.equal(runs,2);
 const long=harness(url=>url===S.SNAPSHOT_URL?due():json({},429,{'retry-after':'120'}));
 const r=await check(long,{delay:async()=>{throw Error('must not wait');}});assert.equal(r.state,'BLOCKED');assert.equal(long.calls.length,2);
});

test('read-only transport failure retries once and malformed run records never permit dispatch',async()=>{
 let reads=0;const waits=[];
 const h=harness(url=>{if(url===S.SNAPSHOT_URL)return due();if(url===S.RUNS_URL){if(++reads===1)throw Error(TOKEN);return json({workflow_runs:[]});}return json(null,204);});
 assert.equal((await check(h,{delay:async ms=>waits.push(ms)})).state,'DISPATCHED');assert.equal(reads,2);assert.deepEqual(waits,[500]);
 assert.deepEqual(JSON.parse(h.calls.find(x=>x.url===S.DISPATCH_URL).opts.body),{ref:'main',inputs:{target:'production',only_if_due:true}});
 for(const runs of [[null],[{status:'made_up'}],{},'bad']){
  const bad=harness(url=>url===S.SNAPSHOT_URL?due():json({workflow_runs:runs}));
  const r=await check(bad);assert.equal(r.state,'BLOCKED');assert.equal(r.reason,'GITHUB_RUNS_INVALID');assert(!bad.calls.some(x=>x.url===S.DISPATCH_URL));
 }
});

test('a GitHub403 explicitly reporting rate exhaustion is blocked without authorization retry',async()=>{
 const h=harness(url=>url===S.SNAPSHOT_URL?due():url===S.RUNS_URL?json({workflow_runs:[]}):json({},403,{'x-ratelimit-remaining':'0'}));
 const r=await check(h);assert.equal(r.state,'BLOCKED');assert.equal(r.reason,'GITHUB_RATE_LIMITED');assert.equal(h.calls.filter(x=>x.url===S.DISPATCH_URL).length,1);
});

test('future or malformed snapshot timestamps cannot suppress the existing-run safety gate',async()=>{
 for(const generatedAt of ['not-a-date',new Date(NOW+3600000).toISOString()]){
  const h=harness(url=>url===S.SNAPSHOT_URL?json({generatedAt}):url===S.RUNS_URL?json({workflow_runs:[{status:'in_progress',created_at:new Date(NOW-3600000).toISOString(),event:'workflow_dispatch'}]}):json(null,204));
  const r=await check(h);assert.equal(r.state,'SKIPPED');assert.equal(r.snapshotReadable,false);assert.equal(h.calls.length,2);
 }
});

test('section source age remains visible while a fresh global publication preserves the two-hour work budget',async()=>{
 const ago=minutes=>new Date(NOW-minutes*60000).toISOString();
 const sections=Object.fromEntries(['arc','ethereum','robinhood','pons'].map(n=>[n,{asOf:ago(n==='pons'?480:10),sourceRadarAsOf:ago(n==='pons'?480:10),carriedForward:n==='pons'}]));
 const h=harness(()=>json({generatedAt:ago(10),sections}));
 const result=await check(h);
 assert.equal(result.state,'SKIPPED');assert.equal(result.reason,'SNAPSHOT_UNDER_100_MINUTES');assert.equal(result.level,'CRITICAL');assert.equal(result.ageMin,10);
 assert.equal(result.sectionFreshness.pons.ageMin,480);assert.equal(result.sectionFreshness.pons.carriedForward,true);assert.equal(result.oldestSectionAgeMin,480);
 assert.deepEqual(result.degradedSections,{pons:'CRITICAL'});assert.deepEqual(h.calls.map(x=>x.url),[S.SNAPSHOT_URL]);
});

test('GET outage retries at most twice; dispatch5xx429 and ambiguous transport are never retried',async()=>{
 const reads=harness(url=>url===S.SNAPSHOT_URL?due():json({},503));
 assert.equal((await check(reads)).state,'BLOCKED');assert.equal(reads.calls.filter(x=>x.url===S.RUNS_URL).length,2);
 for(const status of [429,500,502,503,504]){
  const h=harness(url=>url===S.SNAPSHOT_URL?due():url===S.RUNS_URL?json({workflow_runs:[]}):json({},status));
  assert.equal((await check(h)).state,'BLOCKED');assert.equal(h.calls.filter(x=>x.opts.method==='POST').length,1);
 }
 const h=harness(url=>{if(url===S.SNAPSHOT_URL)return due();if(url===S.RUNS_URL)return json({workflow_runs:[]});throw Object.assign(Error(TOKEN),{code:TOKEN});});
 const r=await check(h);assert.equal(r.reason,'DISPATCH_OUTCOME_UNKNOWN');assert.equal(r.errorCode,'TRANSPORT_ERROR');assert(!JSON.stringify(r).includes(TOKEN));
 const second=await check(h);assert.equal(second.reason,'DISPATCH_ALREADY_ATTEMPTED_THIS_PROCESS');assert.equal(h.calls.filter(x=>x.opts.method==='POST').length,1);
});

test('concurrent invocations coalesce and eventual run-list propagation cannot dispatch twice in the same process',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const h=harness(async url=>{if(url===S.SNAPSHOT_URL){await gate;return due();}return url===S.RUNS_URL?json({workflow_runs:[]}):json(null,204);});
 const first=check(h),second=check(h);release();
 assert.deepEqual(await first,await second);assert.equal(h.calls.filter(x=>x.url===S.DISPATCH_URL).length,1);
 assert.equal((await check(h)).state,'SKIPPED');assert.equal(h.calls.filter(x=>x.url===S.DISPATCH_URL).length,1);
});

test('wall-clock deadline covers a fetcher and response body that ignore AbortSignal',async()=>{
 const stuck=new Promise(()=>{}),t0=Date.now();
 const headers=harness(()=>stuck);
 const a=await check(headers,{requestTimeoutMs:15,totalTimeoutMs:35});assert.equal(a.state,'BLOCKED');assert(Date.now()-t0<500);assert(!headers.calls.some(x=>x.url===S.DISPATCH_URL));
 const body=harness(url=>url===S.SNAPSHOT_URL?due():{ok:true,status:200,text:()=>stuck});
 const b=await check(body,{requestTimeoutMs:15,totalTimeoutMs:35});assert.equal(b.state,'BLOCKED');assert.equal(b.errorCode,'REQUEST_TIMEOUT');assert(!body.calls.some(x=>x.url===S.DISPATCH_URL));
});

test('a read-only timeout may retry once within budget; a dispatch timeout remains an unknown single attempt',async()=>{
 let snapshotReads=0;const waits=[];
 const h=harness(url=>url===S.SNAPSHOT_URL?++snapshotReads===1?new Promise(()=>{}):due():url===S.RUNS_URL?json({workflow_runs:[]}):json(null,204));
 assert.equal((await check(h,{requestTimeoutMs:10,totalTimeoutMs:1000,delay:async ms=>waits.push(ms)})).state,'DISPATCHED');
 assert.equal(snapshotReads,2);assert.deepEqual(waits,[500]);
 const post=harness(url=>url===S.SNAPSHOT_URL?due():url===S.RUNS_URL?json({workflow_runs:[]}):new Promise(()=>{}));
 const result=await check(post,{requestTimeoutMs:10,totalTimeoutMs:1000});
 assert.equal(result.state,'BLOCKED');assert.equal(result.reason,'DISPATCH_OUTCOME_UNKNOWN');assert.equal(result.errorCode,'REQUEST_TIMEOUT');
 assert.equal(post.calls.filter(x=>x.url===S.DISPATCH_URL).length,1);
 assert.equal((await check(post)).state,'SKIPPED');assert.equal(post.calls.filter(x=>x.url===S.DISPATCH_URL).length,1);
});

test('bounded streamed body is cancelled on overflow without reading a secret-bearing error body',async()=>{
 let cancelled=false,readErrorBody=false;
 const h=harness(url=>url===S.SNAPSHOT_URL?due():url===S.RUNS_URL?new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(3000001));},cancel(){cancelled=true;}})):{ok:false,status:403,text:async()=>{readErrorBody=true;return TOKEN;}});
 const r=await check(h);assert.equal(r.state,'BLOCKED');assert.equal(r.errorCode,'RESPONSE_TOO_LARGE');assert.equal(cancelled,true);assert.equal(readErrorBody,false);assert.equal(h.calls.length,2);
});

test('invalid credential is detected before network; every CLI outcome has a nonempty Railway message and honest exit code',()=>{
 for(const state of ['SKIPPED','DISPATCHED','CONFIGURATION_REQUIRED','BLOCKED']){
  const r={state,reason:'FIXTURE'};assert.equal(S.exitCode(r),state==='CONFIGURATION_REQUIRED'?2:state==='BLOCKED'?1:0);assert(S.logRecord('RADAR_SCHEDULER_OUTCOME',r).message.length>0);
 }
 assert.equal(S.exitCode({state:'UNRECOGNIZED'}),1,'unknown outcomes fail closed');
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/radar-railway-dispatch.cjs')],{env:{...process.env,RADAR_GITHUB_DISPATCH_TOKEN:''},encoding:'utf8',windowsHide:true});
 assert.equal(result.status,2);const rows=result.stdout.trim().split(/\r?\n/).map(JSON.parse);assert.equal(rows.length,2);assert.equal(rows[0].event,'RADAR_SCHEDULER_START');assert.equal(rows[1].state,'CONFIGURATION_REQUIRED');assert(rows.every(r=>r.message));
});
