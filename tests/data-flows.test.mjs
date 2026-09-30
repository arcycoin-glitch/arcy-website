import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
function api(file, fetch, date = Date) {
  const context = vm.createContext({fetch, Date: date, URL, URLSearchParams, process, AbortSignal});
  vm.runInContext(fs.readFileSync(new URL(file, root), 'utf8').replace('export default async function handler', 'async function handler'), context);
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
  const context = vm.createContext({fetch,document,URL,AbortSignal,Intl,console});
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
test('Burn reads actual decimals; supply failure cannot overwrite burn success',async()=>{
  const b=browser(async(_,options)=>{const data=JSON.parse(options.body).params[0].data;
    if(data==='0x18160ddd')throw Error('supply offline');
    return {ok:true,json:async()=>({result:data==='0x313ce567'?'0x06':'0x'+(3570000n*1000000n).toString(16)})};
  });await b.context.loadBurn();assert.equal(b.element('supply').textContent,'—');assert.equal(b.element('burned').textContent,'3.57M');assert.match(b.element('burnStatus').textContent,/^Live/);
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
