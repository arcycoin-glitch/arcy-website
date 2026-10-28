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
const cache=new Map(),pending=new Map(),directCache=new Map();
// Read-only official-source fallback. Unsigned weekly reviews never masquerade as
// durable worker publications; Arc's independent signed collector is untouched.
async function directReview(chain){
 if(process.env.ARC_PULSE_DIRECT_FALLBACK==='0')return null;
 const now=Date.now(),prior=directCache.get(chain);
 if(prior&&prior.expiresAt>now)return prior.promise;
 const promise=(async()=>{
  let timer;
  try{
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PULSE_DIRECT_SOURCE_TIMEOUT')),6500);});
   const edition=await Promise.race([research.generate({chain,now,trigger:'read_only_official_source_review',allowPartial:true,sourceTimeoutMs:4500,recentWindow:true}),deadline]);
   return edition?.success?{...edition,publicationAvailability:'DIRECT_OFFICIAL_SOURCES'}:{failed:'PULSE_DIRECT_INVALID'};
  }catch(error){return {failed:/^[A-Z_0-9]{1,80}$/.test(error?.code||'')?error.code:'PULSE_DIRECT_SOURCE_TIMEOUT'};}
  finally{clearTimeout(timer);}
 })();
 const entry={expiresAt:now+60000,promise};directCache.set(chain,entry);
 promise.then(value=>{if(directCache.get(chain)===entry)entry.expiresAt=now+(value?.success&&value.complete!==false?600000:60000);}).catch(()=>{});
 return promise;
}
async function bundle(){
 const key=(base()?.origin||'unconfigured')+'|'+(publicKey()||''),now=Date.now();let entry=cache.get(key);
 if(!entry||entry.expiresAt<=now){
  if(!pending.has(key))pending.set(key,request('/pulse/networks/latest').finally(()=>pending.delete(key)));
  const data=await pending.get(key),chains={},available={};for(const c of Object.keys(research.CONFIG)){const envelope=data?.chains?.[c];available[c]=!!unpack(envelope,c);chains[c]=available[c]?envelope:entry?.chains?.[c]||null;}
  entry={chains,available,expiresAt:now+(Object.values(available).some(Boolean)?60000:5000)};cache.delete(key);cache.set(key,entry);while(cache.size>8)cache.delete(cache.keys().next().value);
 }
 const pairs=await Promise.all(Object.keys(research.CONFIG).map(async c=>{
  const signed=unpack(entry.chains[c],c);
  if(signed)return [c,{...signed,publicationAvailability:entry.available[c]?'SIGNED_PUBLICATION':'LAST_VERIFIED_PUBLICATION'}];
  const direct=await directReview(c);return [c,direct?.success?direct:research.pending(c,direct?.failed||'PULSE_PUBLICATION_UNAVAILABLE')];
 }));
 return Object.fromEntries(pairs);
}
async function edition(chain,number){research.config(chain);if(!Number.isSafeInteger(number)||number<1||number>9999)return null;const value=unpack(await request('/pulse/networks/edition/'+chain+'/'+number),chain);return value?.number===number?value:null;}
async function refresh(trigger){const result=await request('/pulse/networks/refresh',{queue:true,method:'POST',body:{trigger},timeoutMs:30000});const states=Object.fromEntries(Object.keys(research.CONFIG).map(c=>[c,{ok:result?.chains?.[c]?.ok===true&&!!unpack(result.chains[c].edition,c),reasonCode:result?.chains?.[c]?.reasonCode||(result?.chains?.[c]?.ok&&!unpack(result.chains[c].edition,c)?'PULSE_SIGNATURE_INVALID':null)}]));if(Object.values(states).some(x=>x.ok))cache.clear();return states;}
function view(value,{archive=false}={}){if(!value?.success)return value;const current=research.windowFor(),fresh=value.publicationWeek===current.publicationWeek;return {...value,ok:true,isCurrentWeekResearch:false,isLatestWeeklyEdition:fresh&&!archive,reviewPeriodComplete:value.recentWindow!==true,contentNotice:(value.recentWindow?'Recent verified developments: ':'UTC weekly review: ')+value.cycle.start.slice(0,10)+' to '+value.cycle.end.slice(0,10)+(value.complete===false?' · PARTIAL SOURCE COVERAGE':'')+(value.publicationAvailability==='DIRECT_OFFICIAL_SOURCES'?' · DIRECT FIRST-PARTY SOURCE REVIEW · NOT SIGNED/ARCHIVED':archive?' · ARCHIVE':fresh?' · COMPLETED WEEKLY REVIEW':' · LAST SUCCESSFUL EDITION, NOT CURRENT NEWS'),audit:{...value.audit,nextScheduledAt:research.nextRun()}};}
module.exports={bundle,edition,refresh,view};
