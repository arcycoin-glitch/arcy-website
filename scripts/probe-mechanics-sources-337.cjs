#!/usr/bin/env node
'use strict';
// #337 Phase 2 read-only probe: where (if anywhere) a runtime-bound verified source exists for the unresolved fixed-cohort
// contracts. Reports availability ONLY; nothing is promoted by this script. Explorer sources are evidence of availability,
// not a licence decision (Blockscout PRO / explorer terms remain an owner decision, see docs/MECHANICS_V9_20261126.md).
const TARGETS=[
 ['arc',5042,'ARCOON','0x4621a0baa0b5d97aae77704cf2a84dabe78a4fed'],['arc',5042,'FAZE','0x394d38f807ee0027a182216f5e67a15ae441fa2e'],
 ['arc',5042,'LONG','0x2164bb17a2d38c1b5170e987b2c0416df1efc752'],['arc',5042,'oBrain','0x28f986a61e078795639f239675582a12b4cf7f01'],
 ['robinhood',4663,'STATICS','0x2d8d6f4a93acd7a916a5a654ec8b690ba3b3eadd'],['robinhood',4663,'AI','0x2e8c31162b855a2ffa90f6f8634643ad6f111e18'],
 ['robinhood',4663,'TENDIES','0x45242320dbb855eea8fd36804c6487e10e97fcf9']];
const RPC={5042:'https://rpc.mainnet.arc.io',4663:'https://rpc.mainnet.chain.robinhood.com'};
const EXPLORERS={5042:['https://arcscan.app','https://explorer.arc.io','https://arcexplorer.org'],4663:['https://robinhoodchain.blockscout.com']};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url){const t0=Date.now();try{const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});const text=await r.text();let j=null;try{j=JSON.parse(text)}catch{}return {http:r.status,json:j,ms:Date.now()-t0};}catch(e){return {error:e.name,ms:Date.now()-t0}}}
async function rpc(chainId,method,params){const r=await fetch(RPC[chainId],{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20000)});return (await r.json()).result;}
function eip1167(code){const m=/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code||'');return m?'0x'+m[1].toLowerCase():null;}
async function sourcify(chainId,a){const r=await get('https://sourcify.dev/server/v2/contract/'+chainId+'/'+a+'?fields=compilation,runtimeMatch,creationMatch');
 return {http:r.http,runtimeMatch:r.json?.runtimeMatch??null,creationMatch:r.json?.creationMatch??null,language:r.json?.compilation?.language??null,name:r.json?.compilation?.name??null,compiler:r.json?.compilation?.compilerVersion??null};}
async function explorer(chainId,a){const out=[];for(const base of EXPLORERS[chainId]){const r=await get(base+'/api/v2/smart-contracts/'+a);
 out.push({base,http:r.http??r.error,verified:r.json?.is_verified??null,fullyVerified:r.json?.is_fully_verified??null,name:r.json?.name??null,language:r.json?.language??null,compiler:r.json?.compiler_version??null,
  proxyType:r.json?.proxy_type??null,implementations:(r.json?.implementations||[]).map(x=>x.address||x.address_hash).slice(0,3),license:r.json?.license_type??null});await sleep(400);}return out;}
(async()=>{
 for(const [network,chainId,symbol,a] of TARGETS){
  const code=await rpc(chainId,'eth_getCode',[a,'latest']).catch(()=>null);const impl=eip1167(code);
  const row={network,chainId,symbol,address:a,codeBytes:code?(code.length-2)/2:null,codeHash:code?require('node:crypto').createHash('sha256').update(code.toLowerCase()).digest('hex').slice(0,16):null,eip1167Implementation:impl,
   sourcify:await sourcify(chainId,a),explorer:await explorer(chainId,a)};
  if(impl){const ic=await rpc(chainId,'eth_getCode',[impl,'latest']).catch(()=>null);row.implementation={address:impl,codeBytes:ic?(ic.length-2)/2:null,sourcify:await sourcify(chainId,impl),explorer:await explorer(chainId,impl)};}
  console.log('MECH_SOURCE '+JSON.stringify(row));await sleep(800);
 }
})().catch(e=>{console.error(e.name);process.exitCode=1;});
