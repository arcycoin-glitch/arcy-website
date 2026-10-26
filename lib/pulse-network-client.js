'use strict';
const research=require('./pulse-networks'),storage=require('./pulse-network-storage');
function base(queue=false){try{const u=new URL(queue?(process.env.ARC_PULSE_QUEUE_URL||process.env.ARC_HOLDER_QUEUE_URL):(process.env.ARC_PULSE_PUBLISHED_URL||process.env.ARC_HOLDER_PUBLISHED_URL||process.env.ARC_HOLDER_QUEUE_URL));return u.protocol==='https:'?u:null;}catch{return null;}}
const publicKey=()=>process.env.ARC_PULSE_PUBLIC_KEY||process.env.ARC_HOLDER_PUBLIC_KEY;
async function request(path,{queue=false,method='GET',body,timeoutMs=1800}={}){
 const host=base(queue),token=process.env.ARC_PULSE_QUEUE_TOKEN||process.env.ARC_HOLDER_QUEUE_TOKEN;if(!host||queue&&!token)return null;
 const controller=new AbortController();let timer;const deadline=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},timeoutMs);});
 const work=(async()=>{const r=await fetch(new URL(path,host.origin),{method,headers:queue?{authorization:'Bearer '+token,'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal,cache:'no-store'});return r.ok?await require('../search/server/lib/http').readJson(r,512*1024):null;})();
 try{return await Promise.race([work,deadline]);}catch{return null;}finally{clearTimeout(timer);}
}
function unpack(e,c){const key=publicKey();return key?storage.unpack(e,c,key):null;}
const cache=new Map(),pending=new Map();
async function bundle(){
 const key=(base()?.origin||'unconfigured')+'|'+(publicKey()||''),now=Date.now();let entry=cache.get(key);
 if(!entry||entry.expiresAt<=now){
  if(!pending.has(key))pending.set(key,request('/pulse/networks/latest').finally(()=>pending.delete(key)));
  const data=await pending.get(key),chains={},available={};for(const c of Object.keys(research.CONFIG)){const envelope=data?.chains?.[c];available[c]=!!unpack(envelope,c);chains[c]=available[c]?envelope:entry?.chains?.[c]||null;}
  entry={chains,available,expiresAt:now+(Object.values(available).some(Boolean)?60000:5000)};cache.delete(key);cache.set(key,entry);while(cache.size>8)cache.delete(cache.keys().next().value);
 }
 return Object.fromEntries(Object.keys(research.CONFIG).map(c=>{const value=unpack(entry.chains[c],c);return [c,value?{...value,publicationAvailability:entry.available[c]?'SIGNED_PUBLICATION':'LAST_VERIFIED_PUBLICATION'}:research.pending(c)]}));
}
async function edition(chain,number){research.config(chain);if(!Number.isSafeInteger(number)||number<1||number>9999)return null;const value=unpack(await request('/pulse/networks/edition/'+chain+'/'+number),chain);return value?.number===number?value:null;}
async function refresh(trigger){const result=await request('/pulse/networks/refresh',{queue:true,method:'POST',body:{trigger},timeoutMs:30000});const states=Object.fromEntries(Object.keys(research.CONFIG).map(c=>[c,{ok:result?.chains?.[c]?.ok===true&&!!unpack(result.chains[c].edition,c),reasonCode:result?.chains?.[c]?.reasonCode||(result?.chains?.[c]?.ok&&!unpack(result.chains[c].edition,c)?'PULSE_SIGNATURE_INVALID':null)}]));if(Object.values(states).some(x=>x.ok))cache.clear();return states;}
function view(value,{archive=false}={}){if(!value?.success)return value;const current=research.windowFor(),fresh=value.publicationWeek===current.publicationWeek;return {...value,ok:true,isCurrentWeekResearch:false,isLatestWeeklyEdition:fresh&&!archive,reviewPeriodComplete:true,contentNotice:'UTC weekly review: '+value.cycle.start.slice(0,10)+' to '+value.cycle.end.slice(0,10)+(archive?' · ARCHIVE':fresh?' · COMPLETED WEEKLY REVIEW':' · LAST SUCCESSFUL EDITION, NOT CURRENT NEWS'),audit:{...value.audit,nextScheduledAt:research.nextRun()}};}
module.exports={bundle,edition,refresh,view};
