'use strict';
async function readJson(response,maxBytes=1024*1024){
 const declared=Number(response.headers?.get?.('content-length'));
 if(Number.isFinite(declared)&&declared>maxBytes)throw Error('Upstream JSON response exceeds size limit');
 if(!response.body||typeof response.body.getReader!=='function')throw Error('Upstream response body unavailable');
 const reader=response.body.getReader(),chunks=[];
 let size=0;
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>maxBytes){await reader.cancel();throw Error('Upstream JSON response exceeds size limit')}
   chunks.push(Buffer.from(value));
  }
 }finally{
  reader.releaseLock?.();
 }
 try{return JSON.parse(Buffer.concat(chunks,size).toString('utf8'))}
 catch{throw Error('Upstream returned malformed JSON')}
}
module.exports={readJson};
