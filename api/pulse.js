async function fetchWithTimeout(url,options={}){return fetch(url,{...options,signal:AbortSignal.timeout(15000)});}

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
  const r=await fetchWithTimeout(url,{headers:{"user-agent":"ARCY-Pulse/1.0"}});
  if(!r.ok) return [];
  const h=await r.text(), items=[];
  const re=/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(h))){
    const title=strip(m[2]);
    if(title.length<18) continue;
    const link=abs(m[1],url);
    if(!link)continue;
    const parsed=new URL(link), source=new URL(url);
    if(parsed.origin!==source.origin || !parsed.pathname.startsWith(source.pathname+"/"))continue;
    if(!/(arc|circle|stable|usdc|mainnet|payment|interop|onramp|fx|token|validator|builder)/i.test(title)) continue;
    items.push({title,url:link,owner:url.includes("circle.com")?"OFFICIAL CIRCLE":"ARC COMMUNITY"});
  }
  return items;
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","s-maxage=3600, stale-while-revalidate=300");
  let items=[];
  for(const s of SOURCES){try{items.push(...await collect(s))}catch(_){}}
  const seen=new Set();
  items=items.filter(x=>{const k=x.url; if(seen.has(k))return false; seen.add(k); return true;}).slice(0,12);
  if(!items.length){res.setHeader("Cache-Control","no-store");return res.status(503).json({ok:false,cards:[],message:"Official updates unavailable"});}
  const chosen=items.slice(0,3);
  const cards=chosen.map((x,i)=>({
    owner:x.owner,
    kind:["week","new","watch"][i],
    title:x.title,
    summary:i===0?"Latest official ecosystem update. Open the source for the full announcement and scope.":i===1?"A new Arc/Circle ecosystem development to watch this week.":"Watch for measurable adoption, liquidity and repeat onchain activity behind this update.",
    url:x.url
  }));
  cards.push({
    owner:"ARCY REALITY CHECK",
    kind:"reality",
    title:"Announcements ≠ sustained usage",
    summary:"ARCY tracks whether new infrastructure translates into users, liquidity, settlement activity and repeat demand.",
    url:"https://www.circle.com/pressroom"
  });
  cards.push({
    owner:"ARCY SIGNAL",
    kind:"signal",
    title:"What to watch next",
    summary:"Watch the next official Arc/Circle ecosystem update and whether it produces measurable onchain activity.",
    url:"https://www.circle.com/pressroom"
  });
  res.status(200).json({ok:true,number:pulseNumber(),updatedAt:new Date().toISOString(),cards,take:"Infrastructure matters, but measurable usage is the test: users, liquidity, settlement activity and repeat demand.",sources:SOURCES});
}
