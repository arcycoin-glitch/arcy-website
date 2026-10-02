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
  assert.equal(r.headers['Cache-Control'],'s-maxage=60, must-revalidate');
});
test('unlock upstream failure is not cached as live data',async()=>{
  const c=api('api/unlocks.js',async()=>{throw Error('offline');});const r=response();await c.handler({},r);
  assert.equal(r.code,503);assert.equal(r.body.live,false);assert.equal(r.headers['Cache-Control'],'no-store');
});
test('Pulse excludes menus and downloads and keeps long article titles',async()=>{
  const long='Circle stablecoin update '+ 'details '.repeat(25);
  const c=api('api/pulse.js',async()=>({ok:true,text:async()=>`<a href="/cpn/stablecoin-payments">Stablecoin Payments</a><a href="https://other.test/logo.zip">Download Circle logos</a><a href="/pressroom/update">${long}</a>`}));
  const items=await c.collect('https://www.circle.com/pressroom');assert.equal(items.length,1);assert.equal(items[0].title,long.trim());assert.equal(items[0].owner,'OFFICIAL CIRCLE');
});
test('Pulse deduplicates URLs and preserves fixed card categories with one story',async()=>{
  const c=api('api/pulse.js',async url=>({ok:true,text:async()=>url.includes('circle.com')?'<a href="/pressroom/update">Circle stablecoin announcement</a><a href="/pressroom/update">Circle duplicate announcement</a>':''}));
  const r=response();await c.handler({},r);assert.equal(r.body.cards.length,3);
  assert.deepEqual(Array.from(r.body.cards,c=>c.kind),['week','reality','signal']);
});
test('Pulse reports total source failure',async()=>{
  const c=api('api/pulse.js',async()=>({ok:false}));const r=response();await c.handler({},r);assert.equal(r.code,503);assert.equal(r.body.ok,false);
});
function burnResponse(request,raw=3570000n*1000000n){
 const {method,params}=JSON.parse(request.body);
 const word=n=>'0x'+n.toString(16).padStart(64,'0');
 const result=method==='eth_chainId'?'0x13b2':method==='eth_blockNumber'?'0x123':params[0].data==='0x313ce567'?word(6n):word(raw);
 return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result})};
}
test('Burn reads actual decimals; supply failure cannot overwrite burn success',async()=>{
 const b=browser(async(_,options)=>{const q=JSON.parse(options.body);if(q.params[0]?.data==='0x18160ddd')throw Error('supply offline');return burnResponse(options);});
 await b.context.loadBurn();assert.equal(b.element('supply').textContent,'—');assert.equal(b.element('burned').textContent,'3.57M');assert.match(b.element('burnStatus').textContent,/^Live/);
});
test('Burn retries primary then falls back; all contract reads share the fixed block',async()=>{
 const calls=[];const b=browser(async(url,options)=>{calls.push({url,...JSON.parse(options.body)});if(url==='https://rpc.mainnet.arc.io')return {ok:false,status:429};return burnResponse(options);});
 await b.context.loadBurn();assert.equal(calls.filter(c=>c.url==='https://rpc.mainnet.arc.io').length,2);assert.equal(b.element('burned').textContent,'3.57M');assert.ok(calls.filter(c=>c.method==='eth_call').every(c=>c.params[1]==='0x123'));
});
test('Burn rejects wrong chain and malformed ABI instead of displaying false data',async()=>{
 const b=browser(async(url,options)=>{const r=burnResponse(options);if(url.includes('quicknode'))return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result:'0x01'})};return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result:'0x1'})};});
 await b.context.loadBurn();assert.equal(b.element('burned').textContent,'10.49M');assert.match(b.element('burnStatus').textContent,/snapshot/);
});
test('Burn preserves the latest successfully verified snapshot when every source fails',async()=>{
 let offline=false;const b=browser(async(_,options)=>{if(offline)throw Error('offline');return burnResponse(options);});
 await b.context.loadBurn();offline=true;await b.context.loadBurn();assert.equal(b.element('burned').textContent,'3.57M');assert.match(b.element('burnStatus').textContent,/snapshot/);
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
test('Pulse failure replaces permanent loading card',async()=>{
  const b=browser(async()=>({ok:false,status:503}));await vm.runInContext(b.scripts.at(-1),b.context);assert.match(b.element('pulseGrid').innerHTML,/temporarily unavailable/);
});
test('market fallback never displays another chain or quote token price',async()=>{
  const b=browser(async url=>({ok:true,json:async()=>url.includes('dexscreener')?{pairs:[{chainId:'ethereum',baseToken:{address:'0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'},priceUsd:'99'}]}:{data:[]}}));
  await vm.runInContext(b.scripts[1],b.context);assert.equal(b.element('arcyLivePrice').textContent,'—');
});
test('market keeps token-level volume and fills missing liquidity independently',async()=>{
  const token='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
  const b=browser(async url=>({ok:true,json:async()=>url.includes('/pools')?{data:[]} :url.includes('dexscreener')?{pairs:[{chainId:'arc',baseToken:{address:token},priceUsd:'5',volume:{h24:1},liquidity:{usd:100}}]}:{data:{attributes:{price_usd:'2',volume_usd:{h24:1000},fdv_usd:2000}}}}));
  await vm.runInContext(b.scripts[1],b.context);assert.equal(b.element('arcyLivePrice').textContent,'$2');assert.equal(b.element('arcyLiveVolume').textContent,'$1K');assert.equal(b.element('arcyLiveLiquidity').textContent,'$100');
});
test('ambiguous symbol logos are not assigned to an unrelated token',async()=>{
  const c=api('api/unlocks.js',async()=>({ok:true,json:async()=>({data:{ABC:[{name:'Wrong one',logo:'one'},{name:'Wrong two',logo:'two'}]}})}));
  assert.equal(Object.keys(await c.fetchCmcLogos([{symbol:'ABC',name:'Actual token'}])).length,0);
});

class CalendarFixtureDate extends Date {constructor(...args){super(...(args.length?args:['2026-10-01T12:00:00Z']));}static now(){return Date.parse('2026-10-01T12:00:00Z');}}
test('all three calendar sorts contribute unique events without duplicates',async()=>{
  const c=api('api/unlocks.js',async url=>url.includes('coinbell')?{ok:true,text:async()=>row('01 Oct 2026')+(url.includes('impact')?row('02 Oct 2026','ARB'):url.includes('value')?row('03 Oct 2026','GRASS'):'')}:{ok:false},CalendarFixtureDate);
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
