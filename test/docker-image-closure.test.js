'use strict';
// The Railway worker image contains only what Dockerfile.holder-worker copies. Every relative require() that is
// statically reachable from the worker entry scripts (including lazy requires inside functions) must resolve inside
// that set, otherwise the container fails at runtime with MODULE_NOT_FOUND while every repository-layout test passes.
// (Production, 2026-11-11: lib/pulse-onchain needed search/server/lib, which the image did not contain.)
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
// Modules that are optional by design: looked up only behind an explicit feature flag and absent from the repository.
const OPTIONAL=new Set(['lib/market-radar-http']);
function copied(){
 const out=[];
 for(const line of fs.readFileSync(path.join(root,'Dockerfile.holder-worker'),'utf8').split('\n')){
  const m=/^COPY\s+(\S+)\s+(\S+)\s*$/.exec(line.trim());if(!m)continue;
  const source=m[1].replace(/^\.\//,''),target=m[2].replace(/^\.\//,'').replace(/\/$/,'');
  // This guard assumes the image mirrors the repository layout; a renamed target would need a real mapping.
  assert.ok(target===''||target===source||target==='.'&&!source.includes('/'),'COPY must preserve the repository path: '+line);
  out.push(source);
 }
 return out;
}
const inImage=(rel,sources)=>sources.some(s=>rel===s||rel.startsWith(s+'/'));
function resolve(from,request){
 const base=path.join(path.dirname(from),request);
 for(const candidate of [base,base+'.js',base+'.cjs',base+'.json',path.join(base,'index.js')])if(fs.existsSync(candidate)&&fs.statSync(candidate).isFile())return candidate;
 return null;
}
function closure(entries,sources){
 const seen=new Set(),missing=[],queue=entries.map(e=>path.join(root,e));
 while(queue.length){
  const file=queue.pop();if(seen.has(file))continue;seen.add(file);
  if(!/\.(?:c?js)$/.test(file))continue;
  const text=fs.readFileSync(file,'utf8');
  for(const m of text.matchAll(/require\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g)){
   const target=resolve(file,m[2]),rel=path.relative(root,target||path.join(path.dirname(file),m[2])).split(path.sep).join('/');
   if(OPTIONAL.has(rel.replace(/\.js$/,'')))continue;
   if(!target){missing.push({from:path.relative(root,file),request:m[2],reason:'NOT_IN_REPOSITORY'});continue;}
   if(!inImage(rel,sources)){missing.push({from:path.relative(root,file),request:m[2],reason:'NOT_COPIED_INTO_IMAGE'});continue;}
   queue.push(target);
  }
 }
 return {files:seen.size,missing};
}
test('every require reachable from the worker entry scripts exists inside the Docker image',()=>{
 const sources=copied();
 assert.ok(sources.includes('lib')&&sources.includes('scripts/holder-worker.cjs'));
 const result=closure(['scripts/holder-worker.cjs','scripts/export-holder-snapshots.cjs'],sources);
 assert.ok(result.files>40,'closure too small: '+result.files);
 assert.deepEqual(result.missing,[]);
});
test('the on-chain Pulse monitor and its RPC helpers are part of that closure',()=>{
 const sources=copied();
 for(const file of ['lib/pulse-worker-refresh.js','lib/pulse-onchain/monitor.js','lib/pulse-onchain/rpc.js','search/server/lib/chains.js','search/server/lib/rpc-errors.js','search/server/lib/arc-rpc.js','search/server/lib/robinhood-rpc.js'])
  assert.ok(inImage(file,sources)&&fs.existsSync(path.join(root,file)),file);
 // No website, API route, test, secret or data file is pulled into the image by the broader copy.
 for(const source of sources)assert.ok(!/^(?:api|test|tests|data|docs|assets|\.github|\.env)/.test(source)&&!/\.(?:html|css|png)$/.test(source),source);
});
