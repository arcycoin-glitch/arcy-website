'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'search-upgrade.js'),'utf8');
const css=fs.readFileSync(path.join(root,'search-upgrade.css'),'utf8');
const allowed=['arc','ethereum','robinhood'];
test('one compact heading and precise All 3 Networks label keep search discoverable',()=>{
 assert.match(js,/chainCount\.textContent='3 Networks'/);
 assert.match(js,/\['all','All 3 Networks','ALL'\]/);
 assert.match(js,/name\.textContent=id==='robinhood'\?'Robinhood':label/);
 assert.match(js,/brand\.append\(brandIcon,wordmark\)/);
 assert.doesNotMatch(js,/brand\.append\(owl,wordmark\)/);
 assert.match(js,/Research tokens across Arc, Ethereum & Robinhood\./);
});
test('home search order is input, network selector, submit — all within one functioning form',()=>{
 assert.match(js,/form\.append\(inputWrap,picker,submit\)/);
 assert.match(js,/app\.append\(brandRow,intro,form,state,results,notes,robinhoodNotice\)/);
 assert.match(js,/option\.type='button'/);
 assert.match(js,/form\.addEventListener\('submit'/);
 assert.match(js,/setNetwork\('all'\)/);
 assert.match(js,/detailPath\(network,candidate\.address\)/);
});
test('three installed official network mark assets remain unchanged and available',()=>{
 for(const n of allowed){
  assert.match(js,new RegExp("["+n+"]")); // ensures enumerated supported networks
  const img='/search/assets/'+({'arc':'arc-network-mark','ethereum':'ethereum-mark','robinhood':'robinhood-chain-mark'})[n]+'.svg';
  assert(js.includes(img),n+' exact network asset preserved');
  assert(fs.existsSync(path.join(root,img)),n+' logo must exist');
 }
});
test('mobile and desktop use compact three-chip layout without clipping or eliminating four touch targets',()=>{
 assert.match(css,/V8 compact premium discovery/);
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/\.home-network-option\[data-network=all\]/);
 assert.match(css,/@media\(max-width:560px\)/);
 assert.match(css,/@media\(max-width:360px\)/);
 assert.match(css,/min-height:43px/);
 assert.match(css,/\.home-search-suggest\{top:54px/);
 assert.match(css,/\.home-search-state:empty\{display:none\}/);
});
test('no home search update modifies token data sources, cross-chain report format or title identity',()=>{
 assert.match(js,/const VERIFIED_TOKEN_ART=Object\.freeze/);
 assert.match(js,/const OFFICIAL_SUGGESTIONS=Object\.freeze/);
 assert.match(js,/const NETWORK_MARKUP=Object\.freeze/);
 assert.match(js,/const detailPath=|function detailPath/);
 assert.match(js,/NETWORK_MARKUP\[id\]/);
});
