'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const appSource=fs.readFileSync(path.join(root,'site-refresh.js'),'utf8');
const gatewaySource=fs.readFileSync(path.join(root,'api/search/index.js'),'utf8');
function scheduler({archive=false}={}){
 const listeners={},calls=[],timers=[];
 let now=Date.parse('2026-10-15T12:00:00Z'),visible='visible',online=true,finish;
 const fn=name=>(arg)=>{calls.push([name,arg]);return name==='unlocks'?new Promise(resolve=>{finish=resolve}):Promise.resolve()};
 const window={loadBurn:fn('burn'),loadArcPrices:fn('market'),loadUnlocks:fn('unlocks'),loadPulse:fn('pulse'),
  addEventListener(k,cb){listeners['window:'+k]=cb}};
 const document={get visibilityState(){return visible},addEventListener(k,cb){listeners['doc:'+k]=cb}};
 const navigator={get onLine(){return online}};
 const clock={now:()=>now},location={search:archive?'?pulseEdition=2':''};
 vm.runInNewContext(appSource,{document,window,navigator,location,Date:clock,URLSearchParams,Promise,
  setInterval(cb,ms){timers.push([cb,ms]);return 1}});
 return {tick:t=>{now=t;window.ARCY_AUTO_REFRESH.check(t)},calls,window,listeners,timers,
  get finishing(){return finish},set visible(v){visible=v},set online(v){online=v}};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('refresh script uses bounded intervals and performs NO duplicate initial fetches',async()=>{
 const x=scheduler();assert.equal(x.calls.length,0);
 assert.equal(x.timers.length,1);assert.equal(x.timers[0][1],60000);
 const start=Date.parse('2026-10-15T12:00:00Z');
 x.tick(start+121000);await flush();
 assert.deepEqual(x.calls.map(x=>x[0]),['burn']);
 x.tick(start+181000);await flush();
 assert.deepEqual(x.calls.map(x=>x[0]),['burn','market']);
 x.tick(start+601000);await flush();
 assert.deepEqual(x.calls.map(x=>x[0]),['burn','market','burn','market','unlocks']);
 assert.equal(x.calls[4][1].silent,true,'background unlock refresh preserves active pagination');
 x.tick(start+3601000);await flush();
 assert.ok(x.calls.some(x=>x[0]==='pulse'),'Pulse refreshes after 1h');
 x.finishing();await flush();
 assert.equal(x.window.ARCY_AUTO_REFRESH.status().unlocks.pending,false);
});
test('background, offline, archived Pulse and pending requests do not thrash providers',async()=>{
 const start=Date.parse('2026-10-15T12:00:00Z'),x=scheduler({archive:true});
 x.visible='hidden';x.tick(start+7200000);await flush();assert.equal(x.calls.length,0);
 x.visible='visible';x.online=false;x.tick(start+7200000);await flush();assert.equal(x.calls.length,0);
 x.online=true;x.listeners['window:focus']();await flush();assert.equal(x.calls.length,3);
 assert.ok(!x.calls.some(x=>x[0]==='pulse'),'archive edition must never be overwritten');
 x.tick(start+7201000);await flush();assert.equal(x.calls.length,3,'timer cannot refetch immediately');
 x.tick(start+7900000);await flush();
 const initialUnlocks=x.calls.filter(x=>x[0]==='unlocks');
 assert.equal(initialUnlocks.length,1,'pending requests are coalesced');
 x.finishing();await flush();
});
test('site keeps exactly the approved sections and exposes refresh handlers',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 for(const method of ['loadBurn','loadUnlocks','loadPulse','loadArcPrices'])
  assert.match(html,new RegExp('async function '+method+'\\('));
 assert.match(html,/\/site-refresh\.js/);
 assert.match(html,/if\(!silent\)unlockPage=1/);
});
function harness(){
 const actionCalls=[],handlers={};
 for(const name of ['health','token','report','progress','discover','chart']){
  handlers[name]=async (req,res)=>{actionCalls.push({name,query:req.query,method:req.method});
   return res.status(200).json({ok:true,action:name,query:req.query})};
 }
 const module={exports:null};
 vm.runInNewContext(gatewaySource,{module,require(p){
  const k=p.split('/').pop();assert.ok(handlers[k],p);return handlers[k];
 },Object,URL,Array});
 return {gateway:module.exports,calls:actionCalls};
}
function res(){return {statusCode:200,status(v){this.statusCode=v;return this},json(v){this.body=v;return v}}}
test('Vercel routing metadata cannot contaminate token/report/discovery strict query',async()=>{
 const {gateway,calls}=harness(),address='0x'+'a'.repeat(40);
 for(const action of ['report','progress','token','discover']){
  const wanted=action==='discover'?{action,q:'Pons',chain:'robinhood'}:{action,chain:'arc',address};
  const url='/api/search?'+new URLSearchParams(wanted).toString();
  const result=res();
  await gateway({method:'GET',url,query:{...wanted,_route:'/api/search',__internal:'index'}},result);
  assert.equal(result.statusCode,200);assert.equal(result.body.action,action);
  assert.equal(Object.keys(result.body.query).sort().join(','),action==='discover'?'chain,q':'address,chain');
 }
 assert.equal(calls.length,4);
});
test('URL query rejects duplicate action, falls back to local-dev request query',async()=>{
 const {gateway}=harness();
 let r=res();await gateway({method:'GET',url:'/api/search?action=token&action=health',query:{action:'health'}},r);
 assert.equal(r.statusCode,400);
 r=res();await gateway({method:'GET',query:{action:'health'}},r);
 assert.equal(r.statusCode,200);
 r=res();await gateway({method:'GET',url:'/api/search?action=wrong'},r);
 assert.equal(r.statusCode,404);
});

test('production rewrite query metadata is removed without relaxing address or chain validation',async()=>{
 const {gateway,calls}=harness(),address='0x'+'a'.repeat(40);
 const scenarios=[
  {action:'report',chain:'arc',address},
  {action:'token',chain:'arc',address},
  {action:'discover',chain:'robinhood',q:'Pons'},
  {action:'chart',chain:'ethereum',address,range:'1W'}
 ];
 for(const wanted of scenarios){
  const response=res();
  const rewrittenUrl='/api/search?'+new URLSearchParams({...wanted,_nextRouteMatch:'/api/search/index'}).toString();
  await gateway({
   method:'GET',url:rewrittenUrl,
   query:{...wanted,_nextRouteMatch:'/api/search/index',slug:'__function',path:'/api/search',search:''}
  },response);
  assert.equal(response.statusCode,200);
  assert.equal(response.body.action,wanted.action);
  const expected=Object.keys(wanted).filter(k=>k!=='action').sort();
  assert.equal(Object.keys(response.body.query).sort().join(','),expected.join(','));
 }
 assert.equal(calls.length,scenarios.length);
});
