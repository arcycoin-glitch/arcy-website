'use strict';
// Bounded raster validation, not an image proxy. Never inline remote SVG.
const {safeLogoUrl}=require('./token-image'),{registryLogo}=require('./robinhood-assets');
const MAX=256*1024,cache=new Map(),pending=new Map();
function cached(raw,{address,registry=false,now=Date.now()}={}){
 const url=registry?registryLogo(raw,address):safeLogoUrl(raw);if(!url)return null;
 const hit=cache.get(url);return hit&&hit.until>now?hit.value:undefined;
}
function dimensions(b){
 if(b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.toString('ascii',12,16)==='IHDR')return {type:'image/png',width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
 if(b.length>=30&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){
  const kind=b.toString('ascii',12,16);
  if(kind==='VP8X')return {type:'image/webp',width:1+b.readUIntLE(24,3),height:1+b.readUIntLE(27,3)};
  if(kind==='VP8L'&&b[20]===0x2f){const n=b.readUInt32LE(21);return {type:'image/webp',width:1+(n&0x3fff),height:1+((n>>>14)&0x3fff)};}
  if(kind==='VP8 '&&b[23]===0x9d&&b[24]===1&&b[25]===0x2a)return {type:'image/webp',width:b.readUInt16LE(26)&0x3fff,height:b.readUInt16LE(28)&0x3fff};
 }
 if(b.length>=4&&b[0]===0xff&&b[1]===0xd8)for(let i=2;i+4<=b.length;){
  if(b[i++]!==0xff)return null;while(b[i]===0xff)i++;const marker=b[i++];if(marker===0xd9||marker===0xda)return null;if(marker===1||marker>=0xd0&&marker<=0xd7)continue;if(i+2>b.length)return null;const length=b.readUInt16BE(i);if(length<2||i+length>b.length)return null;if([0xc0,0xc1,0xc2].includes(marker)&&length>=7)return {type:'image/jpeg',width:b.readUInt16BE(i+5),height:b.readUInt16BE(i+3)};i+=length;
 }
 return null;
}
async function validate(raw,{address,registry=false,fetcher=global.fetch,now=Date.now(),timeoutMs=1000}={}){
 const url=registry?registryLogo(raw,address):safeLogoUrl(raw);if(!url)return null;
 const hit=cache.get(url);if(fetcher===global.fetch&&hit&&hit.until>now)return hit.value;
 if(fetcher===global.fetch&&pending.has(url))return pending.get(url);
 const work=(async()=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(2000,Math.max(1,timeoutMs)));let value=null;
  try{
   const r=await fetcher(url,{headers:{accept:'image/png,image/jpeg,image/webp'},credentials:'omit',redirect:'error',signal:controller.signal});
   if(!r.ok||r.redirected||r.url&&r.url!==url)throw Error('Image HTTP/redirect rejected');
   const type=r.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
   if(!['image/png','image/jpeg','image/webp'].includes(type)||Number(r.headers.get('content-length'))>MAX)throw Error('Image MIME/size rejected');
   const reader=r.body?.getReader();if(!reader)throw Error('Image body unavailable');const chunks=[];let size=0;
   try{for(;;){const {done,value:chunk}=await reader.read();if(done)break;size+=chunk.byteLength;if(size>MAX){await reader.cancel();throw Error('Image too large');}chunks.push(Buffer.from(chunk));}}finally{reader.releaseLock?.();}
   const d=dimensions(Buffer.concat(chunks,size));
   if(controller.signal.aborted||!d||d.type!==type||d.width<8||d.height<8||d.width>2048||d.height>2048||d.width*d.height>4194304)throw Error('Image signature/dimensions rejected');
   value={url,width:d.width,height:d.height,mime:type,verifiedAt:new Date(now).toISOString()};
  }catch{}finally{clearTimeout(timer);}
  if(fetcher===global.fetch){cache.set(url,{value,until:Date.now()+(value?900000:30000)});while(cache.size>512)cache.delete(cache.keys().next().value);}
  return value;
 })();
 if(fetcher!==global.fetch)return work;pending.set(url,work);try{return await work;}finally{pending.delete(url);}
}
module.exports={validate,cached,dimensions,MAX};
