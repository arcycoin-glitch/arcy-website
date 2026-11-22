'use strict';
// Durable local writes + disk accounting for the holder worker volume (Railway: one persistent volume, ARC_INDEX_CACHE_DIR and
// ARC_HOLDER_PUBLISHED_DIR on it). Three production risks are closed here:
//  1. ENOSPC / crash in the middle of a write left `<file>.<uuid>.tmp` behind forever (the catch never unlinked it) -> orphans
//     accumulate exactly when the disk is already full. atomicWrite() always removes its temp file on failure.
//  2. rename() without fsync can expose an empty/short file after a hard restart. atomicWrite() fsyncs the data before rename and
//     the directory after it (best effort where the platform does not allow a directory fsync).
//  3. No free-space check: a large checkpoint could fill the volume and make EVERY later write (including small completed
//     snapshots) fail. guard() refuses a write unless free space stays above a reserve, so the previous file stays intact.
// report() separates what the volume reports (statfs capacity/free) from what the worker's own files occupy, per category.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const TMP=/\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i;
const reserveBytes=(env=process.env)=>Math.max(8,Math.min(1024,Number(env.ARC_HOLDER_DISK_RESERVE_MB)||64))*1024*1024;
async function freeBytes(dir){try{const s=await fs.statfs(dir);return {capacity:Number(s.blocks)*Number(s.bsize),free:Number(s.bavail)*Number(s.bsize)};}catch{return null;}}
async function guard(dir,bytes,{env=process.env,statfs=freeBytes}={}){
 const s=await statfs(dir);if(!s)return null; // unknown platform: never block on missing telemetry
 const need=reserveBytes(env)+2*bytes;
 if(s.free<need)throw Object.assign(Error('Holder volume free space below reserve'),{code:'STORAGE_LOW_DISK',free:s.free,need});
 return s;
}
async function atomicWrite(file,data,{env=process.env,statfs=freeBytes}={}){
 const dir=path.dirname(file);await fs.mkdir(dir,{recursive:true});
 const body=typeof data==='string'?data:JSON.stringify(data);
 await guard(dir,Buffer.byteLength(body),{env,statfs});
 const tmp=file+'.'+crypto.randomUUID()+'.tmp';let handle;
 try{handle=await fs.open(tmp,'w');await handle.writeFile(body);await handle.sync();await handle.close();handle=null;await fs.rename(tmp,file);}
 catch(e){try{await handle?.close();}catch{}try{await fs.unlink(tmp);}catch{}throw e;}
 try{const d=await fs.open(dir,'r');try{await d.sync();}finally{await d.close();}}catch{}
}
// Remove ONLY temp files written by atomicWrite (exact uuid pattern) older than maxAgeMs. Never touches checkpoints or snapshots.
async function sweepTmp(root,{maxAgeMs=10*60*1000,now=Date.now()}={}){
 let removed=0,bytes=0;
 async function walk(d,depth){let entries;try{entries=await fs.readdir(d,{withFileTypes:true});}catch{return;}
  for(const e of entries){const p=path.join(d,e.name);if(e.isDirectory()&&depth<3)await walk(p,depth+1);
   else if(e.isFile()&&TMP.test(e.name)){try{const st=await fs.stat(p);if(now-st.mtimeMs>maxAgeMs){await fs.unlink(p);removed++;bytes+=st.size;}}catch{}}}}
 await walk(root,0);return {removed,bytes};
}
function category(rel){
 if(TMP.test(rel))return 'orphanTmp';
 if(/(^|\/)refresh-queue\.v2\.json$/.test(rel))return 'queue';
 if(/-candidates\.v2\.json$/.test(rel))return 'candidateCheckpoints';
 if(/\.v2\.json$/.test(rel))return 'ledgerCheckpoints';
 if(/\.json$/.test(rel))return 'other';
 return 'other';
}
async function report(roots,{statfs=freeBytes}={}){
 const out={volumes:{},files:{},largest:[]};
 for(const [label,root] of Object.entries(roots)){if(!root)continue;
  out.volumes[label]=await statfs(root);
  const cats={};async function walk(d,depth){let entries;try{entries=await fs.readdir(d,{withFileTypes:true});}catch{return;}
   for(const e of entries){const p=path.join(d,e.name);if(e.isDirectory()&&depth<3){await walk(p,depth+1);continue;}if(!e.isFile())continue;
    let st;try{st=await fs.stat(p);}catch{continue;}const rel=path.relative(root,p),k=label==='published'?(TMP.test(rel)?'orphanTmp':'publications'):category(rel);
    const c=cats[k]||={files:0,bytes:0};c.files++;c.bytes+=st.size;out.largest.push({label,file:rel.replace(/0x[0-9a-f]{40}/g,a=>a.slice(0,10)+'…'),bytes:st.size});}}
  await walk(root,0);out.files[label]=cats;}
 out.largest=out.largest.sort((a,b)=>b.bytes-a.bytes).slice(0,10);
 return out;
}
module.exports={atomicWrite,guard,sweepTmp,report,freeBytes,reserveBytes,TMP};
