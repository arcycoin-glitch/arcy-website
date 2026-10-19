'use strict';
// Real HTTP report path. Compare immutable baseline and candidate sequentially,
// with identical permissions, public providers, token order and sample counts.
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const tokens=require('../test/fixtures/search-v5-contracts.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 for(const [label,directory]of [['before',path.resolve(root,'../arcy-search-v5-baseline')],['after',root]]){
  const rows=[],server=spawn(process.execPath,['dev.cjs'],{cwd:directory,env:{...process.env,PORT:'3151'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  try{
   await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j)});
   for(let round=0;round<3;round++)for(const[network,symbol,address]of tokens){
    const start=performance.now();let response=await fetch('http://127.0.0.1:3151/api/search?action=report&chain='+network+'&address='+address,{signal:AbortSignal.timeout(90000)});
    if(response.status===429){await sleep(Number(response.headers.get('retry-after'))*1000+100);response=await fetch(response.url,{signal:AbortSignal.timeout(90000)})}
    const report=await response.json(),fields=Object.entries(report.cards||{}).flatMap(([card,c])=>Object.entries(c.fields).map(([key,f])=>({card,key,...f})));
    const row={round,network,symbol,address,status:response.status,ms:Math.round(performance.now()-start),available:fields.filter(f=>f.dataState==='DATA_FOUND').length,report};
    rows.push(row);fs.writeFileSync(path.join(root,'artifacts/http-'+label+'.json'),JSON.stringify({profile:'production: existing DEX approval true; GoPlus disabled',results:rows},null,2));
    console.log(label,round,network,symbol,row.ms,row.available,response.status);
   }
  }finally{server.kill();await new Promise(r=>server.once('exit',r));}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
