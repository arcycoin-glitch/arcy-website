const SOURCES = [
  "https://www.circle.com/pressroom",
  "https://community.arc.network/public/blogs"
];

function strip(s=""){return s.replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g," ").trim();}
function abs(href,base){try{return new URL(href,base).href}catch{return ""}}
function pulseNumber(){
  const start=Date.UTC(2026,8,29), now=Date.now();
  return Math.max(1,Math.floor((now-start)/(7*86400000))+1);
}
async function collect(url){
  const r=await fetch(url,{headers:{"user-agent":"ARCY-Pulse/1.0"}});
  if(!r.ok) return [];
  const h=await r.text(), items=[];
  const re=/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(h))){
    const title=strip(m[2]);
    if(title.length<18 || title.length>160) continue;
    if(!/(arc|circle|stable|usdc|mainnet|payment|interop|onramp|fx|token|validator|builder)/i.test(title)) continue;
    items.push({title,url:abs(m[1],url)});
  }
  return items;
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","s-maxage=604800, stale-while-revalidate=86400");
  let items=[];
  for(const s of SOURCES){try{items.push(...await collect(s))}catch(_){}}
  const seen=new Set();
  items=items.filter(x=>{const k=x.title.toLowerCase(); if(seen.has(k))return false; seen.add(k); return true;}).slice(0,12);
  const chosen=items.slice(0,3);
  const cards=chosen.map((x,i)=>({
    owner:i===0?"OFFICIAL ARC / CIRCLE":"ARC ECOSYSTEM",
    title:x.title,
    summary:i===0?"Latest official ecosystem update. Open the source for the full announcement and scope.":i===1?"A new Arc/Circle ecosystem development to watch this week.":"Watch for measurable adoption, liquidity and repeat onchain activity behind this update.",
    url:x.url
  }));
  cards.push({
    owner:"ARCY REALITY CHECK",
    title:"Announcements ≠ sustained usage",
    summary:"ARCY tracks whether new infrastructure translates into users, liquidity, settlement activity and repeat demand.",
    url:"https://www.circle.com/pressroom"
  });
  res.status(200).json({ok:true,number:pulseNumber(),updatedAt:new Date().toISOString(),cards,take:"Infrastructure matters, but measurable usage is the test: users, liquidity, settlement activity and repeat demand.",sources:SOURCES});
}