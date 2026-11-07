'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../search/server/lib/operational-status');
const NOW=Date.parse('2026-11-07T12:00:00Z');
const ago=s=>NOW-s*1000;
const iso=s=>new Date(ago(s)).toISOString();
const ADDR='0x'+'ab'.repeat(20);
function diag({beat=20,requests=1000,http429=10,providers=[{cooldownMs:0},{cooldownMs:0}],tokens,commit='1234567890abcdef'}={}){
 return {ok:true,worker:{runtime:{commit,startedAt:iso(3600)},rpc:{metrics:{requests,http429},providers},
  scheduler:{totals:{slices:40,complete:5},lastInvocation:beat===null?null:{at:ago(beat),elapsedMs:12345,served:[ADDR],states:{COMPLETE:1}}},
  tokens:tokens||[{address:ADDR,phase:'TAIL',lastState:'BUILDING',lastAdvanced:500,slices:4,idleMs:5000},{address:'0x'+'cd'.repeat(20),phase:null,lastState:'COMPLETE',idleMs:90000,slices:2}]}};
}
const pulse=(h)=>({lastSuccessful:{number:7,status:'updated',generatedAt:iso(h*3600)},lastFailure:null});
const healthyInputs=()=>({diagnostics:diag(),pulseAudit:pulse(30),networkPulseAudit:{chains:{ethereum:pulse(30),robinhood:pulse(30)}},
 unlockAudit:{lastSuccessful:{generatedAt:iso(3600),refreshAt:new Date(NOW+5*3600e3).toISOString(),eventCount:41,partial:false},lastFailure:null},
 runtime:{commit:'1234567aaaaaaa',environment:'production'}});

test('status: fresh heartbeat, fresh publications => HEALTHY with measured ages and counts only',()=>{
 const r=S.evaluate(healthyInputs(),NOW);
 assert.equal(r.overall,'HEALTHY');
 const w=r.components.holderWorker;
 assert.equal(w.state,'HEALTHY');assert.equal(w.heartbeat.ageSeconds,20);assert.equal(w.heartbeat.lastInvocationServed,1);
 assert.deepEqual(w.backlog,{tokensTracked:2,inProgress:1,complete:1,failing:0,stalled:0});
 assert.equal(w.lastCompleteSliceAgeSeconds,90);assert.equal(w.rpc.http429Share,0.01);
 assert.equal(r.components.unlocks.eventCount,41);assert.equal(r.components.pulse.arc.edition,7);
 assert.equal(r.version.match,true);
 assert.doesNotMatch(JSON.stringify(r),/0x[0-9a-f]{40}/i,'no token addresses or queue contents are exposed');
});
test('status: a published snapshot never substitutes for a heartbeat; stale/absent heartbeat is not healthy',()=>{
 assert.equal(S.holderWorker(diag({beat:600}),NOW).state,'DEGRADED');
 assert.equal(S.holderWorker(diag({beat:600}),NOW).reasonCode,'HEARTBEAT_LATE');
 const stale=S.holderWorker(diag({beat:3600}),NOW);assert.equal(stale.state,'UNAVAILABLE');assert.equal(stale.reasonCode,'HEARTBEAT_STALE');
 assert.equal(S.holderWorker(diag({beat:null}),NOW).reasonCode,'NO_SCHEDULER_INVOCATION_SINCE_START');
 const i=healthyInputs();i.diagnostics=diag({beat:3600});
 assert.equal(S.evaluate(i,NOW).overall,'UNAVAILABLE');
});
test('status: unreachable worker is UNAVAILABLE; missing configuration (Preview) is UNKNOWN, never HEALTHY',()=>{
 const down=S.evaluate({...healthyInputs(),diagnostics:{unreachable:true,reasonCode:'WORKER_TIMEOUT'}},NOW);
 assert.equal(down.components.holderWorker.state,'UNAVAILABLE');assert.equal(down.components.holderWorker.reasonCode,'WORKER_TIMEOUT');assert.equal(down.overall,'UNAVAILABLE');
 const preview=S.evaluate({diagnostics:{notConfigured:true}},NOW);
 assert.equal(preview.components.holderWorker.state,'UNKNOWN');assert.notEqual(preview.overall,'HEALTHY');
 assert.equal(S.holderWorker({ok:true},NOW).reasonCode,'WORKER_DIAGNOSTICS_MALFORMED');
});
test('status: RPC 429 share, all providers cooling and fully stalled backlog degrade a live worker',()=>{
 assert.equal(S.holderWorker(diag({requests:200,http429:80}),NOW).reasonCode,'RPC_429_SHARE_HIGH');
 assert.equal(S.holderWorker(diag({requests:20,http429:15}),NOW).state,'HEALTHY','tiny samples do not alarm');
 assert.equal(S.holderWorker(diag({providers:[{cooldownMs:5000},{cooldownMs:1000}]}),NOW).reasonCode,'ALL_RPC_PROVIDERS_COOLING');
 const stuck=S.holderWorker(diag({tokens:[{address:ADDR,phase:'TAIL',lastState:'BUILDING',lastAdvanced:0,slices:9,idleMs:1}]}),NOW);
 assert.equal(stuck.reasonCode,'ALL_IN_PROGRESS_WORK_STALLED');assert.equal(stuck.backlog.stalled,1);
});
test('status: Pulse and Unlock freshness thresholds and failures after last success',()=>{
 assert.equal(S.weekly(pulse(24*9),NOW).state,'DEGRADED');
 assert.equal(S.weekly(pulse(24*20),NOW).reasonCode,'PUBLICATION_STALE');
 assert.equal(S.weekly(null,NOW).reasonCode,'NO_SUCCESSFUL_PUBLICATION');
 assert.equal(S.weekly(undefined,NOW).state,'UNKNOWN');
 const failedAfter={...pulse(48),lastFailure:{at:iso(3600),code:'PULSE_SOURCE_COVERAGE_INCOMPLETE'}};
 const w=S.weekly(failedAfter,NOW);assert.equal(w.reasonCode,'LATEST_REFRESH_FAILED');assert.equal(w.lastFailureCode,'PULSE_SOURCE_COVERAGE_INCOMPLETE');
 const u=s=>S.unlocks({lastSuccessful:{generatedAt:iso(30000),refreshAt:new Date(NOW-s*1000).toISOString(),eventCount:3}},NOW);
 assert.equal(u(60).state,'HEALTHY');assert.equal(u(7200).reasonCode,'REFRESH_OVERDUE');assert.equal(u(200000).reasonCode,'CALENDAR_STALE');
 assert.equal(S.unlocks({lastSuccessful:{refreshAt:new Date(NOW+1e6).toISOString()},lastFailure:{consecutive:2,code:'UNLOCK_REFRESH_FAILED'}},NOW).reasonCode,'REFRESH_FAILING');
 const r=S.evaluate({...healthyInputs(),pulseAudit:pulse(24*20)},NOW);
 assert.equal(r.overall,'DEGRADED','stale data degrades the pipeline but does not mark the live worker down');
});
test('status: version mismatch is reported, not failed; unknown worker commit is null',()=>{
 const i=healthyInputs();i.runtime.commit='fffffff000';const r=S.evaluate(i,NOW);
 assert.equal(r.version.match,false);assert.equal(r.overall,'HEALTHY');
 i.diagnostics=diag({commit:null});assert.equal(S.evaluate(i,NOW).version.match,null);
});

test('status endpoint: four cheap authenticated read-only GETs, cached and coalesced, no secrets in output',async()=>{
 const api=require('../search/server/api/status');api._reset();
 const env={...process.env};
 process.env.ARC_HOLDER_QUEUE_URL='https://worker.example.invalid/queue';process.env.ARC_HOLDER_QUEUE_TOKEN='s3cret-token';process.env.VERCEL_GIT_COMMIT_SHA='1234567aaaa';
 const calls=[];const realFetch=global.fetch;
 const body=v=>new Response(JSON.stringify(v),{status:200,headers:{'content-type':'application/json'}});
 global.fetch=async(url,opts)=>{calls.push({path:url.pathname+url.search,auth:opts.headers.authorization,method:opts.method||'GET'});
  const p=url.pathname;const now=Date.now();
  if(p==='/holder/rpc-diagnostics')return body({...diag(),worker:{...diag().worker,scheduler:{totals:{},lastInvocation:{at:now-5000,states:{}}}}});
  if(p==='/pulse/audit')return body({lastSuccessful:{generatedAt:new Date(now-3600e3).toISOString(),number:7}});
  if(p==='/pulse/networks/audit')return body({chains:{ethereum:{lastSuccessful:{generatedAt:new Date(now-3600e3).toISOString()}},robinhood:null}});
  if(p==='/unlocks/audit')return new Response('{}',{status:404});
  return new Response('{}',{status:500});};
 try{
  const out=[];const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(v){out.push(v);return this;}};
  await Promise.all([api({method:'GET'},res),api({method:'GET'},res)]);
  await api({method:'GET'},res);
  assert.equal(calls.length,4,'coalesced + cached: one collection for three requests');
  assert.deepEqual(calls.map(c=>c.path).sort(),['/holder/rpc-diagnostics?probe=0','/pulse/audit','/pulse/networks/audit','/unlocks/audit']);
  assert.ok(calls.every(c=>c.method==='GET'&&c.auth==='Bearer s3cret-token'));
  const v=out[0];assert.equal(v.ok,true);assert.equal(res.headers['Cache-Control'],'no-store');
  assert.equal(v.components.holderWorker.state,'HEALTHY');
  assert.equal(v.components.pulse.robinhood.reasonCode,'NO_SUCCESSFUL_PUBLICATION');
  assert.equal(v.components.unlocks.state,'UNKNOWN');assert.equal(v.components.unlocks.reasonCode,'AUDIT_UNAVAILABLE');
  const text=JSON.stringify(v);
  assert.doesNotMatch(text,/s3cret|worker\.example|0x[0-9a-f]{40}/i);
 }finally{global.fetch=realFetch;for(const k of ['ARC_HOLDER_QUEUE_URL','ARC_HOLDER_QUEUE_TOKEN','VERCEL_GIT_COMMIT_SHA'])if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];api._reset();}
});
test('status endpoint via public router: action=status takes no parameters and rejects others',async()=>{
 const router=require('../api/search');
 const mk=url=>new Promise(resolve=>{const res={setHeader(){},status(c){this.code=c;return this;},json(v){resolve({code:this.code,v});}};router({method:'GET',url,query:{}},res);});
 const ok=await mk('/api/search?action=status');assert.equal(ok.code,200);assert.equal(ok.v.ok,true);
 const env=process.env.ARC_HOLDER_QUEUE_URL;assert.equal(env,undefined);
 assert.equal(ok.v.components.holderWorker.state,'UNKNOWN');
});

test('status: a completed token keeps its last checkpoint phase but is not counted as backlog (live 2026-11-07: 52 shown as in progress)',()=>{
 const w=S.holderWorker(diag({tokens:[{address:ADDR,phase:'READ',lastState:'COMPLETE',lastAdvanced:0,slices:9,idleMs:6000},{address:ADDR,phase:'TAIL',lastState:'BUILDING',lastAdvanced:0,slices:4,idleMs:1}]}),NOW);
 assert.deepEqual(w.backlog,{tokensTracked:2,inProgress:1,complete:1,failing:0,stalled:1});
});
