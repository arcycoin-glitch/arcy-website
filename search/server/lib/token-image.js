'use strict';
// Never forward arbitrary project-provided image URLs to visitors.
// Source images are untrusted decoration and NEVER evidence of token authenticity.
const DOMAINS=new Set([
 'coin-images.coingecko.com',
 'assets.coingecko.com',
 'cdn.dexscreener.com',
 'dd.dexscreener.com'
]);
function safeLogoUrl(raw){
 if(typeof raw!=='string'||raw.length>500||raw.length<16)return null;
 try{
  const u=new URL(raw);
  if(u.protocol!=='https:'||!DOMAINS.has(u.hostname)||u.username||u.password||
     u.port||u.hash||u.pathname.length<2)return null;
  if(/[\u0000-\u001f]/.test(raw))return null;
  // Exclude potentially active document content even though the UI uses <img>.
  if(/\.(?:svg|html?|xml|pdf)(?:$|\/)/i.test(u.pathname))return null;
  return u.href;
 }catch{return null}
}
module.exports={safeLogoUrl};
