'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const js=fs.readFileSync(path.join(__dirname,'../search/market-radar.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../search/market-radar.css'),'utf8');

test('Radar reference UI source is syntactically valid JavaScript',()=>{assert.doesNotThrow(()=>new Function(js));});
test('four network choices and exact chain IDs stay intact',()=>{
 assert.match(js,/\['pons','Pons Launch'\]/);
 assert.match(js,/\['arc','Arc'\]/);
 assert.match(js,/\['ethereum','Ethereum'\]/);
 assert.match(js,/\['robinhood','Robinhood'\]/);
 assert.match(js,/arc:5042,ethereum:1,robinhood:4663,pons:4663/);
});
test('single premium card is network-selected with no simultaneous token wall',()=>{
 assert.match(js,/card\.hidden=key!==id/);
 assert.match(css,/\.arcy-radar-overview-card\[hidden\]\{display:none!important\}/);
 assert.match(css,/\.arcy-radar-overview\{\s*display:grid!important;\s*grid-template-columns:minmax\(0,1fr\)!important;/);
});
test('token values only come from verified API fields',()=>{
 for(const field of ['volume24hUsd','priceUsd','change24hPct'])
  assert.ok(js.includes("fieldOk(item,'"+field+"')"),'missing verification for '+field);
 assert.match(js,/data\?\.asOf/);
 assert.match(js,/data\.freshness==='STALE'/);
});
test('logos use local verified network marks and source-host restricted token images',()=>{
 for(const src of ['arc-network-mark.svg','ethereum-mark.svg','robinhood-chain-mark.svg'])assert.ok(js.includes(src));
 assert.match(js,/logoHosts\.has\(candidate\.hostname\)/);
 assert.match(js,/logoWrap\.classList\.add\('is-placeholder'\)/);
});
test('row contains ranking, name and action to exact network/contract',()=>{
 assert.match(js,/item\.rank/);
 assert.match(js,/arcy-radar-overview-token-name/);
 assert.match(js,/TOKEN_NET\[network\]/);
 assert.match(js,/row\.append\(identity,priceLabel,change,volume,arrow\)/);
});
test('mobile structure and keyboard accessibility are provided',()=>{
 assert.match(css,/@media\(max-width:390px\)/);
 assert.match(css,/\.arcy-radar-overview-token\{/);
 assert.match(css,/:focus-visible/);
 assert.match(js,/aria-pressed/);
 assert.match(js,/aria-expanded/);
});
test('unavailable Pons launches are explicitly disclosed',()=>{
 assert.match(js,/factory ile doğrulanmış Pons lansmanı bulunamadı/);
});
