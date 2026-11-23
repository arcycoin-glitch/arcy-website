'use strict';
// Use the same per-analysis RPC cache as multichain-service.report in Production.
// Reads are shared only inside this sample, preserving network/provider/block
// identity and the transport's timeout/retry policy. No cache crosses samples.
function mechanics(req,chain,address){
 return req('search/server/lib/analysis-scope').run(async()=>{
  if(chain==='ethereum'){
   const report=req('search/server/lib/report'),control=req('search/server/lib/control'),security=req('search/server/lib/security');
   const eth=req('search/server/lib/eth'),t=await eth.inspect(address);
   const [c,sec]=await Promise.all([control.inspect(t.address,t.block).catch(control.failure),security.inspect('ethereum',t.address).catch(()=>({}))]);let extra={};
   if(c.fields?.owner?.dataState!=='DATA_FOUND'||c.fields?.proxyImplementation?.dataState!=='DATA_FOUND'){try{extra=await req('search/server/lib/admin-getters').inspect({network:'ethereum',address:t.address,block:t.block,rpc:eth.rpc,needAdmin:c.fields?.owner?.dataState!=='DATA_FOUND',needImplementation:c.fields?.proxyImplementation?.dataState!=='DATA_FOUND'});}catch{}}
   return {block:t.block,card:await req('search/server/lib/mechanics-coverage').enrich({network:'ethereum',address:t.address,block:t.block,rpc:eth.rpc,card:report.mechanicsCard(c,sec,extra),env:{}})};
  }
  const adapter=req('search/server/lib/'+(chain==='arc'?'arc':'robinhood')+'-adapter');
  const base=await adapter.inspectToken({address});
  return {block:base.block,card:await adapter.inspectCard({base,cardId:'mechanics',address})};
 });
}
module.exports={mechanics};
