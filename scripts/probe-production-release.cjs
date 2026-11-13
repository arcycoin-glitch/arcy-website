'use strict';
// Public, read-only production acceptance for the 2026-11-07 quality release. ~6 requests, no RPC triggers.
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const H={accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'};
const note=(t,v)=>console.log('::notice title='+t+'::'+JSON.stringify(v).slice(0,3900));
async function get(p,json=true){const t=Date.now();const r=await fetch(BASE+p,{headers:json?H:{accept:'text/html'},signal:AbortSignal.timeout(55000)});const body=json?await r.json().catch(()=>null):await r.text();return {status:r.status,ms:Date.now()-t,body,headers:r.headers};}
(async()=>{
 let failed=0;const fail=(t,m)=>{failed++;console.log('::error title='+t+'::'+m);};
 const home=await get('/',false);
 const badges=(home.body.match(/<div class="badge"[^>]*>\s*([^<]+?)\s*<\/div>/g)||[]).map(x=>x.replace(/<[^>]+>/g,'').trim());
 note('render-static-html',{status:home.status,ms:home.ms,bytes:home.body.length,notConnected:(home.body.match(/NOT CONNECTED/g)||[]).length,badges,pulseFailEvent:(home.body.match(/arcy-pulse-networks-failed/g)||[]).length,vercelId:home.headers.get('x-vercel-id')?'present':null});
 if(/NOT CONNECTED/.test(home.body))fail('render','static HTML still contains NOT CONNECTED');
 const nav=await get('/pulse-chain-navigation.js',false);
 note('render-pulse-nav',{status:nav.status,loading:/Loading verified research/.test(nav.body),notConnected:/NOT CONNECTED/.test(nav.body)});
 const st=await get('/api/search?action=status');
 const c=st.body?.components||{};
 note('status',{http:st.status,ms:st.ms,overall:st.body?.overall,worker:c.holderWorker&&{state:c.holderWorker.state,reason:c.holderWorker.reasonCode,heartbeat:c.holderWorker.heartbeat,backlog:c.holderWorker.backlog,jobs:c.holderWorker.jobs,rpc:c.holderWorker.rpc,lastCompleteSliceAgeSeconds:c.holderWorker.lastCompleteSliceAgeSeconds},
  pulse:c.pulse&&Object.fromEntries(Object.entries(c.pulse).map(([k,v])=>[k,{state:v.state,reason:v.reasonCode,ageHours:v.ageHours,edition:v.edition}])),unlocks:c.unlocks,version:st.body?.version,env:c.searchApi?.environment});
 if(st.status!==200||typeof st.body?.overall!=='string')fail('status','status endpoint missing');
 const p=await get('/api/pulse?chains=all');
 for(const chain of ['ethereum','robinhood']){const v=p.body?.chains?.[chain];note('pulse-live-'+chain,{http:p.status,ms:p.ms,status:v?.status,notice:v?.contentNotice||null,cards:(v?.cards||[]).map(x=>({type:x.contentType,evidence:x.research?.evidence||null,date:x.publishedAt&&String(x.publishedAt).slice(0,10),title:x.title,summary:String(x.summary||'').slice(0,330)}))});}
 note('pulse-live-arc',{number:p.body?.number,status:p.body?.status,cards:(p.body?.cards||[]).slice(0,3).map(x=>({title:x.title,summary:String(x.summary||'').slice(0,260),research:!!x.research}))});
 const u=await get('/api/unlocks');
 note('unlocks',{http:u.status,ms:u.ms,events:u.body?.events?.length,today:u.body?.windows?.today?.length,next7:u.body?.windows?.next7?.length,days8to30:u.body?.windows?.days8to30?.length,independentPublishers:u.body?.coverage?.independentPublishers,generatedAt:u.body?.generatedAt||u.body?.updatedAt,changes:u.body?.changes?u.body.changes.counts:'not yet (worker deploy pending or first diff)'});
 const h=await get('/api/search?action=health');note('health',{http:h.status,ms:h.ms,caps:h.body?.capabilities});
 process.exitCode=failed?1:0;
})().catch(e=>{console.log('::error title=probe::'+e.message);process.exitCode=1;});
