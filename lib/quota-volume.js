// Atomic, restart-safe ledger on the existing single-replica Holder volume. No checkpoint files are changed.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function apply(b,{dir,now,shape}){
 const file=path.join(dir,'radar-quota.json'),lock=file+'.lock';let held=false;
 try{
  await fs.mkdir(dir,{recursive:true});
  const deadline=Date.now()+1500;
  while(!held){try{await fs.mkdir(lock);held=true;}catch(e){if(e.code!=='EEXIST'||Date.now()>=deadline)throw e;await new Promise(r=>setTimeout(r,20));}}
  let d={version:1,months:{},minute:0,minuteSpent:0,coolUntil:0};
  try{d=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(d.version!==1||!d.months||!Number.isFinite(d.coolUntil)||!Number.isFinite(d.minute)||!Number.isFinite(d.minuteSpent)||Object.values(d.months).some(v=>!Number.isSafeInteger(v)||v<0))throw Error('invalid ledger');
  const t=now(),minute=Math.floor(t/60000),c=d.months[b.month]||0;let result;
  if(b.mode==='cooldown'){d.coolUntil=Math.max(d.coolUntil,t+b.ms);result={ok:true,granted:true,store:'worker-volume'};}
  else if(b.mode==='reserve'&&d.coolUntil>t)return shape(3,d.coolUntil-t,b.cap,'worker-volume',b);
  else if(b.mode==='reserve'&&c+b.credits>b.cap)return shape(0,c,b.cap,'worker-volume',b);
  else{
   if(d.minute!==minute){d.minute=minute;d.minuteSpent=0;}
   if(b.mode==='reserve'&&b.perMinute&&d.minuteSpent+b.credits>b.perMinute)return shape(2,(minute+1)*60000-t,b.cap,'worker-volume',b);
   if(b.mode==='reserve')d.minuteSpent+=b.credits;
   d.months[b.month]=Math.max(0,c+b.credits);result=shape(1,d.months[b.month],b.cap,'worker-volume',b);
  }
  const tmp=file+'.'+crypto.randomUUID()+'.tmp',handle=await fs.open(tmp,'wx');
  try{await handle.writeFile(JSON.stringify(d));await handle.sync();}finally{await handle.close();}
  await fs.rename(tmp,file);return result;
 }catch{return {ok:false,reasonCode:'QUOTA_STORE_UNAVAILABLE'};}
 finally{if(held)await fs.rmdir(lock).catch(()=>{});}
}
module.exports={apply};
