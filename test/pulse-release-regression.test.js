'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const edition=require('../lib/pulse-edition'),client=require('../lib/pulse-client');
const {ARC_BLOG,completeSources}=require('./helpers/pulse-source-fixtures.cjs');
const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
function freshHandler(){delete require.cache[require.resolve('../api/pulse')];return require('../api/pulse');}
function value(now){const cycle=edition.cycle(now);return {number:edition.number(now),status:'updated',generatedAt:new Date(now).toISOString(),cycle:{start:new Date(cycle.start).toISOString(),end:new Date(cycle.end).toISOString()},cards:[{kind:'week',title:'Dated fixture',summary:'Source fixture only',url:'https://www.arc.io/blog/fixture',publishedAt:new Date(now).toISOString()}],take:'Fixture only',audit:{}};}
const article=(title,date)=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Article',headline:title,datePublished:date})+'</script>';

test('next Monday06UTC audit includes the upcoming run on Monday before06, then advances a week',()=>{
 assert.equal(edition.nextRun(Date.parse('2026-10-19T05:59:59Z')),'2026-10-19T06:00:00.000Z');
 assert.equal(edition.nextRun(Date.parse('2026-10-19T06:00:00Z')),'2026-10-26T06:00:00.000Z');
});
test('a future-dated story within this calendar week cannot become current verified news',async()=>{
 const now=Date.parse('2026-10-07T12:00:00Z');
 const result=await edition.generate({now,fetcher:completeSources(async url=>({ok:true,status:200,text:async()=>url===ARC_BLOG.url?'<a href="/blog/future">Future</a>':url.endsWith('/future')?article('Arc future development','2026-10-08T00:00:00Z'):'<html></html>'}))});
 assert.equal(result.status,'quiet_week');assert.equal(result.audit.acceptedItemCount,0);assert.equal(result.audit.rejected.future,1);assert.ok(result.cards.every(c=>c.title!=='Arc future development'));
 assert.equal(result.audit.sourcesSuccessfullyChecked,edition.SOURCES.length);
});
test('a linked article fetch failure cannot masquerade as a technically successful quiet week',async()=>{
 const community=edition.SOURCES.find(s=>s.url.includes('/public/blogs'));
 await assert.rejects(edition.generate({now:Date.parse('2026-10-07T12:00:00Z'),fetcher:completeSources(async url=>url.endsWith('/broken')?{ok:false,status:503,text:async()=>''}:{ok:true,status:200,text:async()=>url===community.url?'<a href="/public/blogs/broken">Arc developer infrastructure update</a>':'<html></html>'})}),error=>error.code==='PULSE_SOURCE_COVERAGE_INCOMPLETE'&&error.audit.sourceFailures.some(f=>f.errorCode==='HTTP_503'));
});
test('one parsed article does not hide another failed article in the same source',async()=>{
 await assert.rejects(edition.generate({now:Date.parse('2026-10-07T12:00:00Z'),fetcher:completeSources(async url=>url.endsWith('/broken')?{ok:false,status:404,text:async()=>''}:{ok:true,status:200,text:async()=>url===ARC_BLOG.url?'<a href="/blog/old">Old</a><a href="/blog/broken">Broken</a>':url.endsWith('/old')?article('Arc old development','2026-09-01T00:00:00Z'):'<html></html>'})}),error=>error.code==='PULSE_SOURCE_COVERAGE_INCOMPLETE'&&error.audit.sourceFailures.some(f=>f.errorCode==='HTTP_404'));
});
test('concurrent week rollover uses independent work and never caches one week as another',async()=>{
 const old={latest:client.latest,audit:client.audit,generate:edition.generate,now:Date.now};const gates=new Map(),calls=[],pending=[];
 const first=Date.parse('2026-10-18T23:59:59Z'),second=Date.parse('2026-10-19T00:00:01Z');let now=first;
 try{
  Date.now=()=>now;client.latest=async()=>null;client.audit=async()=>null;
  edition.generate=({now})=>{calls.push(now);return new Promise(resolve=>gates.set(now,resolve));};
  const handler=freshHandler(),a=response(),b=response();pending.push(handler({method:'GET',query:{},headers:{}},a));await new Promise(setImmediate);
  now=second;pending.push(handler({method:'GET',query:{},headers:{}},b));await new Promise(setImmediate);
  assert.deepEqual(calls,[first,second]);gates.get(second)(value(second));gates.get(first)(value(first));await Promise.all(pending);
  assert.equal(a.body.cycle.start,'2026-10-12T00:00:00.000Z');assert.equal(b.body.cycle.start,'2026-10-19T00:00:00.000Z');
  const c=response();await handler({method:'GET',query:{},headers:{}},c);assert.equal(c.body.cycle.start,b.body.cycle.start);assert.equal(calls.length,2);
 }finally{for(const[now,resolve]of gates)resolve(value(now));await Promise.allSettled(pending);Date.now=old.now;client.latest=old.latest;client.audit=old.audit;edition.generate=old.generate;}
});
test('failed transient check preserves signed last-success and failure audit without publishing',async()=>{
 const old={latest:client.latest,audit:client.audit,refresh:client.refresh,generate:edition.generate};let refreshes=0;
 const saved=value(Date.parse('2026-10-05T07:00:00Z'));
 try{
  client.latest=async()=>saved;client.audit=async()=>({lastSuccessful:{number:saved.number},lastFailure:{code:'SOURCE_UNAVAILABLE',at:'2026-10-19T06:00:00Z'}});
  client.refresh=async()=>{refreshes++;throw Error('Public GET must never publish');};edition.generate=async()=>{throw Object.assign(Error('sanitized fixture'),{code:'PULSE_DISCOVERY_UNAVAILABLE'});};
  const r=response();await freshHandler()({method:'GET',query:{},headers:{}},r);
  assert.equal(r.code,200);assert.equal(r.body.status,'source_pending');assert.equal(r.body.audit.lastSuccessful.number,saved.number);assert.equal(r.body.audit.lastFailure.code,'SOURCE_UNAVAILABLE');assert.equal(refreshes,0);
  assert.equal(r.body.cards.length,3);assert.ok(r.body.cards.every(c=>c.verifiedCurrentWeek===false));
 }finally{Object.assign(client,{latest:old.latest,audit:old.audit,refresh:old.refresh});edition.generate=old.generate;}
});
test('public source deadline aborts its fetch instead of leaving provider work running',async t=>{
 const old={fetch:global.fetch,latest:client.latest,generate:edition.generate};let signal;
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  client.latest=async()=>null;global.fetch=async(_,options)=>{signal=options.signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('abort fixture'),{code:'ABORT_ERR'})),{once:true}));};
  edition.generate=({fetcher})=>fetcher('https://www.arc.io/blog');const r=response(),pending=freshHandler()({method:'GET',query:{},headers:{}},r);
  await new Promise(setImmediate);assert.ok(signal);t.mock.timers.tick(8500);await pending;
  assert.equal(signal.aborted,true);assert.equal(r.body.audit.reasonCode,'PULSE_TRANSIENT_TIMEOUT');assert.equal(r.code,200);
 }finally{global.fetch=old.fetch;client.latest=old.latest;edition.generate=old.generate;t.mock.timers.reset();}
});
