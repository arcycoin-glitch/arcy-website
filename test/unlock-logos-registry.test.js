'use strict';
// Data Engine V3 Unlocks logo identity: the presentation registry must never let one symbol/name resolve to two images,
// and the researched entries carry their identity evidence.
const test=require('node:test'),assert=require('node:assert/strict');
const reg=require('../assets/unlock-logos.json');
const normal=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
test('registry: unique (symbol, normalized name), CoinGecko CDN raster images only, no duplicate image across identities',()=>{
 const keys=new Set(),images=new Map();
 for(const x of reg.logos){
  const k=x.symbol+'|'+normal(x.name);assert.ok(!keys.has(k),'duplicate '+k);keys.add(k);
  const u=new URL(x.logo);assert.equal(u.protocol,'https:');assert.equal(u.hostname,'coin-images.coingecko.com');
  assert.match(u.pathname,/^\/coins\/images\/\d+\/large\/[^/]+\.(png|jpe?g|webp)$/i,x.symbol);
  assert.ok(!images.has(x.logo),'image shared by '+images.get(x.logo)+' and '+x.symbol);images.set(x.logo,x.symbol);
 }
});
test('V3 researched Unlocks logos: ASTER, BIGTIME, GRVT, GUN, L3 resolve by exact event name + symbol with identity evidence',()=>{
 for(const [name,symbol,id] of [['Aster','ASTER','aster-2'],['Big Time','BIGTIME','big-time'],['GRVT Token','GRVT','grvt'],['Gunz','GUN','gunz'],['Layer3','L3','layer3']]){
  const m=reg.logos.filter(l=>l.symbol===symbol&&normal(l.name)===normal(name));
  assert.equal(m.length,1,symbol);assert.equal(m[0].identity.coingeckoId,id);assert.ok(m[0].identity.homepage.startsWith('https://'));
  assert.ok(Object.values(m[0].identity.contracts).every(a=>/^0x[0-9a-f]{40}$/.test(a)));
  // a different project with the same ticker must not inherit it
  assert.equal(reg.logos.filter(l=>l.symbol===symbol&&normal(l.name)===normal(name+' Classic')).length,0);
 }
});
