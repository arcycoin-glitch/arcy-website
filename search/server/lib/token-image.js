'use strict';
// Image URLs are decorative ONLY; chain/contract identity is verified separately.
// Never accept arbitrary explorer/project URLs, inline SVG or executable documents.
// Hotlink only approved image CDN paths, without acting as an open proxy.
const SOURCES=Object.freeze({
 'cdn.dexscreener.com': /^\/(?:cms\/images|ds-data\/tokens|token-images|images)\/[a-z0-9_.\-/%]+$/i,
 'dd.dexscreener.com': /^\/ds-data\/tokens\/[a-z0-9_.\-/%]+$/i,
 'cdn-icons.blockscout.com': /^\/[a-z0-9_.\-/%]+$/i
});
function safeLogoUrl(raw){
 if(typeof raw!=='string'||raw.length>500||raw.length<25)return null;
 try{
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||
   !Object.hasOwn(SOURCES,u.hostname)||!SOURCES[u.hostname].test(u.pathname))return null;
  if(/[\u0000-\u001f\\]/.test(raw)||/%(?:2f|5c|00)/i.test(u.pathname))return null;
  if(/\.(?:svg|html?|xml|pdf|js|mjs|json|php)(?:$|\/)/i.test(u.pathname))return null;
  // Width/quality variants are allowed only where they are numeric.
  if([...u.searchParams].some(([key,value])=>!['width','height','quality','w','h','q','format'].includes(key)||
      (key==='format'?!/^(?:auto|webp|png|jpeg|jpg|avif)$/i.test(value):!/^[0-9]{1,4}$/.test(value))))
   return null;
  return u.href;
 }catch{return null}
}
module.exports={safeLogoUrl};
