'use strict';
const fs=require('node:fs');
const tokens=require('../test/fixtures/search-v5-contracts.json');
const original=fetch;let calls=[];
global.fetch=async(url,options)=>{const start=performance.now(),u=new URL(url);let method='GET';try{method=JSON.parse(options?.body||'{}').method||'GET'}catch{}let status;try{const r=await original(url,options);status=r.status;return r}finally{calls.push({host:u.hostname,method,ms:Math.round(performance.now()-start),status:status||'FAILED'});}};
const service=require('../search/server/lib/multichain-service');
(async()=>{const results=[];for(let round=0;round<3;round++)for(const[network,symbol,address]of tokens){calls=[];const start=performance.now();let report,error;try{report=await service.report({network,address})}catch(e){error=e.message}const fields=Object.entries(report?.cards||{}).flatMap(([card,c])=>Object.entries(c.fields).map(([key,f])=>({card,key,...f})));const row={round,network,symbol,address,ms:Math.round(performance.now()-start),available:fields.filter(f=>f.dataState==='DATA_FOUND').length,error,token:report?.token,fields,calls};results.push(row);fs.writeFileSync(process.argv[2],JSON.stringify({profile:'VERCEL production; optional providers gated; no authorization changes',results},null,2));console.log(round,network,symbol,row.ms,row.available,error||'OK')}
})().catch(e=>{console.error(e);process.exitCode=1});
