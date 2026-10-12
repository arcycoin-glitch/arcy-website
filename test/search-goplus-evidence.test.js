'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const gp=require('../search/server/lib/goplus-evidence');
const eth='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const tsla='0x322f0929c4625ed5bad873c95208d54e1c003b2d';
function response(network,address,flags){
 const id=network==='ethereum'?1:4663;
 return {code:1,result:{[address]:flags},message:'OK',chainId:id};
}
test('Ethereum partial fee report does not invent a missing transfer tax',()=>{
 const x=gp.parse(response('ethereum',eth,{buy_tax:'0',sell_tax:'0',transfer_tax:'',
  is_open_source:'1',is_proxy:'1'}),'ethereum',eth).tradingTaxes;
 assert.equal(x.dataState,'DATA_FOUND');assert.equal(x.chainId,1);
 assert.match(x.value,/Buy 0% · Sell 0% · Transfer not reported/);
 assert.equal(x.source,'GoPlus Security');
});
test('Robinhood uses correct chain ID and source-reported proxy observation',()=>{
 const f=gp.parse(response('robinhood',tsla,{buy_tax:'0.03',sell_tax:'0.045',
  transfer_tax:'0.01',is_proxy:'1',is_mintable:'0'}),'robinhood',tsla);
 assert.equal(f.tradingTaxes.chainId,4663);
 assert.match(f.tradingTaxes.value,/Buy 3% · Sell 4.5% · Transfer 1%/);
 assert.match(f.contractArchitecture.value,/proxy contract/);
 assert.match(f.mintCapability.value,/No mint function detected/);
});
test('Only exact-contract reports produce evidence; issuer lookalikes not matched',()=>{
 const f=gp.parse(response('ethereum','0x'+'a'.repeat(40),{
  buy_tax:'0',sell_tax:'0',is_mintable:'1'}),'ethereum',eth);
 assert.equal(f.tradingTaxes.dataState,'NOT_VERIFIED');
 assert.equal(f.mintCapability.value,null);
});
test('Invalid percentages fail closed and never become 0 or 100',()=>{
 for(const tax of ['','-1','nan','1.2',null]){
  const flags={buy_tax:tax,sell_tax:'0'};
  const f=gp.parse(response('ethereum',eth,flags),'ethereum',eth);
  assert.equal(f.tradingTaxes.dataState,'NOT_VERIFIED');
 }
 assert.equal(gp.fraction('0.5'),50);
 assert.equal(gp.bool(undefined),null);
});
test('Unknown proxy and mint fields remain unknown; zero owner is not renouncement proof',()=>{
 const f=gp.parse(response('robinhood',tsla,{owner_address:'0x'+'0'.repeat(40),
  is_proxy:'',is_mintable:''}),'robinhood',tsla);
 assert.equal(f.contractArchitecture.value,null);
 assert.match(f.ownerAdmin.value,/other roles unverified/);
 assert.equal(f.mintCapability.value,null);
});
test('Only Ethereum and Robinhood are admitted; Arc verified tax claims cannot be overwritten',async()=>{
 assert.rejects(()=>gp.inspect('arc',eth),/Invalid security network/);
});
test('Upstream 403 cannot produce any fabricated fee or owner values',async()=>{
 const f=await gp.inspect('robinhood',tsla,{fetcher:async()=>({ok:false,status:403})});
 for(const v of Object.values(f))assert.equal(v.dataState,'NOT_VERIFIED');
});
test('Correct GoPlus chain and contract used for Robinhood',async()=>{
 let u;
 const fetcher=async url=>(u=String(url),new Response(JSON.stringify(response('robinhood',tsla,{is_proxy:'1'})),{status:200}));
 const f=await gp.inspect('robinhood',tsla,{fetcher});
 assert.equal(u,'https://api.gopluslabs.io/api/v1/token_security/4663?contract_addresses='+tsla);
 assert.equal(f.contractArchitecture.chainId,4663);
});
