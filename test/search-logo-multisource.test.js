'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const logos=require('../search/server/lib/search-logo');
const artwork=require('./helpers/logo-artwork.cjs');
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40);
const ICON='https://cdn-icons.blockscout.com/token-icons/arc-sample.png';
const DEX_ICON='https://cdn.dexscreener.com/cms/images/dex-sample.png';
const json=o=>new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}});
const candidate=(address)=>({network:'arc',chainId:5042,address,identity:{status:'NOT_VERIFIED'},logoUrl:null});
test('exact-contract Blockscout metadata rescues a missing DEX logo without claiming issuer verification',async()=>{
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push(url);
  if(url.startsWith('https://api.dexscreener.com/tokens/v1/arc/'))return json([]);
  if(url==='https://explorer.arc.io/api/v2/tokens/'+A){
   assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');
   return json({address_hash:A,type:'ERC-20',icon_url:ICON});
  }
  if(url===ICON)return artwork.response();
  throw Error('Unexpected URL '+url);
 };
 const [result]=await logos.enhance('arc',[candidate(A)],{fetchImpl,enableExplorer:true});
 assert.equal(result.logoUrl,ICON);
 assert.match(result.logoSource,/Blockscout exact-contract metadata/);
 assert.equal(result.identity.status,'NOT_VERIFIED');
 assert.equal(calls.filter(x=>x.includes('/api/v2/tokens/')).length,1);
});
test('wrong-contract metadata, SVG, unapproved hosts, and wrong token type never acquire logos',async()=>{
 const cases=[
  {address_hash:B,type:'ERC-20',icon_url:ICON},
  {address_hash:A,type:'ERC-721',icon_url:ICON},
  {address_hash:A,type:'ERC-20',icon_url:'https://untrusted.example/icon.png'},
  {address_hash:A,type:'ERC-20',icon_url:'https://cdn-icons.blockscout.com/token-icons/evil.svg'}
 ];
 for(const body of cases){
  let count=0;
  const fetchImpl=async url=>{
   count++;
   if(url.includes('api.dexscreener.com/'))return json([]);
   if(url.includes('/api/v2/tokens/'))return json(body);
   throw Error('Untrusted thumbnail fetched '+url);
  };
  const [result]=await logos.enhance('arc',[candidate(A)],{fetchImpl,enableExplorer:true});
  assert.equal(result.logoUrl,null);
  assert.equal(count,2,'one DEX batch and one fixed-host exact-contract metadata lookup');
 }
});
test('DEX source wins over explorer, and fallback never calls explorer for already decorated contract',async()=>{
 let explorer=0;
 const fetchImpl=async url=>{
  if(url.includes('api.dexscreener.com/'))return json([{chainId:'arc',
   baseToken:{address:A},info:{imageUrl:DEX_ICON},liquidity:{usd:500}}]);
  if(url.includes('/api/v2/tokens/')){explorer++;throw Error('should not query extra source');}
  if(url===DEX_ICON)return artwork.response();
  throw Error('Unexpected '+url);
 };
 const [result]=await logos.enhance('arc',[candidate(A)],{fetchImpl,enableExplorer:true});
 assert.equal(result.logoUrl,DEX_ICON);assert.equal(explorer,0);
});
test('one logo reused by two distinct token contracts is rejected even with exact-address metadata',async()=>{
 let validated=0;
 const fetchImpl=async url=>{
  if(url.includes('api.dexscreener.com/'))return json([]);
  if(url.endsWith('/'+A))return json({address_hash:A,type:'ERC-20',icon_url:ICON});
  if(url.endsWith('/'+B))return json({address_hash:B,type:'ERC-20',icon_url:ICON});
  if(url===ICON){validated++;return artwork.response();}
  throw Error(url);
 };
 const out=await logos.enhance('arc',[candidate(A),candidate(B)],{fetchImpl,enableExplorer:true});
 assert.ok(out.every(x=>x.logoUrl===null&&x.logoWithheld==='SHARED_BY_MULTIPLE_CONTRACTS'));
 assert.equal(validated,0,'known duplicated artwork should not consume thumbnail validation budget');
});
test('explorer fallback is hard-capped to four exact addresses per request',async()=>{
 const rows=Array.from({length:8},(_,i)=>candidate('0x'+(i+1).toString(16).padStart(40,'0')));
 let metadata=0;
 const fetchImpl=async url=>{
  if(url.includes('api.dexscreener.com/'))return json([]);
  if(url.includes('/api/v2/tokens/')){metadata++;return json({type:'ERC-20',icon_url:null});}
  throw Error(url);
 };
 const out=await logos.enhance('arc',rows,{fetchImpl,enableExplorer:true});
 assert.equal(out.length,8);assert.equal(metadata,4);
 assert.ok(out.every(x=>x.logoUrl===null),'missing icons do not become fabricated thumbnails');
});
test('all eight distinct validated icons survive per-item bounded image checks',async()=>{
 const rows=Array.from({length:8},(_,i)=>candidate('0x'+(i+12).toString(16).padStart(40,'0')));
 const pairIcon=i=>'https://cdn.dexscreener.com/cms/images/art'+i+'.png';
 const fetchImpl=async url=>{
  if(url.includes('/tokens/v1/arc/'))return json(rows.map((row,i)=>({
   chainId:'arc',baseToken:{address:row.address},
   info:{imageUrl:pairIcon(i)},liquidity:{usd:1000+i}
  })));
  if(url.includes('/cms/images/art')){
   await new Promise(resolve=>setTimeout(resolve,350));
   return artwork.response();
  }
  throw Error('Unexpected '+url);
 };
 const out=await logos.enhance('arc',rows,{fetchImpl,enableExplorer:true});
 assert.deepEqual(out.map(x=>x.logoUrl),rows.map((_,i)=>pairIcon(i)));
});
test('429/503 on exact-token explorer metadata is fail-closed and never changes token identity',async()=>{
 for(const status of [429,503]){
  const fetchImpl=async url=>url.includes('/tokens/v1/')?json([]):
   new Response(null,{status});
  const [result]=await logos.enhance('arc',[candidate(A)],{fetchImpl,enableExplorer:true});
  assert.equal(result.logoUrl,null);assert.equal(result.identity.status,'NOT_VERIFIED');
 }
});
