'use strict';
// Issue #279 V5 — read already-published Radar snapshots from a data-branch git clone (CI/builder only; never in a visitor request).
// Each revision is a real, timestamped snapshot that was validated before it was published. Used once to seed market memory.
const path=require('node:path'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
function publishedSnapshots(snapshotPath,{limit=42}={}){
 if(!snapshotPath)return {docs:[],status:'NO_PATH'};
 const root=path.resolve(path.dirname(snapshotPath),'..');
 if(!fs.existsSync(path.join(root,'.git')))return {docs:[],status:'NOT_A_CLONE'};
 const rel=path.relative(root,path.resolve(snapshotPath));
 try{
  const shas=execFileSync('git',['-C',root,'log','-n',String(limit),'--format=%H','--',rel],{encoding:'utf8'}).split('\n').filter(x=>/^[0-9a-f]{40}$/.test(x));
  const docs=[];for(const h of shas){try{docs.push(JSON.parse(execFileSync('git',['-C',root,'show',h+':'+rel],{encoding:'utf8',maxBuffer:16e6})));}catch{}}
  return {docs,status:'READ_'+docs.length+'_OF_'+shas.length};
 }catch{return {docs:[],status:'GIT_UNAVAILABLE'};}
}
module.exports={publishedSnapshots};
