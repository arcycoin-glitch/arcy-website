'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const home=fs.readFileSync('index.html','utf8'),coin=fs.readFileSync('arcy-coin.html','utf8'),trans=fs.readFileSync('transparency.html','utf8'),map=fs.readFileSync('sitemap.xml','utf8');
test('ARCY coin query has a canonical source page with honest token and research differentiation',()=>{
 assert.match(coin,/<title>ARCY Coin — Token Status and ARCY SEARCH Research \| ARCY<\/title>/);
 assert.match(coin,/<link rel="canonical" href="https:\/\/www\.arcyusdc\.xyz\/arcy-coin\.html">/);
 assert.match(coin,/<h1>ARCY Coin &amp; ARCY SEARCH<\/h1>/);
 assert.match(coin,/previous Arc token is a separate existing asset|earlier ARCY community token existed on Arc/);
 assert.match(coin,/No automatic migration/);
 assert.match(coin,/contract address, chain-specific launch information/);
 assert.match(coin,/Arc, Ethereum and Robinhood Chain/);
});
test('Coin status page has verified outgoing evidence and does not impersonate a launch announcement',()=>{
 assert.match(coin,/href="\/transparency\.html"/);
 assert.match(coin,/href="https:\/\/github\.com\/arcycoin-glitch\/arcy-website"/);
 assert.match(coin,/href="https:\/\/x\.com\/ARCYResearch"/);
 assert.match(coin,/href="https:\/\/t\.me\/arcycommunitychat"/);
 assert.doesNotMatch(coin,/0x73e5F588d27d6B5EC89C89c82692D1E7fECBd38b/);
 assert.doesNotMatch(coin,/guaranteed profits|guaranteed launch|already trading|audited and safe/i);
 const start=coin.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/);
 assert.ok(start);
 const schema=JSON.parse(start[1]);
 assert.equal(schema['@type'],'WebPage');
 assert.equal(schema.isPartOf['@id'],'https://www.arcyusdc.xyz/#website');
 assert.equal(schema.url,'https://www.arcyusdc.xyz/arcy-coin.html');
});
test('Main website remains ARCY SEARCH but links crawlably to truthful coin-status description',()=>{
 assert.match(home,/<title>ARCY SEARCH \| ARCY Coin Project/);
 assert.match(home,/<a class="footer-source-link" href="\/arcy-coin\.html">Token Info<\/a>/);
 assert.match(home,/DETAILS TO BE ANNOUNCED/);
 assert.match(home,/href="\/transparency\.html">Verify<\/a>/);
 assert.doesNotMatch(home,/async function loadBurn\(/);
 assert.doesNotMatch(home,/async function loadArcPrices\(/);
});
test('Updated sitemap and Transparency link the ARCY coin status page without changing research endpoints',()=>{
 assert.match(map,/<loc>https:\/\/www\.arcyusdc\.xyz\/arcy-coin\.html<\/loc>/);
 assert.match(trans,/href="\/arcy-coin\.html"/);
 assert.match(trans,/Upcoming token details/);
 assert.match(trans,/The previous Arc token is a separate existing asset/);
});
