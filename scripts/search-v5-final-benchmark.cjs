'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),label=process.argv[2],baseline=label==='before';
if(!['before','after'].includes(label))throw Error('Expected before or after');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const rows=[],server=spawn(process.execPath,['dev.cjs'],{cwd:baseline?path.resolve(root,'../arcy-search-v5-baseline'):root,env:{...process.env,PORT:'3162'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j)});
  async function response(url){let r=await fetch(url,{signal:AbortSignal.timeout(90000)});if(r.status===429){await sleep(Number(r.headers.get('retry-after'))*1000+100);r=await fetch(url,{signal:AbortSignal.timeout(90000)})}return r}
  for(let round=0;round<3;round++)for(const[network,symbol,address]of require('../test/fixtures/search-v5-contracts.json')){
   const start=performance.now(),r=await response('http://127.0.0.1:3162/api/search?action='+(baseline?'report':'progress')+'&chain='+network+'&address='+address);
   const row={round,network,symbol,address,status:r.status,events:[]};let report;
   if(!baseline&&r.ok){let buffer='';const decoder=new TextDecoder();for await(const chunk of r.body){buffer+=decoder.decode(chunk,{stream:true});let index;while((index=buffer.indexOf('\n'))!==-1){const text=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!text)continue;const event=JSON.parse(text);row.events.push({phase:event.phase,ms:Math.round(performance.now()-start),availableFields:Object.values(event.report?.cards?.[event.phase]?.fields||{}).filter(f=>f.dataState==='DATA_FOUND'&&f.freshness?.state!=='LAST_VERIFIED'&&f.status!=='HISTORICAL_ONCHAIN_VERIFIED').length});if(event.report)report=event.report;}}}
   else report=await r.json();
   row.fullMs=Math.round(performance.now()-start);row.ok=report?.ok===true&&(baseline||row.events.at(-1)?.phase==='complete');
   row.firstUsefulMs=baseline?row.fullMs:row.events.find(e=>e.phase==='identity')?.ms;
   row.marketMs=baseline?row.fullMs:row.events.find(e=>['activity','liquidity'].includes(e.phase)&&e.availableFields>0)?.ms;
   row.available=Object.values(report?.cards||{}).flatMap(c=>Object.values(c.fields)).filter(f=>f.dataState==='DATA_FOUND').length;
   row.report=report;
   const discoveryStart=performance.now(),discovery=await response('http://127.0.0.1:3162/api/search?action=discover&chain='+network+'&q='+symbol);const candidates=await discovery.json();
   row.autocompleteMs=Math.round(performance.now()-discoveryStart);row.autocompleteStatus=discovery.status;row.exactMatch=Boolean(candidates.matches?.some(m=>m.address===address));
   rows.push(row);fs.writeFileSync(path.join(root,'artifacts/final-'+label+'.json'),JSON.stringify({profile:{vercel:process.env.VERCEL,existingDexApproval:process.env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED==='true',goPlus:process.env.GOPLUS_PUBLIC_DISPLAY_APPROVED==='true'},results:rows},null,2));
   console.log(label,round,network,symbol,'first',row.firstUsefulMs,'market',row.marketMs,'full',row.fullMs,'autocomplete',row.autocompleteMs,'metrics',row.available,r.status);
   await sleep(Math.max(1500,6000-(performance.now()-start)));
  }
 }finally{server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
