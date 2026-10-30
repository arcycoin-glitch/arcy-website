'use strict';
// Proof that docs/audits/proposals/unlocks-single-flight.patch keeps /api/unlocks behaviour identical while cutting CoinBell GETs.
// Usage: node docs/audits/proposals/unlocks-single-flight-proof.cjs   (works on temporary copies in api/, removed afterwards; api/unlocks.js is never modified)
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),api=path.join(root,'api'),oldF=path.join(api,'__proof_old.mjs'),newF=path.join(api,'__proof_new.mjs');
const before=fs.readFileSync(path.join(api,'unlocks.js'),'utf8');
fs.copyFileSync(path.join(api,'unlocks.js'),oldF);
cp.execFileSync('patch',['-s','-o',newF,path.join(api,'unlocks.js'),path.join(__dirname,'unlocks-single-flight.patch')]);
const day=n=>{const d=new Date(Date.now()+n*86400000);return `${String(d.getUTCDate()).padStart(2,'0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;};
const table=rows=>'<table>'+rows.map((r,i)=>`<tr><td>${i+1}</td><td>${r[0]}</td><td>${day(r[1])}</td><td>${r[2]}</td><td>$1.2M</td><td>1.5%</td><td>Team</td></tr>`).join('')+'</table>';
const pages={soonest:table([['Alpha ALP',3,'1.5M ALP'],['Beta BET',5,'2.0M BET']]),impact:table([['Alpha ALP',3,'1.5M ALP'],['Gamma GAM',9,'9M GAM']]),value:table([['Beta BET',5,'2.0M BET'],['Delta DEL',12,'4M DEL']])};
async function scenario(file,{mode,fail=[]}){
 let gets=0;const realFetch=global.fetch;
 global.fetch=async u=>{u=String(u);const m=/coinbell\.in\/token-unlocks\?sort=(\w+)/.exec(u);if(!m)return {ok:false,status:404,json:async()=>({}),text:async()=>''};gets++;await new Promise(r=>setTimeout(r,15));
  if(fail.includes(m[1]))return {ok:false,status:503,text:async()=>''};return {ok:true,status:200,text:async()=>pages[m[1]]};};
 try{
  const mod=await import(file+'?'+Math.random()),out=[];
  const call=async()=>{let status,body;const headers={};const res={setHeader(k,v){headers[k]=v;},status(c){status=c;return this;},json(b){body=b;return this;},end(){}};await mod.default({method:'GET',query:{},headers:{},url:'/api/unlocks'},res);return {status,body,headers};};
  if(mode==='concurrent')out.push(...await Promise.all([1,2,3,4,5].map(call)));else for(let i=0;i<3;i++)out.push(await call());
  return {gets,out};
 }finally{global.fetch=realFetch;}
}
// Only wall-clock timestamps (ISO date-times) are normalised; every other field must match exactly.
const strip=o=>JSON.parse(JSON.stringify(o,(k,v)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(v)?'T':v));
(async()=>{
 try{
  const report=[];
  for(const [name,opts] of [['all-sources-up, 3 sequential',{mode:'seq'}],['all-sources-up, 5 concurrent cold',{mode:'concurrent'}],['one source down, 3 sequential',{mode:'seq',fail:['impact']}],['all sources down, 3 sequential',{mode:'seq',fail:['soonest','impact','value']}]]){
   const a=await scenario(oldF,opts),b=await scenario(newF,opts);
   a.out.forEach((x,i)=>assert.deepEqual(strip(b.out[i]),strip(x),`${name}: response ${i} differs`));
   assert.ok(a.out[0].status===200||a.out[0].status>=400);
   report.push(`${name.padEnd(36)} identical responses: ${a.out.length}/${a.out.length}   CoinBell GETs  before=${a.gets}  after=${b.gets}`);
  }
  console.log(report.join('\n'));
 }finally{fs.rmSync(oldF,{force:true});fs.rmSync(newF,{force:true});assert.equal(fs.readFileSync(path.join(api,'unlocks.js'),'utf8'),before);}
})().catch(e=>{console.error('PROOF FAILED',e.message);process.exitCode=1;});
