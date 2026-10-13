'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fallback=require('../lib/pulse-display-fallback');
const pulse=require('../api/pulse');
const client=require('../lib/pulse-client');
const edition=require('../lib/pulse-edition');
const stocks=require('../search/server/lib/robinhood-assets');
const logos=require('../search/server/lib/search-logo');
const identities=require('../search/server/lib/token-identity');
const fs=require('node:fs');
const A='0x322f0929c4625ed5bad873c95208d54e1c003b2d';
function response(){return {code:200,setHeader(){return this},status(n){this.code=n;return this},json(x){this.body=x;return x}}}
test('three distinct Pulse source panels plus ARCY Take never present archived headlines as current',()=>{
 const v=fallback.fallback(Date.parse('2026-10-13T10:00:00Z'));
 assert.equal(v.ok,true);assert.equal(v.status,'source_pending');
 assert.equal(v.cards.length,3);assert.deepEqual(v.cards.map(x=>x.kind),fallback.KINDS);
 assert.equal(v.generatedAt,null);assert.equal(v.audit.currentWeekVerified,false);
 assert.ok(v.cards.every(x=>x.verifiedCurrentWeek===false&&x.publishedAt===null));
 assert.ok(v.cards.every(x=>x.url==='#unlocks'||x.url.startsWith('https://')));
 assert.match(v.take,/(verify|usage|unlock)/i);
});
test('public Pulse GET presents dated verified edition unchanged when current',async()=>{
 const latest=client.latest,audit=client.audit;
 const now=Date.now(),week=edition.cycle(now);
 const signed={number:edition.number(now),status:'updated',generatedAt:new Date(now).toISOString(),
   cycle:{start:new Date(week.start).toISOString(),end:new Date(week.end).toISOString()},
   cards:[{kind:'week',title:'Verified test fixture',summary:'A dated and source-backed official Arc update.',url:'https://www.arc.io/blog',publishedAt:new Date(now).toISOString()}],take:'Example',sources:[]};
 try{
  client.latest=async()=>signed;client.audit=async()=>null;
  const res=response();await pulse({method:'GET',query:{},headers:{}},res);
  assert.equal(res.code,200);assert.equal(res.body.status,'updated');
  assert.equal(res.body.cards[0].title,'Verified test fixture');
 }finally{client.latest=latest;client.audit=audit}
});
test('three Pulse slots preserve dated exact-cycle stories without reusing quiet or invalid items',()=>{
 const today=Date.now(),week=edition.cycle(today),cycle={
  start:new Date(week.start).toISOString(),end:new Date(week.end).toISOString()};
 const when=new Date(week.start+3_600_000).toISOString();
 const original=[
  {kind:'week',title:'Verified week development',summary:'Dated official event',publishedAt:when,url:'https://www.arc.io/blog/dated'},
  {kind:'new',title:'Verified new development',summary:'Source-backed',publishedAt:when,url:'https://community.arc.io/public/blogs/dated'},
  {kind:'watch',title:'Duplicate project source',summary:'Duplicate URL',publishedAt:when,url:'https://community.arc.io/public/blogs/dated'},
  {kind:'unlock',title:'Actual documented unlock risk',summary:'Original schedule',publishedAt:when,url:'https://www.arc.io/blog/verified-risk'}
 ];
 const result=pulse.threeSections(original,{status:'updated',cycle});
 assert.equal(result.length,3);
 assert.deepEqual(result.map(x=>x.kind),fallback.KINDS);
 assert.deepEqual(result.map(x=>x.verifiedCurrentWeek),[true,true,true]);
 assert.equal(result[0].title,original[0].title);
 assert.equal(result[1].title,original[1].title);
 assert.equal(result[2].title,original[3].title);
 const quiet=pulse.threeSections(original,{status:'quiet_week',cycle});
 assert.equal(quiet.length,3);
 assert.ok(quiet.every(x=>x.verifiedCurrentWeek===false&&x.contentType==='SOURCE_GUIDE'));
 const missing=pulse.threeSections([{kind:'week',title:'Unsupported',summary:''}],{status:'updated',cycle});
 assert.equal(missing.length,3);
 assert.notEqual(missing[0].title,'Unsupported');
});
test('stale signed Pulse is not relabeled as the current weekly headline',async()=>{
 const old=client.latest;
 const oldEdition={number:3,status:'updated',generatedAt:'2026-10-06T10:00:00.000Z',
  cycle:{start:'2026-10-05T00:00:00.000Z'},cards:[{kind:'week',title:'Old event'}]};
 try{
  client.latest=async()=>oldEdition;
  const res=response();await pulse({method:'GET',query:{},headers:{}},res);
  assert.equal(res.code,200);assert.equal(res.body.status,'source_pending');
  assert.equal(res.body.cards.length,3);
  assert.equal(res.body.audit.lastSuccessful.number,3);
  assert.ok(res.body.cards.every(x=>x.title!=='Old event'));
 }finally{client.latest=old}
});
test('provider failure yields three truthful Pulse slots and never 503 with empty cards',async()=>{
 const old=client.latest,orig=edition.generate;
 try{
  client.latest=async()=>null;
  edition.generate=async()=>{throw Object.assign(Error('No current source'),{code:'PULSE_DISCOVERY_UNAVAILABLE'})};
  const res=response();await pulse({method:'GET',query:{},headers:{}},res);
  assert.equal(res.code,200);assert.equal(res.body.ok,true);
  assert.equal(res.body.cards.length,3);
  assert.equal(res.body.audit.reasonCode,'PULSE_DISCOVERY_UNAVAILABLE');
 }finally{client.latest=old;edition.generate=orig}
});
test('official Robinhood Stock Token artwork matches signed chain-4663 registry, not symbol alone',async()=>{
 const logo='https://cdn.robinhood.com/ncw_assets/logos/'+A+'.png';
 const sample={assets:[{tokenSymbol:'TSLA',tokenName:'Tesla Stock Token',
  logoUrl:logo,deployments:[{chainId:4663,contractAddress:A},
   {chainId:1,contractAddress:'0x'+'b'.repeat(40)}]}]};
 const rows=stocks.parseAssets(sample);
 assert.equal(rows.length,1);assert.equal(rows[0].logoUrl,logo);
 assert.equal(stocks.registryLogo('https://evil.example/logos/'+A+'.png'),null);
 assert.equal(stocks.registryLogo('https://cdn.robinhood.com/ncw_assets/logos/random.png'),null);
 assert.equal(stocks.registryLogo('https://cdn.robinhood.com/ncw_assets/logos/'+A+'.svg'),null);
 const ranked=identities.rank('robinhood','TSLA',rows.map(x=>({...x,network:'robinhood'})));
 const ok=ranked.find(x=>x.address===A);
 assert.equal(ok.identity.status,'REGISTRY_MATCHED');
 assert.equal(ok.logoUrl,logo);
 const shown=await logos.enhance('robinhood',ranked);
 assert.equal(shown.find(x=>x.address===A).logoUrl,logo);
 const fake=await logos.enhance('robinhood',[{...rows[0],network:'robinhood',
   registryMatched:false,logoUrl:logo}]);
 assert.equal(fake[0].logoUrl,null);
 const eth=await logos.enhance('ethereum',[{...rows[0],network:'ethereum',logoUrl:logo}]);
 assert.equal(eth[0].logoUrl,null);
});
test('landing page has no empty Arc chain mark and Pulse guarantees a three-card source-led backup',()=>{
 const home=fs.readFileSync(require.resolve('../search-upgrade.js'),'utf8');
 assert.match(home,/arc:'<img src=/);
 assert.match(home,/setMark\(badge,id\);badge\.hidden=false/);
 assert.match(home,/const kinds=\[/);
 assert.match(home,/MutationObserver\(renderFallback\)/);
 assert.match(home,/officialStockArt/);
});
