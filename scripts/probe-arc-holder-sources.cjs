'use strict';
// Read-only probe #2: feasibility of RPC-only Transfer-log discovery on Arc (5042). Bounded, no credentials, no writes.
const STUCK='0x4c9b47dbd5933aa4574b2c27f82419e4dbbd0222',TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const RPCS=['https://rpc.mainnet.arc.io','https://rpc.quicknode.mainnet.arc.io','https://rpc.blockdaemon.mainnet.arc.io'];
const hex=n=>'0x'+n.toString(16);
async function rpc(url,method,params,ms=15000){const t=Date.now();try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(ms)});const d=await r.json();return {http:r.status,ms:Date.now()-t,result:d.result,error:d.error&&{code:d.error.code,message:String(d.error.message).slice(0,140)}};}catch(e){return {error:{name:e.name},ms:Date.now()-t};}}
const log=(k,v)=>console.log(k+' '+JSON.stringify(v));
(async()=>{
 const head=Number(BigInt((await rpc(RPCS[0],'eth_blockNumber',[])).result));log('HEAD',head);
 // 1) Deployment block by binary search on eth_getCode (also reveals history availability per provider).
 for(const u of RPCS){
  const probe=await rpc(u,'eth_getCode',[STUCK,hex(Math.floor(head/2))]);log('HIST_CODE_HALF',{u,ms:probe.ms,len:probe.result?.length,error:probe.error});
  const genesis=await rpc(u,'eth_getCode',[STUCK,'0x1']);log('HIST_CODE_1',{u,len:genesis.result?.length,error:genesis.error});
 }
 let lo=0,hi=head,calls=0,u=RPCS[0],failed=null;
 while(hi-lo>1&&calls<40){const mid=Math.floor((lo+hi)/2);calls++;const r=await rpc(u,'eth_getCode',[STUCK,hex(mid)]);if(r.error){failed={mid,error:r.error};break;}if(r.result&&r.result!=='0x')hi=mid;else lo=mid;}
 log('DEPLOY_BLOCK',{deployBlock:failed?null:hi,calls,failed,blocksSinceDeploy:failed?null:head-hi});
 const from=failed?Math.max(0,head-200000):hi;
 // 2) Max accepted eth_getLogs range per provider, from deployment.
 for(const url of RPCS)for(const w of [1000,2000,10000,100000,1000000,head-from+1]){const to=Math.min(head,from+w-1);const r=await rpc(url,'eth_getLogs',[{address:STUCK,topics:[TRANSFER],fromBlock:hex(from),toBlock:hex(to)}],20000);log('LOGS',{url,from,to,width:w,ms:r.ms,count:Array.isArray(r.result)?r.result.length:null,error:r.error});if(r.error&&w>=100000)break;}
})();
