#!/usr/bin/env node
'use strict';
// READ-ONLY review aid: fetches the Sourcify record of ONE contract, computes the repository's own source digest and
// OZ-template diagnosis, and writes comment-stripped, whitespace-collapsed source text in chunks for human review.
// usage: node scripts/probe-mechanics-sources.cjs CHAIN_ID ADDRESS  -> source-chunks.json
const fs=require('node:fs');
const [chainId,address]=process.argv.slice(2);
const deep=require('../search/server/lib/mechanics-deep'),oz=require('../search/server/lib/oz-template'),lib=require('../search/server/lib/oz-library-hashes');
const crypto=require('node:crypto');const sha=t=>crypto.createHash('sha256').update(t).digest('hex');
const strip=s=>s.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/\/\/[^\n]*/g,'').replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim();
(async()=>{
 const url='https://sourcify.dev/server/v2/contract/'+chainId+'/'+address+'?fields=abi,sources,compilation,runtimeBytecode';
 const r=await fetch(url,{signal:AbortSignal.timeout(30000)});const head={http:r.status,address,chainId};
 const chunks=[];
 if(r.status!==200){chunks.push(JSON.stringify(head));fs.writeFileSync('source-chunks.json',JSON.stringify(chunks));return;}
 const d=await r.json();
 head.runtimeMatch=d.runtimeMatch;head.match=d.match;head.compilation={name:d.compilation?.name,fqn:d.compilation?.fullyQualifiedName,ver:d.compilation?.compilerVersion};
 head.digest=deep.digest(d.sources);
 head.files=Object.entries(d.sources).map(([p,f])=>({p,len:f.content.length,pinned:lib[sha(f.content)]||null}));
 try{head.template=oz.analyze(d.sources,{lib,main:d.compilation?.name})?'ACCEPTED':(oz.diagnose(d.sources,{lib,main:d.compilation?.name})||{}).reason;}catch(e){head.template='ERR '+e.message;}
 head.immutables=d.runtimeBytecode?.immutableReferences?Object.keys(d.runtimeBytecode.immutableReferences).length:0;
 head.abi=(d.abi||[]).filter(f=>f.type==='function'&&!['view','pure'].includes(f.stateMutability)).map(f=>f.name+'('+f.inputs.map(x=>x.type).join(',')+')');
 chunks.push(JSON.stringify(head));
 for(const [p,f] of Object.entries(d.sources)){
  if(lib[sha(f.content)])continue; // pinned unmodified OpenZeppelin file
  const t='=== '+p+'\n'+strip(f.content);
  for(let i=0;i<t.length;i+=3600)chunks.push(t.slice(i,i+3600));
 }
 fs.writeFileSync('source-chunks.json',JSON.stringify(chunks));
})().catch(e=>{fs.writeFileSync('source-chunks.json',JSON.stringify(['ERR '+e.message]));});
