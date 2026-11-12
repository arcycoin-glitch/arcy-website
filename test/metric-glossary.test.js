'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const schema=require('../search/schema.js');
const script=fs.readFileSync(path.join(__dirname,'../search/metric-glossary.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../search/metric-glossary.css'),'utf8');
const detail=fs.readFileSync(path.join(__dirname,'../search/index.html'),'utf8');
const home=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');

test('all existing metric fields have a plain-language explanation',()=>{
 for(const spec of schema)for(const [key] of spec.fields)
  assert.match(script,new RegExp('\\b'+key+'\\s*:'),'Missing glossary entry: '+key);
});
test('metric help is isolated to the detail report and leaves the schema untouched',()=>{
 assert.match(detail,/\/search\/metric-glossary\.js/);
 assert.match(detail,/\/search\/metric-glossary\.css/);
 assert.doesNotMatch(home,/metric-glossary/);
 assert.match(script,/root\.querySelectorAll\('\[data-card-id\]'\)/);
 assert.match(script,/new MutationObserver\(decorate\)/);
 assert.match(css,/#tokenDetail #cards \.metric-help/);
});
