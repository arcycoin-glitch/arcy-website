'use strict';
// Radar Intelligence — Snapshot governance proposals for a REGISTERED snapshot space (issue #279).
// One bounded GraphQL POST to hub.snapshot.org per registered space per refresh. A proposal is a dated public event only
// when it is pending/active in the registered space and its vote closes inside the next 90 days. Proposal titles are
// author-supplied text: they are reported verbatim (truncated) and never interpreted as a promise of a listing or price.
const F=require('./fetch');
const DAY=86400000,ID=/^0x[0-9a-f]{64}$|^[A-Za-z0-9]{10,80}$/;
const QUERY='query($space:String!){proposals(first:10,skip:0,where:{space:$space},orderBy:"created",orderDirection:desc){id title start end state space{id}}}';
async function proposals({space,now,o}){
 const body=await F.json('https://hub.snapshot.org/graphql',{...o,method:'POST',body:{query:QUERY,variables:{space}}});
 const list=Array.isArray(body?.data?.proposals)?body.data.proposals:null;
 if(!list)return {ok:false,reason:'SNAPSHOT_SCHEMA_INVALID'};
 const items=list.filter(p=>p&&ID.test(String(p.id))&&p.space?.id===space&&['pending','active'].includes(p.state)&&Number.isSafeInteger(p.end)&&Number.isSafeInteger(p.start)&&p.start<p.end)
  .map(p=>({id:p.id,title:String(p.title||'').slice(0,120),startAt:new Date(p.start*1000).toISOString(),endAt:new Date(p.end*1000).toISOString(),state:p.state,
   url:'https://snapshot.box/#/s:'+space+'/proposal/'+p.id}));
 return {ok:true,items};
}
function classify(items,{now,chainId,address,space}){
 const next=(items||[]).filter(p=>Date.parse(p.endAt)>now&&Date.parse(p.endAt)<=now+90*DAY).sort((a,b)=>Date.parse(a.endAt)-Date.parse(b.endAt))[0];
 if(!next)return null;
 const title=next.title.length>=8?next.title:'(untitled proposal)';
 return {chainId,address,sourceUrl:next.url,observedAt:new Date(now).toISOString(),status:'CONFIRMED_PUBLIC_EVENT',publisherVerified:true,kind:'GOVERNANCE_VOTE',
  evidenceClass:'REGISTERED_SNAPSHOT_SPACE',eventAt:next.endAt,claim:('Snapshot vote in registered space '+space+' closes '+next.endAt.slice(0,10)+': "'+title+'".').slice(0,240)};
}
module.exports={proposals,classify,QUERY};
