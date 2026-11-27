#!/usr/bin/env node
'use strict';
// Read-only: prints, VERBATIM, the runtime dispatcher selectors and every Yul function reachable from fun_transfer in the exact
// runtime-matched Sourcify record of TENDIES (4663:0x45242320…fcf9), plus the source digest used by mechanics-deep.
const crypto=require('node:crypto');
(async()=>{
 const url='https://sourcify.dev/server/v2/contract/4663/0x45242320dbb855eea8fd36804c6487e10e97fcf9?fields=sources,compilation,runtimeMatch,runtimeBytecode,abi';
 const d=await (await fetch(url)).json();
 const digest=crypto.createHash('sha256').update(JSON.stringify(Object.entries(d.sources).map(([p,x])=>[p,x.content]).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
 console.log('META '+JSON.stringify({runtimeMatch:d.runtimeMatch,compilation:d.compilation,files:Object.keys(d.sources),digest,abiType:Array.isArray(d.abi)?'array':typeof d.abi,
  runtimeSha256:crypto.createHash('sha256').update(String(d.runtimeBytecode?.onchainBytecode||'').toLowerCase()).digest('hex')}));
 const src=Object.values(d.sources).map(x=>x.content).join('\n');
 const rt=src.slice(src.indexOf('object "NoxaFunTokenV15_514_deployed"')>=0?src.indexOf('object "NoxaFunTokenV15_514_deployed"'):src.lastIndexOf('_deployed'));
 const fn=name=>{const i=rt.indexOf('function '+name+'(');if(i<0)return null;let depth=0,j=rt.indexOf('{',i);for(let k=j;k<rt.length;k++){if(rt[k]==='{')depth++;else if(rt[k]==='}'){depth--;if(!depth)return rt.slice(i,k+1);}}return null;};
 const sw=rt.match(/case 0x[0-9a-f]{8}/g)||[];console.log('SELECTORS '+JSON.stringify([...new Set(sw)]));
 const seen=new Set(),queue=['fun_transfer'];
 while(queue.length){const n=queue.shift();if(seen.has(n))continue;seen.add(n);const body=fn(n);if(!body){console.log('MISSING '+n);continue;}
  console.log('=== '+n+' ===\n'+body);
  for(const m of body.matchAll(/\b(fun_[A-Za-z0-9_]+|modifier_[A-Za-z0-9_]+)\(/g))if(!seen.has(m[1]))queue.push(m[1]);}
 // every sstore and call-family opcode in the runtime object, with surrounding function names
 const ops=[...rt.matchAll(/\b(sstore|call|delegatecall|callcode|staticcall|selfdestruct|create2?)\(/g)].map(m=>m[1]);
 console.log('OPCOUNTS '+JSON.stringify(ops.reduce((a,o)=>(a[o]=(a[o]||0)+1,a),{})));
})().catch(e=>{console.error(e);process.exitCode=1;});
