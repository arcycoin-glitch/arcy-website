'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {safeLogoUrl}=require('../search/server/lib/token-image');
const logos=require('../search/server/lib/search-logo');
const identities=require('../search/server/lib/token-identity');
const dex=require('../search/server/lib/dex-market');
const {searchExplorer}=require('../search/server/lib/discover');
const ARC='0x'+'a'.repeat(40), ETH='0x'+'b'.repeat(40), COPY='0x'+'c'.repeat(40);
const ICON='https://cdn.dexscreener.com/cms/images/logo-example.webp';
const BSCOUT='https://cdn-icons.blockscout.com/token-icons/example.png';
const response=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});

test('decorative URLs accept only tight CDN image paths, not arbitrary hosts or documents',()=>{
 assert.equal(safeLogoUrl(ICON),ICON);
 const liveShape='https://cdn.dexscreener.com/cms/images/y7ril8c3Y0da5KIP?width=64&height=64&quality=85&format=auto';
 assert.equal(safeLogoUrl(liveShape),liveShape);
 assert.equal(safeLogoUrl(BSCOUT),BSCOUT);
 for(const bad of [
  'https://cdn.dexscreener.com/a.png','https://assets.geckoterminal.com/tokens/logo.png',
  'https://coin-images.coingecko.com/coin.png','https://cdn.dexscreener.com.evil.example/cms/images/t.png',
  'https://cdn.dexscreener.com/cms/images/a.svg','https://cdn.dexscreener.com/cms/images/a.html',
  'http://cdn.dexscreener.com/cms/images/a.png','https://attacker@cdn.dexscreener.com/cms/images/a.png',
  'https://cdn.dexscreener.com/cms/images/a.png?redirect=https://bad.example',
  'https://cdn.dexscreener.com/cms/images/a.png#bad'
 ])assert.equal(safeLogoUrl(bad),null,bad);
});
test('a token logo is bound to EXACT base contract and chain, not the quoted token',()=>{
 const body=[
  {chainId:'ethereum',baseToken:{address:ETH},quoteToken:{address:ARC},
   liquidity:{usd:12},info:{imageUrl:ICON}},
  {chainId:'arc',baseToken:{address:ETH},liquidity:{usd:9000},
   info:{imageUrl:'https://cdn.dexscreener.com/cms/images/wrong.png'}},
  {chainId:'ethereum',baseToken:{address:COPY},quoteToken:{address:ETH},liquidity:{usd:9000},
   info:{imageUrl:'https://cdn.dexscreener.com/cms/images/quote.png'}}
 ];
 const art=logos.marketArtwork(body,'ethereum',[ETH,ARC]);
 assert.equal(art.get(ETH),ICON);
 assert.equal(art.has(ARC),false);
 assert.equal(logos.marketArtwork(body,'arc',[ARC]).size,0);
});
test('batch logo enrichment fetches once, caches by chain/contract, and remains unverified',async()=>{
 let requests=0;
 const fetchImpl=async(url)=>{
  requests++;
  assert.match(url,/tokens\/v1\/ethereum\/0x[b]+/);
  return response([{chainId:'ethereum',baseToken:{address:ETH},info:{imageUrl:ICON},liquidity:{usd:99}}]);
 };
 const token={network:'ethereum',chainId:1,address:ETH,name:'Test',symbol:'TST',
  identity:{status:'NOT_VERIFIED'}};
 const first=await logos.enhance('ethereum',[token],{fetchImpl});
 const second=await logos.enhance('ethereum',[token],{fetchImpl});
 assert.equal(requests,1,'cache eliminates duplicate token icon traffic');
 assert.equal(first[0].logoUrl,ICON);
 assert.match(first[0].logoSource,/NOT issuer verification/);
 assert.equal(first[0].identity.status,'NOT_VERIFIED');
 assert.equal(second[0].logoUrl,ICON);
});
test('wrong-chain artwork never bleeds across Arc, Ethereum and Robinhood',async()=>{
 const remote=async()=>response([{chainId:'ethereum',baseToken:{address:ARC},info:{imageUrl:ICON}}]);
 const arc=await logos.enhance('arc',[{network:'arc',chainId:5042,address:ARC}],{fetchImpl:remote});
 assert.equal(arc[0].logoUrl,null);
 const wrong=await logos.enhance('ethereum',[{network:'arc',chainId:5042,address:ETH,logoUrl:ICON}],{fetchImpl:remote});
 assert.equal(wrong[0].logoUrl,null);
 const community=await logos.enhance('robinhood',[{network:'robinhood',chainId:4663,address:ARC,
  registryMatched:false,logoUrl:ICON,identity:{status:'NOT_VERIFIED'}}],{fetchImpl:()=>{throw Error('Already indexed icon must avoid DEX fetch')}});
 assert.equal(community[0].logoUrl,ICON);
 assert.equal(community[0].identity.status,'NOT_VERIFIED');
 const stock=await logos.enhance('robinhood',[{network:'robinhood',chainId:4663,address:ARC,
  registryMatched:true,source:'Robinhood official asset registry',logoUrl:ICON}],{fetchImpl:()=>{throw Error('Stock token must not fetch DEX art')}});
 assert.equal(stock[0].logoUrl,null);
});
test('Robinhood non-stock PONS resolves artwork only from exact chain and BASE token',async()=>{
 const address='0x39dbed3a2bd333467115de45665cc57f813c4571';
 const rows=[{network:'robinhood',chainId:4663,address,logoUrl:null,
  identity:{status:'NOT_VERIFIED'},registryMatched:false}];
 const fetchImpl=async url=>{
  assert.match(url,/tokens\/v1\/robinhood\/0x39dbed3a/);
  return response([
   {chainId:'ethereum',baseToken:{address},info:{imageUrl:'https://cdn.dexscreener.com/cms/images/evil.png'},liquidity:{usd:100000}},
   {chainId:'robinhood',baseToken:{address},info:{imageUrl:ICON},liquidity:{usd:2000}},
   {chainId:'robinhood',baseToken:{address:'0x'+'e'.repeat(40)},quoteToken:{address},info:{imageUrl:'https://cdn.dexscreener.com/cms/images/quote.png'},liquidity:{usd:90000}}
  ]);
 };
 const decorated=await logos.enhance('robinhood',rows,{fetchImpl});
 assert.equal(decorated[0].logoUrl,ICON);
 assert.equal(decorated[0].identity.status,'NOT_VERIFIED');
 assert.match(decorated[0].logoSource,/NOT issuer verification/);
});
test('licensed site-owned art takes priority; unsupported icons keep initials fallback',async()=>{
 let calls=0;
 const known=await logos.enhance('arc',[{network:'arc',chainId:5042,
  address:'0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b',logoUrl:ICON}],{
  fetchImpl:()=>{calls++;throw Error('Should never fetch')}});
 assert.equal(known[0].logoUrl,'/assets/hero-arcy.png');assert.equal(calls,0);
 assert.equal(logos.localLogo('arc',ETH),null);
});
test('unverified provider icons survive candidate ranking without status inflation',()=>{
 const entry={network:'ethereum',chainId:1,address:COPY,name:'Same symbol',
  symbol:'UNI',logoUrl:ICON,source:'Blockscout explorer index'};
 const rows=identities.rank('ethereum','UNI',[entry]);
 const candidate=rows.find(x=>x.address===COPY);
 assert.equal(candidate.logoUrl,ICON);
 assert.equal(candidate.identity.status,'NOT_VERIFIED');
 assert.equal(candidate.identityVerified,false);
});
test('Blockscout search icon is attached only to its indexed exact address',async()=>{
 const result=await searchExplorer('arc','Test',{fetchImpl:async()=>response({items:[
  {type:'token',token_type:'ERC-20',address_hash:ARC,name:'Test Token',symbol:'TST',icon_url:BSCOUT},
  {type:'token',token_type:'ERC-20',address_hash:COPY,name:'Unrelated',symbol:'UNR',icon_url:BSCOUT}
 ]})});
 assert.equal(result.length,1);
 assert.equal(result[0].address,ARC);
 assert.equal(result[0].logoUrl,BSCOUT);
 assert.equal(result[0].identityVerified,false);
});
test('DEX search artwork belongs only to base token and never proves authenticity',()=>{
 const result=dex.parseSearch({pairs:[{
  chainId:'ethereum',pairAddress:'0x'+'f'.repeat(40),
  baseToken:{address:ETH,name:'Example Coin',symbol:'EX'},quoteToken:{address:ARC,name:'ETH',symbol:'ETH'},
  info:{imageUrl:ICON}}]},'ethereum','example');
 assert.equal(result.length,1);
 assert.equal(result[0].logoUrl,ICON);
 assert.equal(result[0].identityVerified,false);
});
test('detail search avatar overlays logos above fallback initials, keeping mobile layout stable',()=>{
 const root=path.join(__dirname,'..');
 const css=fs.readFileSync(path.join(root,'search/final-polish.css'),'utf8');
 const detail=fs.readFileSync(path.join(root,'search/index.html'),'utf8');
 assert.match(css,/#tokenDetail \.detail-match-avatar\{position:relative/);
 assert.match(css,/#tokenDetail \.detail-match-avatar img\{position:absolute;inset:0/);
 assert.match(css,/#tokenDetail \.detail-match-avatar\.has-logo\{color:transparent\}/);
 assert.match(detail,/image\.addEventListener\('load',\(\)=>avatar\.classList\.add\('has-logo'\)/);
 assert.match(detail,/image\.addEventListener\('error',\(\)=>\{image\.remove\(\);avatar\.classList\.remove\('has-logo'\)\}/);
});
test('both approved UIs include source-validated art and preserve fallback without design replacement',()=>{
 const root=path.join(__dirname,'..'),home=fs.readFileSync(path.join(root,'search-upgrade.js'),'utf8');
 const detail=fs.readFileSync(path.join(root,'search/index.html'),'utf8');
 assert.match(home,/const providerArt=candidate.network===network/);
 assert.match(home,/home-token-placeholder/);
 assert.match(detail,/return safeCandidateImage\(raw\);/);
 assert.match(detail,/art\.addEventListener\('error',\(\)=>art\.remove\(\)/);
 assert.match(detail,/image\.addEventListener\('error',\(\)=>image\.remove\(\)/);
});
