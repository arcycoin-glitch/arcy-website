#!/usr/bin/env node
'use strict';
// #337 Phase 1 read-only feasibility probe for a full Ethereum (chain 1) Transfer-ledger holder census of the fixed cohort.
// Measures, per public endpoint: chainId, head, eth_getLogs range/log limits (error text), archive eth_getCode at old blocks.
// Per token: deployment block (binary search on eth_getCode, archive needed), Transfer-log density in 3 sample windows.
// Prints measurements only; nothing is written; no credentials.
const RPCS=(process.env.ETH_PROBE_RPCS||'https://ethereum-rpc.publicnode.com,https://eth.llamarpc.com,https://rpc.flashbots.net,https://cloudflare-eth.com').split(',');
const T='0xddf252ad1be2c89b69c2b068fc378daa952ba7f179c4a11ba1c2a8ac4aa1d1b';
const fs=require('node:fs'),path=require('node:path');
const cohort=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/verified-coverage/radar-cohort-20261121.json'),'utf8')).tokens.filter(t=>t.chainId===1);
let id=0;
async function call(url,method,params){const t0=Date.now();try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});
 const text=await r.text();let j;try{j=JSON.parse(text)}catch{return {http:r.status,error:'NON_JSON',ms:Date.now()-t0}}
 return {http:r.status,result:j.result,error:j.error?String(j.error.message||j.error.code).slice(0,140):null,ms:Date.now()-t0};}catch(e){return {error:e.name,ms:Date.now()-t0}}}
const hex=n=>'0x'+n.toString(16);
(async()=>{
 const live=[];
 for(const u of RPCS){const c=await call(u,'eth_chainId',[]),h=await call(u,'eth_blockNumber',[]);
  const head=h.result?Number(h.result):null,old=head?await call(u,'eth_getCode',['0x514910771af9ca656af840dff83e8264ecf986ca',hex(5000000)]):{};
  const r1=head?await call(u,'eth_getLogs',[{address:'0x514910771af9ca656af840dff83e8264ecf986ca',topics:[T],fromBlock:hex(head-100000),toBlock:hex(head)}]):{};
  const r2=head?await call(u,'eth_getLogs',[{address:'0x514910771af9ca656af840dff83e8264ecf986ca',topics:[T],fromBlock:hex(head-2000),toBlock:hex(head)}]):{};
  const row={rpc:new URL(u).hostname,chainId:c.result,head,archiveCodeAt5M:old.result?old.result.length>2:old.error||null,
   logs100kBlocks:Array.isArray(r1.result)?r1.result.length:r1.error,logs2kBlocks:Array.isArray(r2.result)?r2.result.length:r2.error,ms:[r1.ms,r2.ms]};
  console.log('ENDPOINT '+JSON.stringify(row));if(c.result==='0x1'&&head&&old.result&&old.result.length>2&&Array.isArray(r2.result))live.push({u,head});}
 if(!live.length){console.log('NO_USABLE_ARCHIVE_ENDPOINT');return;}
 const {u,head}=live[0];
 for(const t of cohort){
  let lo=0,hi=head,calls=0;
  while(lo<hi){const mid=Math.floor((lo+hi)/2);const r=await call(u,'eth_getCode',[t.address,hex(mid)]);calls++;if(r.error){lo=-1;break;}if(r.result&&r.result.length>2)hi=mid;else lo=mid+1;}
  const deploy=lo<0?null:lo,samples=[];
  if(deploy!=null)for(const at of [deploy,Math.floor((deploy+head)/2),head-2000]){const r=await call(u,'eth_getLogs',[{address:t.address,topics:[T],fromBlock:hex(at),toBlock:hex(Math.min(head,at+1999))}]);samples.push(Array.isArray(r.result)?r.result.length:r.error);}
  const dense=samples.filter(x=>typeof x==='number');
  console.log('TOKEN '+JSON.stringify({symbol:t.symbol,address:t.address,deployBlock:deploy,spanBlocks:deploy!=null?head-deploy:null,codeSearchCalls:calls,logsPer2000Blocks:samples,
   roughLogsIfUniform:dense.length&&deploy!=null?Math.round(dense.reduce((a,b)=>a+b,0)/dense.length*(head-deploy)/2000):null}));
 }
})().catch(e=>{console.error(e.name);process.exitCode=1;});
