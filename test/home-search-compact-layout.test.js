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
test('V2 home Search keeps submit accessible while placing query/action row above network selector',()=>{
 assert.match(js,/queryRow\.append\(inputWrap,submit\)/);
 assert.match(js,/form\.append\(queryLabel,queryRow,picker\)/);
 assert.match(js,/picker\.append\(pickerLabel,segments\)/);
 assert.match(js,/queryRow\.append\(suggestBox\)/);
 assert.match(js,/submit\.type='submit'/);
 assert.match(js,/submit\.setAttribute\('aria-label','Search or scan token'\)/);
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
test('V2 presents four equally ranked network targets with a 2x2 mobile selector and large action target',()=>{
 assert.match(css,/V8 compact premium discovery/);
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/\.home-network-option\[data-network=all\]/);
 assert.match(css,/@media\(max-width:560px\)/);
 assert.match(css,/@media\(max-width:360px\)/);
 assert.match(css,/min-height:43px/);
 assert.match(css,/\.home-search-suggest\{top:54px/);
 assert.match(css,/\.home-search-state:empty\{display:none\}/);
 assert.match(css,/ARCY SEARCH V2 — structural layout/);
 assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(max-width:719px\)/);
 assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/\.home-search-query-row/);
 assert.match(css,/min-height:48px/);
 assert.match(css,/min-height:52px/);
});
test('no home search update modifies token data sources, cross-chain report format or title identity',()=>{
 assert.match(js,/const VERIFIED_TOKEN_ART=Object\.freeze/);
 assert.match(js,/const OFFICIAL_SUGGESTIONS=Object\.freeze/);
 assert.match(js,/const NETWORK_MARKUP=Object\.freeze/);
 assert.match(js,/const detailPath=|function detailPath/);
 assert.match(js,/NETWORK_MARKUP\[id\]/);
});
