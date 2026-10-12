'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const gecko=require('../search/server/lib/gecko-market');
const chains={arc:{id:'arc',chainId:5042,token:'0x'+'a'.repeat(40),other:'0x'+'b'.repeat(40)},
 ethereum:{id:'eth',chainId:1,token:'0x'+'c'.repeat(40),other:'0x'+'d'.repeat(40)},
 robinhood:{id:'robinhood',chainId:4663,token:'0x'+'e'.repeat(40),other:'0x'+'f'.repeat(40)}};
function pool(network,p){
 const id=network.id+'_'+p;
 return {type:'pool',id,attributes:{address:p,reserve_in_usd:'125.5',volume_usd:{h24:'24'},
  base_token_price_usd:'0.25',quote_token_price_usd:'4',fdv_usd:'2500',
  price_change_percentage:{h24:'-2.5'}},relationships:{base_token:{data:{id:network.id+'_'+network.token}},
  quote_token:{data:{id:network.id+'_'+network.other}},dex:{data:{id:'uniswap-v3'}}}};
}
test('Search market requests use GeckoTerminal public endpoints for each configured network only',async()=>{
 for(const network of Object.values(chains)){
  const response={data:[pool(network,'0x'+'1'.repeat(40))]};let requested='';
  const result=await gecko.inspect(network===chains.arc?'arc':network===chains.ethereum?'ethereum':'robinhood',network.token,
  {fetcher:async url=>{requested=url;return new Response(JSON.stringify(response),{status:200,headers:{'content-type':'application/json'}})}});
  assert.match(requested,/api\.geckoterminal\.com\/api\/v2\/networks\//);
  assert.ok(!/coingecko|dexscreener/i.test(requested));
  assert.equal(result.rows.length,1);
  assert.equal(result.fields.priceUsd.value,0.25);
  assert.equal(result.fields.liquidityUsd.value,125.5);
  assert.equal(result.fields.volume24h.value,24);
  assert.equal(result.fields.valuation.kind,'FDV');
  assert.equal(result.fields.valuation.value,2500);
  assert.equal(result.fields.change24h.value,-2.5);
  assert.equal(result.fields.liquidityUsd.source,'GeckoTerminal');
  assert.equal(result.fields.liquidityUsd.chainId,network.chainId);
 }
});
test('GeckoTerminal market parser rejects wrong chain and wrong contract pools',()=>{
 const row=pool(chains.arc,'0x'+'1'.repeat(40));
 const wrongChain=structuredClone(row);wrongChain.id='eth_'+wrongChain.attributes.address;
 const wrongToken=structuredClone(row);wrongToken.relationships.base_token.data.id='arc_'+'0x'+'9'.repeat(40);
 const result=gecko.parseMarket({data:[wrongChain,wrongToken]},'arc',chains.arc.token);
 assert.equal(result.rows.length,0);
 assert.equal(result.fields.priceUsd.dataState,'NOT_VERIFIED');
 assert.equal(result.fields.liquidityUsd.value,null);
});
test('GeckoTerminal token search filters by network and does not confer official identity',()=>{
 const row=pool(chains.arc,'0x'+'1'.repeat(40));
 row.relationships.base_token.data.id='arc_'+chains.arc.token;
 const ethRow=structuredClone(row);ethRow.relationships.base_token.data.id='eth_'+chains.ethereum.token;
 const included=[
  {id:'arc_'+chains.arc.token,type:'token',attributes:{name:'Arc USDC',symbol:'USDC'}},
  {id:'eth_'+chains.ethereum.token,type:'token',attributes:{name:'Ethereum USDC',symbol:'USDC'}}
 ];
 const found=gecko.parseSearch({data:[row,ethRow],included},'arc','USDC');
 assert.equal(found.length,1);assert.equal(found[0].address,chains.arc.token);
 assert.equal(found[0].identityVerified,false);assert.equal(found[0].logoUrl,null);
});
test('CoinGecko circulation API is disabled and missing supply is not inferred',async()=>{
 const old=global.fetch;let called=false;
 try{
  global.fetch=async url=>{called=true;throw Error('Unexpected network request '+url)};
  const result=await require('../search/server/lib/circulating').inspect(chains.ethereum.token,100);
  assert.equal(called,false);
  assert.equal(result.dataState,'NOT_VERIFIED');
  assert.equal(result.reasonCode,'PROVIDER_DISABLED_LICENSE_UNVERIFIED');
 }finally{global.fetch=old}
});
test('Unsupported provider artwork always uses the UI initials fallback',()=>{
 const safe=require('../search/server/lib/token-image').safeLogoUrl;
 assert.equal(safe('https://coin-images.coingecko.com/a.png'),null);
 assert.equal(safe('https://cdn.dexscreener.com/a.png'),null);
 assert.equal(safe('https://assets.geckoterminal.com/a.png'),null);
});
