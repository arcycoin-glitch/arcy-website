'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const handler=require('../search/server/api/artwork');
const logos=require('../search/server/lib/search-logo');
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40);
const URL='https://cdn.dexscreener.com/cms/images/unit-artwork.png';
function res(){
 return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;return this;},
  status(n){this.statusCode=n;return this;},json(body){this.body=body;return body}};
}
test('deferred artwork parser is exact-chain, bounded and rejects mixed or duplicate addresses',()=>{
 assert.deepEqual(handler.parse({chain:'arc',addresses:A+','+B}),{network:'arc',addresses:[A,B]});
 for(const bad of [
  {chain:'all',addresses:A},{chain:'arc',addresses:'ARGUS'},
  {chain:'arc',addresses:A+','+A.toUpperCase()},{chain:'arc',addresses:''},
  {chain:'ethereum',addresses:A+',not-an-address'},
  {chain:'arc',addresses:Array.from({length:9},(_,i)=>'0x'+i.toString(16).padStart(40,'0')).join(',')},
  {chain:'arc',addresses:A,logoUrl:URL},
  {chain:'arc',addresses:A,extra:'1'}
 ])assert.equal(handler.parse(bad),null,JSON.stringify(bad));
});
test('image hydration only returns source-validated artwork for requested exact contracts',async()=>{
 const old=logos.enhance;
 logos.enhance=async(network,items)=>{
  assert.equal(network,'arc');assert.deepEqual(items.map(x=>x.address),[A,B]);
  assert.ok(items.every(x=>x.identity.status==='NOT_VERIFIED'&&x.logoUrl===null&&x.registryMatched===false));
  return [{...items[0],logoUrl:URL,logoSource:'Source-indexed decorative token image; NOT issuer verification'},
   {...items[1],logoUrl:null}];
 };
 try{
  const out=res(),req={method:'GET',query:{chain:'arc',addresses:A+','+B},
   socket:{remoteAddress:'198.51.100.211'},headers:{}};
  await handler(req,out);
  assert.equal(out.statusCode,200);
  assert.deepEqual(out.body.items,[{address:A,logoUrl:URL,
   source:'Source-indexed decorative token image; NOT issuer verification'}]);
  assert.equal(out.body.chainId,5042);
  assert.equal(out.headers['Cache-Control'],'no-store');
 }finally{logos.enhance=old;}
});
test('artwork action is incremental and must never delay the first token search or change identity badges',()=>{
 const route=fs.readFileSync(path.join(__dirname,'..','api/search/index.js'),'utf8');
 const home=fs.readFileSync(path.join(__dirname,'..','search-upgrade.js'),'utf8');
 const fast=fs.readFileSync(path.join(__dirname,'..','search/server/lib/multichain-service.js'),'utf8');
 assert.match(route,/artwork:require\('\.\.\/\.\.\/search\/server\/api\/artwork'\)/);
 assert.match(route,/artwork:\['chain','addresses'\]/);
 assert.match(fast,/withTimeout\(logos\.enhance\(network,ranked\),350/);
 assert.match(home,/function hydrateArtwork\(\)/);
 assert.match(home,/if\(!results\.hidden\)hydrateArtwork\(\)/);
 assert.match(home,/row\.dataset\.logoNetwork/);
 assert.match(home,/row\.dataset\.logoAddress/);
 assert.match(home,/cancelArtwork\(\);results\.replaceChildren/);
 assert.match(home,/img\.addEventListener\('error',\(\)=>img\.remove\(\)/);
 assert.match(home,/data\.chainId!==SUGGEST_CHAIN_IDS\[network\]/);
});
