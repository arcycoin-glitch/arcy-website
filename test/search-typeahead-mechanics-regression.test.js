'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const catalog=require('../search/server/lib/prefix-catalog');
const html=()=>fs.readFileSync(path.join(__dirname,'../search/index.html'),'utf8');
test('POLL is suggested on Arc after two characters, without asserting official issuer verification',()=>{
 const matches=catalog.discover('arc','po');
 assert.equal(matches.length,1);
 assert.equal(matches[0].symbol,'POLL');
 assert.equal(matches[0].address,'0xf76b1d00bd3d63a37246b5f512074e864010e33d');
 assert.equal(matches[0].identityVerified,false);
 assert.equal(matches[0].registryMatched,false);
 assert.equal(catalog.discover('ethereum','po').length,0);
 assert.equal(catalog.discover('arc','p').length,0);
});
test('typeahead is debounced on main Search and token detail inputs',()=>{
 const source=html();
 assert.match(source,/function scheduleTypeahead\(\)/);
 assert.match(source,/scheduleTypeahead\(\)\}\);/);
 assert.match(source,/\$\('detailSearchQuery'\)\.addEventListener\('input'/);
 assert.match(source,/setTimeout\(\(\)=>\{typeaheadTimer=null;void searchOrScan\(\)\},340\)/);
});
test('mechanics retains all four checks and visibly reports missing proof',()=>{
 const source=html();
 assert.match(source,/spec\.id!=='mechanics'/);
 assert.match(source,/shortReason\(data\)/);
 assert.match(source,/percentage\.toFixed\(4\)/);
});
