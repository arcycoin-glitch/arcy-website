'use strict';
// #326: Railway logs showed BLOCKED / DISPATCH_HTTP_403 after a successful run-state GET (token authenticates and reads,
// dispatch is refused). These tests pin the non-secret credential diagnostics that identify WHICH token fix is required.
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../scripts/radar-railway-dispatch.cjs');
const NOW=Date.parse('2026-11-27T06:19:05.211Z'),TOKEN='github_pat_fixture_only_12345678901234567890';
const json=(body,status=200,headers={})=>new Response(status===204?null:JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const due=()=>json({generatedAt:new Date(NOW-101*60000).toISOString()});
function harness(runHeaders,postStatus=403,postHeaders={}){const calls=[];return {calls,fetcher:async(url,opts)=>{calls.push({url,opts});
 return url===S.SNAPSHOT_URL?due():url===S.RUNS_URL?json({workflow_runs:[]},200,runHeaders):json({message:'Resource not accessible by personal access token '+TOKEN},postStatus,postHeaders);}};}
const run=h=>S.check({fetcher:h.fetcher,now:NOW,token:TOKEN,delay:async()=>{}});
const noSecret=r=>{const log=JSON.stringify(S.logRecord('RADAR_SCHEDULER_OUTCOME',r));assert(!log.includes(TOKEN));assert(!log.includes('Resource not accessible'));};

test('fine-grained token: read succeeds, dispatch 403 reports Actions write remediation without secrets',async()=>{
 const h=harness({'x-oauth-scopes':'','github-authentication-token-expiration':'2099-01-01 00:00:00 UTC'},403,{'x-accepted-github-permissions':'actions=write'});
 const r=await run(h);
 assert.equal(r.state,'CONFIGURATION_REQUIRED');assert.equal(r.reason,'GITHUB_ACTIONS_PERMISSION_DENIED');assert.equal(r.stage,'dispatch');
 assert.equal(r.credentialKind,'fine-grained-or-app');assert.equal(r.remediation,'FINE_GRAINED_TOKEN_NEEDS_ACTIONS_WRITE_ON_REPOSITORY');
 assert.equal(r.actionsWriteRequired,true);assert.equal(r.credentialExpired,false);assert.equal(r.credentialExpiresAt,'2099-01-01T00:00:00.000Z');
 assert.equal(r.credential,undefined);assert.equal(h.calls.filter(c=>c.opts.method==='POST').length,1);assert.equal(S.exitCode(r),2);noSecret(r);
});

test('classic token without repo scope is named precisely; scope names are allowlisted',async()=>{
 const r=await run(harness({'x-oauth-scopes':'public_repo, read:org, '+TOKEN}));
 assert.equal(r.credentialKind,'classic');assert.deepEqual(r.credentialScopes,['public_repo','read:org']);assert.equal(r.classicRepoScope,false);
 assert.equal(r.remediation,'CLASSIC_TOKEN_MISSING_REPO_SCOPE');noSecret(r);
});

test('classic token WITH repo scope still refused points at token owner write access',async()=>{
 const r=await run(harness({'x-oauth-scopes':'repo, workflow'}));
 assert.equal(r.classicRepoScope,true);assert.equal(r.remediation,'TOKEN_OWNER_OR_TOKEN_LACKS_ACTIONS_WRITE');noSecret(r);
});

test('missing credential headers never invent a kind; valid 204 dispatch is unaffected',async()=>{
 const r=await run(harness({}));assert.equal(r.credentialKind,undefined);assert.equal(r.remediation,'TOKEN_OWNER_OR_TOKEN_LACKS_ACTIONS_WRITE');
 const ok=await run(harness({'x-oauth-scopes':''},204));assert.equal(ok.state,'DISPATCHED');assert.equal(S.exitCode(ok),0);assert.equal(ok.credentialKind,undefined);
});

test('expired credential is flagged from the expiry header; malformed expiry is ignored',async()=>{
 const r=await run(harness({'x-oauth-scopes':'','github-authentication-token-expiration':'2020-01-01 00:00:00 UTC'}));assert.equal(r.credentialExpired,true);
 const m=await run(harness({'github-authentication-token-expiration':'x'.repeat(80)}));assert.equal(m.credentialExpiresAt,undefined);
});

test('403 rate limiting and non-dispatch stages carry no token remediation',async()=>{
 const rl=await run(harness({'x-oauth-scopes':''},403,{'x-ratelimit-remaining':'0'}));assert.equal(rl.reason,'GITHUB_RATE_LIMITED');assert.equal(rl.remediation,undefined);assert.equal(rl.credential,undefined);
 const nf=await run(harness({'x-oauth-scopes':''},404));assert.equal(nf.reason,'GITHUB_WORKFLOW_OR_REPOSITORY_INACCESSIBLE');assert.equal(nf.remediation,undefined);
});
