'use strict';
// A complete, decodable RGBA PNG. No live artwork dependency in unit tests.
const zlib=require('node:zlib');
function png(){
 const chunk=(name,data)=>{
  const type=Buffer.from(name),size=Buffer.alloc(4),crc=Buffer.alloc(4);
  size.writeUInt32BE(data.length);crc.writeUInt32BE(zlib.crc32(Buffer.concat([type,data])));
  return Buffer.concat([size,type,data,crc]);
 };
 const header=Buffer.alloc(13);header.writeUInt32BE(32);header.writeUInt32BE(32,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),
  chunk('IDAT',zlib.deflateSync(Buffer.alloc(32*(1+32*4)))),chunk('IEND',Buffer.alloc(0))]);
}
module.exports={png,response:()=>new Response(png(),{headers:{'content-type':'image/png'}})};
