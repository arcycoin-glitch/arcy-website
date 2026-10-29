'use strict';
// The Railway image (Dockerfile.holder-worker, repo-root context) contains only what its COPY lines name.
// Unit tests run against the full repo, so they cannot notice a missing file: this test resolves every
// relative require reachable from the container entry scripts against the image contents only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const root=path.join(__dirname,'..');
function copied(){
 const out=[];for(const l of fs.readFileSync(path.join(root,'Dockerfile.holder-worker'),'utf8').split('\n')){
  const m=/^COPY\s+(\S+)\s+(\S+)\s*$/.exec(l.trim());if(m)out.push({src:m[1].replace(/\/$/,''),dst:m[2].replace(/^\.\//,'').replace(/\/$/,'')});}
 return out;
}
function imageFiles(){ // relative path -> source path, as the image would hold them
 const map=new Map();
 const walk=(src,dst)=>{const st=fs.statSync(path.join(root,src));
  if(st.isDirectory())for(const f of fs.readdirSync(path.join(root,src)))walk(path.join(src,f),path.join(dst,f));else map.set(dst,src);};
 for(const c of copied()){const dst=c.dst==='.'||c.dst===''?path.basename(c.src):c.dst;walk(c.src,dst);}
 return map;
}
function resolveIn(files,from,spec){
 const base=path.normalize(path.join(path.dirname(from),spec));
 return [base,base+'.js',base+'.cjs',base+'.json',path.join(base,'index.js')].find(c=>files.has(c));
}
function closure(files,entries){
 const seen=new Set(),missing=[],queue=[...entries];
 while(queue.length){const f=queue.shift();if(seen.has(f))continue;seen.add(f);
  if(!/\.c?js$/.test(f))continue;
  const src=fs.readFileSync(path.join(root,files.get(f)),'utf8');
  for(const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]*)['"]\s*\)/g)){
   const r=resolveIn(files,f,m[1]);if(r)queue.push(r);else missing.push(`${f} -> ${m[1]}`);}}
 return {seen,missing};
}
const ENTRIES=['scripts/holder-worker.cjs','scripts/export-holder-snapshots.cjs'];
test('Dockerfile copies the entry scripts and lib/',()=>{
 const files=imageFiles();for(const e of ENTRIES)assert.ok(files.has(e),e+' is not copied');assert.ok(files.has('package.json'));
 assert.ok(!files.has('search/server/lib/chains.js'),'search/ must not be assumed present in the image');
});
test('every relative require reachable from the image entry scripts resolves inside the image',()=>{
 const {missing}=closure(imageFiles(),ENTRIES);
 assert.deepEqual(missing,[],'files required but absent from the Railway image');
});
test('no lib/ file statically requires outside lib/ (Radar and others stay image-safe)',()=>{
 const files=imageFiles(),bad=[];
 for(const [dst,src] of files)if(dst.startsWith('lib/')&&/\.c?js$/.test(dst)){
  const s=fs.readFileSync(path.join(root,src),'utf8');
  for(const m of s.matchAll(/require\(\s*['"](\.\.\/[^'"]*)['"]\s*\)/g))if(!resolveIn(files,dst,m[1]))bad.push(`${dst} -> ${m[1]}`);}
 // Pre-existing lazy, request-time-only paths are tracked here so a NEW offender fails the test.
 const allowed=new Set(['lib/pulse-network-client.js -> ../search/server/lib/http','lib/coingecko-adapter.js -> ../api/supply','lib/market-sources.js -> ../api/supply']);
 assert.deepEqual(bad.filter(b=>!allowed.has(b)),[]);
});
test('simulated image: Holder HTTP worker boots with Radar disabled and answers, without search/',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arc-image-'));
 for(const [dst,src] of imageFiles()){fs.mkdirSync(path.dirname(path.join(dir,dst)),{recursive:true});fs.copyFileSync(path.join(root,src),path.join(dir,dst));}
 assert.ok(!fs.existsSync(path.join(dir,'search')));
 const port=20000+Math.floor(Math.random()*20000),token='t'.repeat(32);
 const script=`const s=require('./lib/holder-worker-http').start();if(!s)process.exit(3);s.on('listening',async()=>{
  const get=p=>fetch('http://127.0.0.1:${port}'+p,{headers:{authorization:'Bearer ${token}'}}).then(r=>r.status);
  const out={radar:await get('/radar/arc'),unlocks:await get('/unlocks/audit'),queue:await get('/nope')};console.log(JSON.stringify(out));s.close();process.exit(0);});`;
 const r=cp.spawnSync(process.execPath,['-e',script],{cwd:dir,encoding:'utf8',timeout:20000,env:{PATH:process.env.PATH,PORT:String(port),ARC_HOLDER_QUEUE_TOKEN:token,ARC_HOLDER_STORAGE:'local',ARC_INDEX_CACHE_DIR:dir+'/c',ARC_HOLDER_PUBLISHED_DIR:dir+'/p'}});
 fs.rmSync(dir,{recursive:true,force:true});
 assert.equal(r.status,0,r.stderr||r.stdout);
 assert.ok(!/Cannot find module/.test(r.stderr));
 const out=JSON.parse(r.stdout.trim().split('\n').pop());assert.ok(out.queue===404||out.queue===401,JSON.stringify(out));
});
test('simulated image: Radar modules load standalone (enabled path) without search/',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arc-image-'));
 for(const [dst,src] of imageFiles()){fs.mkdirSync(path.dirname(path.join(dir,dst)),{recursive:true});fs.copyFileSync(path.join(root,src),path.join(dir,dst));}
 const r=cp.spawnSync(process.execPath,['-e',"for(const m of ['market-radar-onchain','market-radar-indexer','market-radar-storage','market-radar-http','pons-launch-indexer'])require('./lib/'+m);console.log('ok')"],{cwd:dir,encoding:'utf8',timeout:20000});
 fs.rmSync(dir,{recursive:true,force:true});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/ok/);
});
