#!/usr/bin/env node
'use strict';
// READ-ONLY: are unverified tokens byte-identical (modulo a few 32-byte words) to a verified sibling on the same chain?
// Also reports Sourcify v2 and Blockscout smart-contract endpoint availability. <= 1 getCode + 2 GETs per address.
const groups=JSON.parse(process.env.SIB_GROUPS||'null')||[
 {chain:'robinhood',chainId:4663,rpc:'https://rpc.mainnet.chain.robinhood.com',bs:'https://robinhoodchain.blockscout.com',ref:'0xaa07a0e9',addrs:['0x6511c2330b0d9e37f3a6c9a63e60eebcda1ec0a1','0xaa07a0e9']}
];
async function rpc(url,method,params){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});const d=await r.json();if(d.error)throw Error(d.error.message);return d.result;}
async function status(u){try{const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});let j=null;try{j=await r.json();}catch{}return {s:r.status,j};}catch(e){return {s:'ERR'};}}
function diff(a,b){const x=Buffer.from(a.slice(2),'hex'),y=Buffer.from(b.slice(2),'hex');if(x.length!==y.length)return {sameLength:false,len:[x.length,y.length]};const runs=[];let i=0;while(i<x.length){if(x[i]!==y[i]){let j=i;while(j<x.length&&x[j]!==y[j])j++;runs.push([i,j-i]);i=j;}else i++;}return {sameLength:true,len:x.length,diffRuns:runs.length,diffBytes:runs.reduce((n,r)=>n+r[1],0),runs:runs.slice(0,12)};}
(async()=>{
 for(const g of groups){
  const codes={};
  for(const a of g.addrs){try{codes[a]=await rpc(g.rpc,'eth_getCode',[a,'latest']);}catch(e){codes[a]=null;}}
  const ref=g.addrs.find(a=>a.startsWith(g.ref));
  for(const a of g.addrs){
   const sf=await status('https://sourcify.dev/server/v2/contract/'+g.chainId+'/'+a+'?fields=runtimeBytecode');
   const bs=g.bs?await status(g.bs+'/api/v2/smart-contracts/'+a):{s:'n/a'};
   const imm=sf.j?.runtimeBytecode?.immutableReferences?Object.values(sf.j.runtimeBytecode.immutableReferences).flat().map(x=>[x.start,x.length]):null;
   const out={chain:g.chain,address:a,codeBytes:codes[a]?(codes[a].length-2)/2:null,sourcify:sf.s,sourcifyMatch:sf.j?.match||sf.j?.runtimeMatch||null,immutableRefs:imm,blockscout:bs.s,blockscoutVerified:bs.j?.is_verified??null,vsRef:a!==ref&&codes[a]&&codes[ref]?diff(codes[ref],codes[a]):null};
   console.log('SIBLING '+JSON.stringify(out));
  }
 }
})();
