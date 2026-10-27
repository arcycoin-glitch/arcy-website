'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'search-upgrade.js'),'utf8');
const css=fs.readFileSync(path.join(root,'search-upgrade.css'),'utf8');
const canonical=require('../search/server/lib/token-identity').OFFICIAL;
function index(){
 const start=source.indexOf('const OFFICIAL_SUGGESTIONS=Object.freeze(');
 const end=source.indexOf('const SUGGEST_CHAIN_IDS=',start);
 assert.ok(start>=0&&end>start,'type-ahead official list exists');
 return Function(source.slice(start,end)+'return OFFICIAL_SUGGESTIONS;')();
}
test('SEARCH typeahead keeps every official suggestion tied to canonical chain, address and name',()=>{
 const items=index();
 assert.equal(items.length,canonical.length);
 for(const [network,address,name,symbol] of items){
  assert.match(address,/^0x[0-9a-f]{40}$/);
  const entry=canonical.find(x=>x.network===network&&x.address===address);
  assert.ok(entry,'contract is from current verified issuer list');
  assert.equal(name,entry.name);
  assert.equal(symbol,entry.symbol);
 }
});
test('typing on suggests official ONDO on Ethereum without pressing Search',()=>{
 const items=index();
 const on=items.filter(item=>item[2].toLowerCase().includes('on')||item[3].toLowerCase().includes('on'));
 assert.ok(on.some(item=>item[0]==='ethereum'&&item[1]==='0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3'&&item[3]==='ONDO'));
 const arc=items.filter(item=>item[3]==='ARCY');
 assert.equal(arc.length,1);
 assert.equal(arc[0][0],'arc');
});
test('typeahead is debounced, cancels stale requests and keeps official selections exact-contract',()=>{
 assert.match(source,/input\.addEventListener\('input',/);
 assert.match(source,/showSuggestions\(query\)/);
 assert.match(source,/setTimeout\(async\(\)=>\{/);
 assert.match(source,/},340\)/);
 assert.match(source,/suggestController\.abort\(\)/);
 assert.match(source,/generation!==suggestGeneration/);
 assert.match(source,/selected!=='all'&&item\.network!==selected/);
 assert.match(source,/item\.chainId!==SUGGEST_CHAIN_IDS\[item\.network\]/);
 assert.match(source,/item\.network\+'\:'\+item\.address\.toLowerCase\(\)/);
 assert.match(source,/suggestBox\.append\(addCandidate\(item,item\.network\)\)/);
 assert.match(source,/event\.key==='ArrowDown'/);
 assert.match(source,/event\.key==='Escape'/);
 assert.match(source,/cancelSuggestions\(\);hideSuggestions\(\);results\.replaceChildren/);
});
test('official typeahead merges only artwork from a matching exact-chain contract without changing identity',()=>{
 assert.match(source,/if\(unique\.has\(key\)\)\{/);
 assert.match(source,/const existing=unique\.get\(key\)/);
 assert.match(source,/if\(!existing\.logoUrl&&typeof item\.logoUrl==='string'\)/);
 assert.match(source,/unique\.set\(key,\{\.\.\.existing,logoUrl:item\.logoUrl\}\)/);
 assert.match(source,/selected!=='all'&&item\.network!==selected/);
 assert.match(source,/item\.chainId!==SUGGEST_CHAIN_IDS\[item\.network\]/);
 assert.match(source,/item\.network\+'\:'\+item\.address\.toLowerCase\(\)/);
});
test('typeahead has an isolated responsive overlay and cannot modify unlock modules',()=>{
 assert.match(css,/#search \.home-search-suggest\{/);
 assert.match(css,/position:absolute;z-index:50/);
 assert.match(css,/#search \.home-search-suggest\[hidden\]/);
 assert.match(css,/@media\(max-width:560px\)/);
 assert.doesNotMatch(source,/fetch\('\/api\/unlocks/);
});
