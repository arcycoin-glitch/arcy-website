'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const robots=read('robots.txt'),map=read('sitemap.xml'),home=read('index.html'),trans=read('transparency.html');
const jsonLd=html=>[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(x=>JSON.parse(x[1]));
test('robots.txt explicitly links to crawlable canonical sitemap and does not block verified pages',()=>{
 assert.match(robots,/User-agent: \*/);
 assert.match(robots,/Allow: \//);
 assert.match(robots,/Sitemap: https:\/\/www\.arcyusdc\.xyz\/sitemap\.xml/);
 assert.doesNotMatch(robots,/Disallow:\s*\//);
});
test('sitemap contains all four canonical public pages, not redirected, private or dynamic API URLs',()=>{
 const locations=[...map.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x=>x[1]);
 assert.match(map,/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
 assert.deepEqual(locations,['https://www.arcyusdc.xyz/','https://www.arcyusdc.xyz/transparency.html','https://www.arcyusdc.xyz/arcy-coin.html','https://www.arcyusdc.xyz/arcy-analiz.html']);
 assert.equal(new Set(locations).size,locations.length);
 assert.doesNotMatch(map,/\/api\/|\/search\/token\/|\/#search/);
});
test('homepage gives Google one preferred site name and canonical URL',()=>{
 assert.match(home,/<link rel="canonical" href="https:\/\/www\.arcyusdc\.xyz\/">/);
 assert.match(home,/<meta name="robots" content="index,follow,max-image-preview:large">/);
 const entries=jsonLd(home).filter(e=>e['@type']==='WebSite');
 assert.equal(entries.length,1);
 assert.equal(entries[0].name,'ARCY SEARCH');
 assert.equal(entries[0].url,'https://www.arcyusdc.xyz/');
 assert.equal(entries[0].hasPart.url,'https://www.arcyusdc.xyz/transparency.html');
});
test('homepage describes 3 real supported networks and links only grounded current channels',()=>{
 const site=jsonLd(home).find(e=>e['@type']==='WebSite');
 assert.match(site.description,/Arc, Ethereum and Robinhood Chain/);
 assert.deepEqual(site.sameAs,[
 'https://github.com/arcycoin-glitch/arcy-website',
 'https://x.com/ARCYResearch',
 'https://t.me/arcycommunitychat'
 ]);
 assert.match(home,/<meta property="og:site_name" content="ARCY SEARCH">/);
 assert.match(home,/<meta property="og:url" content="https:\/\/www\.arcyusdc\.xyz\/">/);
 assert.doesNotMatch(home.slice(0,home.indexOf('<style>')),/community-driven meme on Arc/i);
});
test('Transparency explains evidence without advertising former Arc token as upcoming token',()=>{
 assert.match(trans,/<link rel="canonical" href="https:\/\/www\.arcyusdc\.xyz\/transparency\.html">/);
 const page=jsonLd(trans).find(e=>e['@type']==='WebPage');
 assert.equal(page.isPartOf['@id'],'https://www.arcyusdc.xyz/#website');
 assert.match(trans,/Upcoming token details/);
 assert.match(trans,/previous Arc token is a separate existing asset/);
 assert.doesNotMatch(trans,/Check ARCY's published Arc contract/);
});
test('SEO modifications do not restore legacy token market data or bypass data-licensing controls',()=>{
 assert.match(home,/DETAILS TO BE ANNOUNCED/);
 assert.doesNotMatch(home,/async function loadBurn\(/);
 assert.doesNotMatch(home,/async function loadArcPrices\(/);
 assert.match(home,/<a href="\/transparency\.html">Verify<\/a>/);
 assert.match(trans,/Radar's public ranked feed is disabled until/);
 assert.doesNotMatch(home,/https:\/\/x\.com\/Arcy_usdc/);
});
