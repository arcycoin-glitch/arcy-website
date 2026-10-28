'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const pulse=require('../lib/pulse-networks');
const now=Date.parse('2026-10-28T19:00:00Z');
const PAGE='<html><head><title>Ripple and Robinhood Partner to Power the Next Generation of Finance | Ripple</title></head><body><h1>Press Releases</h1><h2>Ripple and Robinhood Partner to Power the Next Generation of Finance</h2><p>Oct 27, 2026</p><p>RLUSD is live today on Robinhood Chain and Bitstamp by Robinhood.</p></body></html>';
const LIST='<a href="/ripple-press/ripple-and-robinhood-partner-to-power-the-next-generation-of-finance/">Press Releases</a>';
const ok=body=>({ok:true,status:200,headers:{get:()=>null},text:async()=>body});
const failed=status=>({ok:false,status,headers:{get:()=>null},text:async()=>''});
test('Pulse display uses dated official Robinhood partner news even if investor relations 403s; signed source inventory remains 2',async()=>{
 const fetcher=async url=>{
  if(url.includes('api.github.com'))return ok('[]');
  if(url.includes('blog.ethereum.org'))return ok('<rss version="2.0"><channel></channel></rss>');
  if(url==='https://ripple.com/press-releases/')return ok(LIST);
  if(url.includes('/ripple-press/'))return ok(PAGE);
  if(url.includes('investors.robinhood.com'))return failed(403);
  if(url.includes('robinhood.com/newsroom'))return ok('<script id="__NEXT_DATA__">{"props":{"pageProps":{"articlesCollection":{"items":[]}}}}</script>');
  if(url.includes('docs.robinhood.com'))return ok('Robinhood Chain 4663 rpc.mainnet.chain.robinhood.com');
  throw Error('unexpected test URL: '+url);
 };
 const value=await pulse.generate({chain:'robinhood',now,fetcher,allowPartial:true,recentWindow:true,sourceTimeoutMs:500});
 assert.equal(value.status,'partial_source_coverage');assert.equal(value.complete,false);
 assert.equal(value.cards.length,3);
 assert.equal(value.cards[0].title,'Ripple and Robinhood Partner to Power the Next Generation of Finance');
 assert.equal(value.cards[0].publishedAt,'2026-10-27T00:00:00.000Z');
 assert.equal(value.cards[0].url,'https://ripple.com/ripple-press/ripple-and-robinhood-partner-to-power-the-next-generation-of-finance/');
 assert.equal(value.cards[0].contentType,'VERIFIED_DEVELOPMENT');
 assert.equal(value.cards[1].contentType,'SOURCE_GUIDE');
 assert.equal(value.cards[1].url,'https://docs.robinhood.com/chain/notices-and-upgrades/');
 assert.equal(value.cards[2].contentType,'SOURCE_GUIDE');
 assert.equal(value.cards[2].url,'https://robinhoodchain.blockscout.com/');
 assert.equal(value.cards[1].publishedAt,null);
 assert.equal(value.audit.sourcesAttempted,4);
 assert.equal(pulse.CONFIG.robinhood.sources.length,2);
 assert.equal(value.audit.sourceFailures.length,1);
});
test('No chain claim or future date cannot produce partner news',()=>{
 const source={url:'https://ripple.com/press-releases/',host:'ripple.com',type:'partner'};
 const link={url:'https://ripple.com/ripple-press/ripple-and-robinhood-partner-to-power-the-next-generation-of-finance/',label:'Press Releases'};
 assert.equal(pulse.partnerArticle(PAGE.replace('Robinhood Chain','the chain'),link,source),null);
 assert.equal(pulse.partnerArticle(PAGE.replace('Oct 27, 2026','Oct 27, 2027'),link,source)?.publishedAt,'2027-10-27T00:00:00.000Z');
 const cycle=pulse.windowFor(now);assert.ok(pulse.select([{item:{...pulse.partnerArticle(PAGE.replace('Oct 27, 2026','Oct 27, 2027'),link,source)},source}],{...cycle,end:'2026-11-02T00:00:00.000Z'},now).items.length===0);
});

test('An outage never fills empty Robinhood cards with duplicate source-failure notices',async()=>{
 const value=await pulse.generate({chain:'robinhood',now,
  fetcher:async()=>failed(403),allowPartial:true,recentWindow:true,sourceTimeoutMs:250});
 assert.equal(value.cards.length,3);
 assert.deepEqual(value.cards.map(x=>x.contentType),['SOURCE_GUIDE','SOURCE_GUIDE','SOURCE_GUIDE']);
 assert.equal(new Set(value.cards.map(x=>x.url)).size,3);
 assert.equal(new Set(value.cards.map(x=>x.title)).size,3);
 assert.ok(value.cards.every(x=>x.url.startsWith('https://')&&!x.publishedAt));
 assert.ok(value.cards.every(x=>!/source coverage incomplete|source unavailable/i.test(x.title)));
 assert.equal(value.complete,false);
 assert.equal(value.audit.sourcesSuccessfullyChecked,0);
});
test('Ethereum includes dated official reports from rolling 28-day window and useful guides for spare slots',async()=>{
 const post='<item><title>Protocol client coordination update</title><link>https://blog.ethereum.org/en/2026/10/10/coordination</link><pubDate>Sat, 10 Oct 2026 09:00:00 GMT</pubDate><description>Ethereum client teams published an update on testnet coordination and operator readiness.</description></item>';
 const value=await pulse.generate({chain:'ethereum',now,
  fetcher:async url=>ok(url.includes('feed.xml')?'<rss version="2.0"><channel>'+post+'</channel></rss>':'[]'),
  allowPartial:true,recentWindow:true,sourceTimeoutMs:250});
 assert.equal(value.cards.length,3);
 assert.equal(value.cards[0].title,'Protocol client coordination update');
 assert.equal(value.cards[0].contentType,'VERIFIED_DEVELOPMENT');
 assert.equal(value.cards[1].contentType,'SOURCE_GUIDE');
 assert.equal(value.cards[2].contentType,'SOURCE_GUIDE');
 assert.equal(value.cards[1].publishedAt,null);
 assert.ok(Date.parse(value.cycle.start)<=Date.parse('2026-10-10T09:00:00Z'));
 assert.ok(Date.parse(value.cycle.end)<=now);
});
test('Signed publication inventory and strict weekly review remain unchanged',()=>{
 assert.equal(pulse.CONFIG.ethereum.sources.length,2);
 assert.equal(pulse.CONFIG.robinhood.sources.length,2);
 const cards=pulse.discoveryCards('ethereum');
 assert.equal(cards.length,3);
 assert.equal(cards.every(x=>x.verifiedCurrentWeek===false&&x.contentType==='SOURCE_GUIDE'),true);
});
