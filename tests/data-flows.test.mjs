import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
function api(file, fetch, date = Date) {
  const evidence=fs.readFileSync(new URL('lib/unlock-evidence.js',root),'utf8').replaceAll('export const','const');
  const context = vm.createContext({fetch, Date: date, URL, URLSearchParams, process, AbortSignal});
  vm.runInContext(evidence,context);
  vm.runInContext(fs.readFileSync(new URL(file, root), 'utf8').replace(/^import .*unlock-evidence.*;\r?\n/m,'').replace('export default async function handler', 'async function handler'), context);
  return context;
}
function response() {
  return {headers: {}, setHeader(k,v){this.headers[k]=v;}, status(code){this.code=code;return this;}, json(body){this.body=body;return this;}};
}
function row(date, symbol='TIA') {
  return `<tr><td>1</td><td>Celestia ${symbol}</td><td>${date}</td><td>10K ${symbol}</td><td>$10K</td><td>0.02%</td><td>Ecosystem</td></tr>`;
}
function browser(fetch) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id,{textContent:'Loading…',innerHTML:'',value:'',dataset:{days:'1'},addEventListener(){},querySelectorAll(){return [];}});
    return elements.get(id);
  };
  const document = {getElementById:element,querySelector:selector=>selector==='.tab.active'?element('tab'):element(selector),querySelectorAll:()=>[]};
  const context = vm.createContext({fetch,document,URL,AbortSignal,Intl,console,setTimeout});
  vm.runInContext(fs.readFileSync(new URL('unlock-view.js',root),'utf8'),context);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  vm.runInContext(scripts[0].replace(/^loadBurn\(\);$/m,'').replace(/^loadUnlocks\(\);$/m,''), context);
  return {context,element,scripts};
}

test('all browser scripts compile; markup IDs are unique',()=>{
  for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
});
test('unlock parser rejects impossible dates, preserves circulating percentage',()=>{
  const c=api('api/unlocks.js',()=>{});
  assert.equal(c.parseRows(row('31 Feb 2026')).length,0);
  assert.equal(c.parseRows(row('30 Sep 2026'))[0].percent,'0.02%');
});
test('unlock windows do not overlap and cache expires by midnight',async()=>{
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:['2026-09-30T23:59:00Z']));}static now(){return Date.parse('2026-09-30T23:59:00Z');}}
  const source=['30 Sep 2026','01 Oct 2026','07 Oct 2026','08 Oct 2026','30 Oct 2026','31 Oct 2026'].map(d=>row(d)).join('');
  const c=api('api/unlocks.js',async url=>url.includes('coinbell')?{ok:true,text:async()=>source}:{ok:false},FixedDate);
  const r=response();await c.handler({},r);
  assert.equal(r.code,200);assert.equal(r.body.events.length,5);
  assert.deepEqual(Object.values(r.body.windows).map(w=>w.length),[1,2,2]);
  assert.equal(r.headers['Cache-Control'],'public, s-maxage=60, must-revalidate');
  assert.equal(r.body.windowTimeZone,'UTC');assert.equal(r.body.refreshAt,'2026-10-01T00:00:00.000Z');
});
test('unlock upstream failure is not cached as live data',async()=>{
  const c=api('api/unlocks.js',async()=>{throw Error('offline');});const r=response();await c.handler({},r);
  assert.equal(r.code,503);assert.equal(r.body.live,false);assert.equal(r.headers['Cache-Control'],'no-store');
});
test('upcoming token Burn display remains unverified instead of reusing the retired Arc token',()=>{
  assert.match(html,/id="burned">—<\/span>/);
  assert.match(html,/id="supply">—<\/b>/);
  assert.match(html,/Awaiting announcement/);
  assert.match(html,/DETAILS TO BE ANNOUNCED/);
});
test('upcoming token does not query the former Arc contract for a misleading Burn number',()=>{
  const b=browser(async()=>{throw Error('legacy supply must not be fetched')});
  assert.equal(typeof b.context.loadBurn,'undefined');
  assert.doesNotMatch(html,/async function loadBurn\(/);
});
test('Unlock failure remains unavailable after search or tab rendering',async()=>{
  const b=browser(async()=>({ok:false,status:503}));await b.context.loadUnlocks();b.context.renderUnlocks(7);
  assert.match(b.element('unlockRows').innerHTML,/temporarily unavailable/);assert.match(b.element('#unlocks .note').textContent,/unavailable/);
});
test('logo values are escaped and non-HTTPS URLs rejected',()=>{
  const b=browser(()=>{});
  assert.ok(!b.context.tokenIcon('<bad>','javascript:alert(1)').includes('<bad>'));
  assert.match(b.context.tokenIcon('TIA','https://example.test/a"b'),/https:/);
  assert.ok(!b.context.tokenIcon('TIA','https://example.test/a').includes('onerror='));
});
test('upcoming token suppresses stale legacy Arc market price and quote-token displays',()=>{
  assert.doesNotMatch(html,/id="arcyLivePrice"|id="arcyLiveVolume"|id="arcyLiveLiquidity"/);
  assert.doesNotMatch(html,/async function loadArcPrices\(/);
});
test('upcoming token does not silently infer market data from unrelated chains',()=>{
  const b=browser(async()=>{throw Error('legacy market request must not be made')});
  assert.equal(typeof b.context.loadArcPrices,'undefined');
  assert.match(html,/DETAILS TO BE ANNOUNCED/);
});
test('ambiguous symbol logos are not assigned to an unrelated token',async()=>{
  const c=api('api/unlocks.js',async()=>({ok:true,json:async()=>({data:{ABC:[{name:'Wrong one',logo:'one'},{name:'Wrong two',logo:'two'}]}})}));
  assert.equal(Object.keys(await c.fetchCmcLogos([{symbol:'ABC',name:'Actual token'}])).length,0);
});

class CalendarFixtureDate extends Date {constructor(...args){super(...(args.length?args:['2026-10-01T12:00:00Z']));}static now(){return Date.parse('2026-10-01T12:00:00Z');}}
test('all three calendar sorts contribute unique events without duplicates',async()=>{
  const c=api('api/unlocks.js',async url=>url.includes('coinbell')?{ok:true,text:async()=>row('01 Oct 2026')+(url.includes('impact')?row('02 Oct 2026','ALPHA'):url.includes('value')?row('03 Oct 2026','GRASS'):'')}:{ok:false},CalendarFixtureDate);
  const r=response();await c.handler({},r);assert.equal(r.code,200);assert.equal(r.body.events.length,3);assert.equal(r.body.coverage.sources.length,3);assert.equal(r.body.coverage.complete,false);
});
test('one unavailable sort does not break healthy calendar results',async()=>{
  const c=api('api/unlocks.js',async url=>url.includes('impact')?{ok:false}:url.includes('coinbell')?{ok:true,text:async()=>row('01 Oct 2026')}:{ok:false},CalendarFixtureDate);
  const r=response();await c.handler({},r);assert.equal(r.code,200);assert.equal(r.body.events.length,1);assert.equal(r.body.partial,true);assert.equal(r.headers['Cache-Control'],'no-store');
});
test('conflicting amounts are withheld; distinct allocations and names survive',()=>{
  const c=api('api/unlocks.js',()=>{}),a=c.parseRows(row('01 Oct 2026'))[0];
  const result=c.mergeEvents([a,{...a,amount:'20K TIA'},{...a,allocation:'Team'},{...a,name:'Another project'}]);
  assert.equal(result.conflicts.length,1);assert.equal(result.events.length,2);
});
test('unreviewed IO, PLUME, legacy OM and MANTRA records are not published',()=>{
  const c=api('api/unlocks.js',()=>{});const rows=['IO','PLUME','OM','MANTRA'].flatMap(s=>c.parseRows(row('01 Oct 2026',s)));assert.equal(c.mergeEvents(rows).events.length,0);
});
function proof(overrides={}) {
  return {projectId:'fixture-project',tokenVersion:'native-v1',name:'Fixture project',symbol:'FIX',date:'2026-10-11',amountTokens:'1000',allocation:'Investors',sourceUrl:'https://official.example/schedule',allowedHost:'official.example',publishedDateText:'11 October 2026',publishedAmountText:'1,000',evidenceText:'Investors unlock 1,000 FIX on 11 October 2026.',reviewedAt:new Date(Date.now()-1000).toISOString(),reviewExpiresAt:new Date(Date.now()+86400000).toISOString(),...overrides};
}
test('official supplements require explicit live evidence and retain provenance',async()=>{
  const p=proof(),c=api('api/unlocks.js',async()=>({ok:true,text:async()=>p.evidenceText}));const result=await c.collectVerifiedEvents([p]);assert.equal(result.events.length,1);assert.equal(result.events[0].amount,'1000 FIX');assert.equal(result.events[0].verification,'project-confirmed');assert.equal(result.events[0].percent,'');
});
test('changed, expired, mismatched and redirected supplemental proof fails closed',async()=>{
  const c=api('api/unlocks.js',async()=>({ok:true,url:'https://unrelated.example',text:async()=>proof().evidenceText}));
  const records=[proof(),proof({reviewExpiresAt:'2020-01-01T00:00:00Z'}),proof({amountTokens:'999'}),proof({date:'2026-10-12'})];
  const result=await c.collectVerifiedEvents(records);assert.equal(result.events.length,0);assert.equal(result.rejected.length,4);
  const changed=api('api/unlocks.js',async()=>({ok:true,text:async()=> 'The original schedule has been revised.'}));assert.equal((await changed.collectVerifiedEvents([proof()])).events.length,0);
});
test('source percentage disagreements are hidden instead of arbitrarily selected',()=>{
  const c=api('api/unlocks.js',()=>{}),a=c.parseRows(row('01 Oct 2026'))[0];assert.equal(c.mergeEvents([a,{...a,percent:'1%'}]).events[0].percent,'');
});
