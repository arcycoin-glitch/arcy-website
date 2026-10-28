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
 assert.equal(value.cards[1].contentType,'SOURCE_STATUS');
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
