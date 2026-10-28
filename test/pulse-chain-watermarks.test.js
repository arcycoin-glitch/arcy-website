'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('Pulse Arc and Robinhood watermarks reuse bundled chain identity assets',()=>{
 const js=read('v8-premium.js'),css=read('v8-premium.css'),html=read('index.html');
 for(const [chain,asset,klass] of [
  ['arc','arc-network-mark.svg','v8-arc-card-art'],
  ['robinhood','robinhood-chain-mark.svg','v8-robinhood-card-art']
 ]){
  assert.match(js,new RegExp("'"+chain+"','"+asset+"','"+klass+"'"));
  assert.ok(fs.existsSync(path.join(root,'search/assets',asset)));
  assert.match(css,new RegExp('#pulse \\.'+klass.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 }
 assert.match(js,/image\.alt=''/);
 assert.match(js,/image\.setAttribute\('aria-hidden','true'\)/);
 assert.match(js,/if\(card\.querySelector\('\.'\+cls\)\)continue/);
 assert.match(js,/function localizeCategories\(\)\{ensureChainCardArt\(\)/);
 assert.match(js,/new MutationObserver\(localizeCategories\)/);
 assert.match(js,/v8-eth-card-art/);
 assert.match(css,/opacity:\.2;pointer-events:none/);
 assert.match(html,/src="\/v8-premium\.js"/);
 assert.match(html,/href="\/v8-premium\.css"/);
});
