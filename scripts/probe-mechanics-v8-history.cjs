'use strict';
// Usage: node scripts/probe-mechanics-v8-history.cjs NETWORK TOKEN BLOCK[,BLOCK...] [CHECKPOINT.json]
const fs=require('node:fs');
const {chain}=require('../search/server/lib/chains');
const {collect}=require('../search/server/lib/mechanics-v8-history');
async function main(){
 const [network,token,heights,checkpointPath]=process.argv.slice(2);
 if(!network||!token||!heights)throw Error('Usage: NETWORK TOKEN BLOCK[,BLOCK...] [CHECKPOINT.json]');
 const cfg=chain(network);
 let providers;
 if(network==='ethereum'){
  const eth=require('../search/server/lib/eth');
  providers=[{id:new URL(eth.RPC_URL).hostname,rpc:eth.rpc}];
 }else{
  const transport=require('../search/server/lib/'+network+'-rpc');
  providers=[...new Map(transport.providers().map(url=>[new URL(url).hostname,url])).entries()].map(([id,url])=>({id,
   rpc:(method,params,opts)=>transport.requestAt(url,method,params,opts)}));
 }
 let checkpoint;
 if(checkpointPath&&fs.existsSync(checkpointPath)){
  if(fs.statSync(checkpointPath).size>1024*1024)throw Error('Oversized historical Mechanics checkpoint');
  const cached=JSON.parse(fs.readFileSync(checkpointPath,'utf8'));
  if(cached.chainId!==cfg.chainId||cached.address!==token.toLowerCase())throw Error('Checkpoint identity differs');
  checkpoint=cached.observations;
 }
 const result=await collect({network,token,blocks:heights.split(','),providers,checkpoint});
 const json=JSON.stringify(result,null,2)+'\n';
 if(checkpointPath){
  const tmp=checkpointPath+'.'+process.pid+'.new';
  fs.writeFileSync(tmp,json,{flag:'wx'});
  fs.renameSync(tmp,checkpointPath);
 }
 process.stdout.write(json);
 if(!result.snapshots.some(x=>x.value))process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
