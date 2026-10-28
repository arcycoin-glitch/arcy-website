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
const artwork=require('./helpers/logo-artwork.cjs');
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
// Hermetic: the current-cycle review is stubbed, never a live network call, and
// the per-instance transient cache is reset so scenarios cannot leak.
test('stale signed Pulse is not relabeled as the current weekly headline',async()=>{
 const old=client.latest,orig=edition.generate;
 const oldEdition={number:3,status:'updated',generatedAt:'2026-10-06T10:00:00.000Z',
  cycle:{start:'2026-10-05T00:00:00.000Z'},cards:[{kind:'week',title:'Old event'}]};
 try{
  pulse.resetTransientCache();
  client.latest=async()=>oldEdition;
  edition.generate=async()=>{throw Object.assign(Error('No current source'),{code:'PULSE_DISCOVERY_UNAVAILABLE'})};
  const res=response();await pulse({method:'GET',query:{},headers:{}},res);
  assert.equal(res.code,200);assert.equal(res.body.status,'source_pending');
  assert.equal(res.body.cards.length,3);
  assert.equal(res.body.audit.lastSuccessful.number,3,'the last signed edition stays visible as provenance');
  assert.ok(res.body.cards.every(x=>x.title!=='Old event'));
  assert.ok(res.body.cards.every(x=>x.verifiedCurrentWeek===false&&x.contentType==='SOURCE_GUIDE'));
 }finally{client.latest=old;edition.generate=orig;pulse.resetTransientCache()}
});
test('stale signed Pulse with fresh verified current-cycle research shows only the current cycle',async()=>{
 const old=client.latest,orig=edition.generate,period=edition.cycle(),start=new Date(period.start).toISOString(),end=new Date(period.end).toISOString();
 const oldEdition={number:3,status:'updated',generatedAt:'2026-10-06T10:00:00.000Z',cycle:{start:'2026-10-05T00:00:00.000Z'},cards:[{kind:'week',title:'Old event'}]};
 const fresh={number:edition.number(),status:'updated',generatedAt:new Date().toISOString(),cycle:{start,end},trigger:'transient',
  cards:[{kind:'week',owner:'OFFICIAL ARC',title:'Current verified Arc development',summary:'Dated first-party report.',url:'https://www.arc.io/blog/current',publishedAt:start,verifiedCurrentWeek:true}],take:'Current take',sources:[],audit:{}};
 try{
  pulse.resetTransientCache();
  client.latest=async()=>oldEdition;edition.generate=async()=>fresh;
  const res=response();await pulse({method:'GET',query:{},headers:{}},res);
  assert.equal(res.body.status,'updated');assert.equal(res.body.number,edition.number());assert.notEqual(res.body.number,3);
  assert.equal(res.body.cycle.start,start);
  assert.ok(res.body.cards.every(x=>x.title!=='Old event'),'the archived headline is never relabeled as current');
  assert.equal(res.body.cards.filter(x=>x.verifiedCurrentWeek===true).length,1);
  assert.equal(res.body.cards.length,3);
 }finally{client.latest=old;edition.generate=orig;pulse.resetTransientCache()}
});
test('provider failure yields three truthful Pulse slots and never 503 with empty cards',async()=>{
 const old=client.latest,orig=edition.generate;
 try{
  pulse.resetTransientCache();
  client.latest=async()=>null;
  edition.generate=async()=>{throw Object.assign(Error('No current source'),{code:'PULSE_DISCOVERY_UNAVAILABLE'})};
  const res=response();await pulse({method:'GET',query:{},headers:{}},res);
  assert.equal(res.code,200);assert.equal(res.body.ok,true);
  assert.equal(res.body.cards.length,3);
  assert.equal(res.body.audit.reasonCode,'PULSE_DISCOVERY_UNAVAILABLE');
  assert.ok(res.body.cards.every(x=>x.verifiedCurrentWeek===false&&x.contentType==='SOURCE_GUIDE'),'guides are never presented as news');
 }finally{client.latest=old;edition.generate=orig;pulse.resetTransientCache()}
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
 let imageReads=0;
 const fetchImpl=async(url,options)=>{
  if(url===logo){imageReads++;assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');return artwork.response();}
  assert.equal(url,'https://api.dexscreener.com/tokens/v1/robinhood/'+A);
  return Response.json([]); // Unmatched token art stays unavailable; no network use.
 };
 const shown=await logos.enhance('robinhood',ranked,{fetchImpl});
 assert.equal(shown.find(x=>x.address===A).logoUrl,logo);
 assert.equal(imageReads,1);
 const fake=await logos.enhance('robinhood',[{...rows[0],network:'robinhood',
   registryMatched:false,logoUrl:logo}],{fetchImpl});
 assert.equal(fake[0].logoUrl,null);
 const eth=await logos.enhance('ethereum',[{...rows[0],network:'ethereum',logoUrl:logo}],{fetchImpl});
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

test('official local token marks are mapped by exact chain and contract, never ticker alone',()=>{
 const arcUsdc='0x3600000000000000000000000000000000000000';
 const ethUsdc='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
 assert.equal(logos.localLogo('arc',arcUsdc),'/search/assets/token-icons/usdc.svg');
 assert.equal(logos.localLogo('ethereum',ethUsdc),'/search/assets/token-icons/usdc.svg');
 assert.equal(logos.localLogo('arc',ethUsdc),null);
 assert.equal(logos.localLogo('ethereum','0x'+'a'.repeat(40)),null);
 assert.equal(logos.localLogo('arc','0xece5ca8bf9220718e5727754026757512212cb3c'),null);
});
test('playing owl video is visible without doubling the still image or square matte',()=>{
 const css=fs.readFileSync(require.resolve('../hero-video.css'),'utf8');
 const js=fs.readFileSync(require.resolve('../hero-video.js'),'utf8');
 assert.match(css,/#hero \.hero-flight\.video-playing \.hero-video\{opacity:1;mix-blend-mode:screen\}/);
 assert.match(css,/#hero \.hero-flight\.video-playing>img\{opacity:0;visibility:visible\}/);
 assert.match(css,/border-radius:50%/);
 assert.match(css,/mask-image:radial-gradient\(ellipse 49% 49%/);
 assert.match(css,/#hero \.hero-flight:not\(\.video-playing\)>img\{opacity:1;visibility:visible\}/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 // Behaviour, not source text: run hero-video.js against a minimal DOM and
 // prove the still image is hidden ONLY while the video is actually playing.
 const vm=require('node:vm');
 const listeners=(o)=>{o.handlers={};o.addEventListener=(t,f)=>{(o.handlers[t]=o.handlers[t]||[]).push(f)};o.fire=t=>(o.handlers[t]||[]).forEach(f=>f());return o;};
 const classes=new Set(),frame={classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},appendChild(){}};
 let plays=0,pauses=0;
 const video=listeners({dataset:{src:'/owl.mp4'},getAttribute:()=>null,setAttribute(){},removeAttribute(){},load(){},closest:()=>frame,
  play(){plays++;return Promise.resolve()},pause(){pauses++;this.fire('pause')}});
 const media=listeners({matches:false});
 const doc=listeners({hidden:false,querySelector:q=>q==='#hero .hero-video'?video:null,createElement:()=>({hidden:false,setAttribute(){},addEventListener(){}})});
 const win=listeners({matchMedia:()=>media});
 vm.runInNewContext(js,{document:doc,window:win,navigator:{},setTimeout:()=>0,clearTimeout(){}});
 assert.equal(plays,1,'the owl starts when visible');
 assert.equal(frame.classList.contains('video-playing'),false,'still image remains until the first frame plays');
 video.fire('playing');assert.equal(frame.classList.contains('video-playing'),true,'playing hides the still image (no double owl)');
 video.fire('stalled');assert.equal(frame.classList.contains('video-playing'),true,'a stall during playback does not flash the still image');
 video.fire('pause');assert.equal(frame.classList.contains('video-playing'),false,'pause restores the still image');
 video.fire('playing');video.fire('ended');assert.equal(frame.classList.contains('video-playing'),false,'end restores the still image');
 video.fire('playing');video.fire('error');assert.equal(frame.classList.contains('video-playing'),false,'an error restores the still image');
 media.matches=true;video.fire('playing');assert.equal(frame.classList.contains('video-playing'),false,'reduced motion never shows the moving owl');
});

/* Site-chrome GitHub appears only as the footer social icon; sources are retained. */
test('GitHub site navigation is deduplicated to one footer icon',()=>{
 const home=fs.readFileSync(require.resolve('../search-upgrade.js'),'utf8');
 const css=fs.readFileSync(require.resolve('../search-upgrade.css'),'utf8');
 const detail=fs.readFileSync(require.resolve('../search/index.html'),'utf8');
 assert.match(home,/const footerGitHub=footerSocial\?\.querySelector/);
 assert.match(home,/footerGitHub\.setAttribute\('aria-label','GitHub'\)/);
 assert.match(home,/if\(link!==footerGitHub\)link\.remove\(\)/);
 assert.match(css,/\.nav #siteLinks > a\.nav-github\{display:none!important\}/);
 assert.doesNotMatch(detail,/class="detail-github"/);
});
