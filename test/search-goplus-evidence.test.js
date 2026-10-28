'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const gp=require('../search/server/lib/goplus-evidence');
const eth='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const tsla='0x322f0929c4625ed5bad873c95208d54e1c003b2d';
function response(network,address,flags){
 const id=network==='ethereum'?1:network==='arc'?5042:4663;
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
test('GoPlus Arc 5042 has a separate exact-contract source scope',async()=>{
 const arcy='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
 const official=response('arc',arcy,{buy_tax:'0',sell_tax:'0',holder_count:'37'});
 const fees=gp.parse(official,'arc',arcy);
 assert.equal(fees.tradingTaxes.dataState,'DATA_FOUND');
 assert.equal(fees.tradingTaxes.chainId,5042);
 assert.equal(fees.tradingTaxes.status,'SOURCE_REPORTED');
 const count=gp.parseHolders(official,'arc',arcy).holderCount;
 assert.equal(count.value,37);
 assert.equal(count.source,'GoPlus Security');
 const wrong=gp.parse(official,'ethereum',arcy);
 assert.equal(wrong.tradingTaxes.dataState,'NOT_VERIFIED');
 const inspected=await gp.inspectHolders('arc',arcy,{fetcher:async url=>{
  assert.equal(String(url),'https://api.gopluslabs.io/api/v1/token_security/5042?contract_addresses='+arcy);
  return new Response(JSON.stringify(official),{status:200});
 }});
 assert.equal(inspected.holderCount.value,37);
 assert.equal(inspected.top20Pct.dataState,'NOT_VERIFIED');
});
test('Arc mechanics cannot replace strong first-party ARCY 3/3 taxes with conflicting GoPlus 0/0',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../search/server/lib/arc-adapter.js'),'utf8');
 assert.match(source,/existing.dataState==='DATA_FOUND'\?existing:/);
 assert.match(source,/isARCY&&key==='tradingTaxes'\?existing:/);
});
test('Upstream 403 cannot produce any fabricated fee or owner values and is classified as a provider failure',async()=>{
 const f=await gp.inspect('robinhood',tsla,{fetcher:async()=>({ok:false,status:403})});
 assert.deepEqual(Object.keys(f).sort(),['contractArchitecture','mintCapability','ownerAdmin','tradingTaxes']);
 for(const v of Object.values(f)){
  // A provider failure is not insufficient evidence and never a value.
  assert.equal(v.dataState,'SOURCE_API_FAILED');assert.equal(v.status,'NOT_VERIFIED');
  assert.equal(v.reasonCode,'SECURITY_SOURCE_API_FAILED');assert.equal(v.value,null);assert.deepEqual(v.evidence,[]);
 }
 const h=await gp.inspectHolders('robinhood',tsla,{fetcher:async()=>{throw Error('private-upstream-detail')}});
 for(const v of Object.values(h)){assert.equal(v.dataState,'SOURCE_API_FAILED');assert.equal(v.value,null);}
 assert(!JSON.stringify(h).includes('private-upstream-detail'));
});
test('a valid GoPlus response without a field remains NOT_VERIFIED, distinct from a provider failure',async()=>{
 const f=await gp.inspect('robinhood',tsla,{fetcher:async()=>new Response(JSON.stringify({code:1,result:{}}),{status:200})});
 for(const v of Object.values(f)){assert.equal(v.dataState,'NOT_VERIFIED');assert.equal(v.value,null);}
});
test('Correct GoPlus chain and contract used for Robinhood',async()=>{
 let u;
 const fetcher=async url=>(u=String(url),new Response(JSON.stringify(response('robinhood',tsla,{is_proxy:'1'})),{status:200}));
 const f=await gp.inspect('robinhood',tsla,{fetcher});
 assert.equal(u,'https://api.gopluslabs.io/api/v1/token_security/4663?contract_addresses='+tsla);
 assert.equal(f.contractArchitecture.chainId,4663);
});

test('Production GoPlus requests fail closed until written permission and required attribution are approved',async()=>{
 const names=['VERCEL','VERCEL_ENV','GOPLUS_PUBLIC_DISPLAY_APPROVED'];
 const prior=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 let calls=0;
 try{
  process.env.VERCEL='1';process.env.VERCEL_ENV='production';delete process.env.GOPLUS_PUBLIC_DISPLAY_APPROVED;
  const security=await gp.inspect('arc','0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b',{fetcher:async()=>{calls++;throw Error('must not call provider')}});
  const holders=await gp.inspectHolders('arc','0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b',{fetcher:async()=>{calls++;throw Error('must not call provider')}});
  assert.equal(calls,0);
  for(const field of [...Object.values(security),...Object.values(holders)]){
   assert.equal(field.dataState,'NOT_VERIFIED');
   assert.equal(field.reasonCode,'PROVIDER_DISABLED_LICENSE_UNVERIFIED');
  }
  process.env.GOPLUS_PUBLIC_DISPLAY_APPROVED='true';
  assert.equal(gp.productionUseAllowed(),true);
  const enabled=await gp.inspect('robinhood',tsla,{fetcher:async()=>{
   calls++;return new Response(JSON.stringify(response('robinhood',tsla,{is_proxy:'1'})),{status:200});
  }});
  assert.equal(calls,1);assert.equal(enabled.contractArchitecture.dataState,'DATA_FOUND');
 }finally{
  for(const name of names){if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name]}
 }
});

test('GoPlus holder proportions are fractions and top-10 is clearly source reported',()=>{
 const rows=Array.from({length:10},(_,i)=>({
  address:'0x'+(i+1).toString(16).padStart(40,'0'),
  percent:(0.20/(i+1)).toFixed(12)
 }));
 const out=gp.parseHolders(response('robinhood',tsla,{holder_count:'1000',holders:rows}),'robinhood',tsla);
 assert.equal(out.holderCount.value,1000);
 assert.equal(out.largestWalletPct.value,20);
 assert.equal(out.top10Pct.dataState,'DATA_FOUND');
 assert.ok(out.top10Pct.value>25&&out.top10Pct.value<60);
 assert.equal(out.top20Pct.dataState,'NOT_VERIFIED');
 assert.equal(out.top10Pct.status,'SOURCE_REPORTED');
 assert.equal(out.top10Pct.chainId,4663);
 assert.match(out.top10Pct.evidence[0].scope,/not independently pinned/);
});
test('GoPlus bad ranking, duplicate wallet or incomplete source fails closed',()=>{
 const rows=Array.from({length:10},(_,i)=>({
  address:'0x'+(i+1).toString(16).padStart(40,'0'),
  percent:(0.1/(i+1)).toFixed(12)
 }));
 const duplicate=rows.map((x,i)=>i===9?{...x,address:rows[0].address}:x);
 const badlySorted=rows.map(x=>({...x}));badlySorted[1].percent='0.8';
 for(const holders of [duplicate,badlySorted]){
  const f=gp.parseHolders(response('robinhood',tsla,{holder_count:'100',holders}),'robinhood',tsla);
  assert.equal(f.top10Pct.dataState,'NOT_VERIFIED');
 }
 const mismatched=gp.parseHolders(response('robinhood',eth,{holder_count:'1',holders:rows}),'robinhood',tsla);
 assert.equal(mismatched.holderCount.dataState,'NOT_VERIFIED');
});
