const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const css=fs.readFileSync(require('node:path').join(__dirname,'..','search-contract.css'),'utf8');
test('mobile Research must remain a readable horizontally scrolling carousel',()=>{
 const rule=css.slice(css.indexOf('Mobile Research carousel:'));
 assert.ok(rule.length>200,'Mobile Research rules must exist');
 assert.match(rule,/#search \.app \.grid\s*\{\s*display:flex!important;/);
 assert.match(rule,/flex-direction:row!important;/);
 assert.match(rule,/flex-wrap:nowrap!important;/);
 assert.match(rule,/overflow-x:auto!important;/);
 assert.match(rule,/scroll-snap-type:x mandatory;/);
 assert.match(rule,/#search \.app \.grid > \.card\s*\{[^}]*flex:0 0 86%!important;/s);
 assert.match(rule,/#search \.app \.grid > \.card\s*\{[^}]*flex-shrink:0!important;/s);
 assert.match(rule,/content:"RESEARCH  ·  SWIPE →";/);
 assert.match(rule,/\.grid::after\s*\{[^}]*flex:0 0 14%;/s);
});
test('desktop Research still uses a two-column grid and claims remain hidden',()=>{
 assert.match(css,/#search \.grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/#search \.grid > \.claims\{display:none!important\}/);
});
