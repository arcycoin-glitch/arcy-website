async function fetchWithTimeout(url,options={}){return fetch(url,{...options,signal:AbortSignal.timeout(15000)});}

const SOURCES = [
  "https://www.circle.com/pressroom",
  "https://community.arc.io/public/blogs"
];

function strip(s=""){return s.replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g," ").trim();}
function abs(href,base){try{return new URL(href,base).href}catch{return ""}}
function publishedAt(title,url){
  // A page-level "last published" marker is not an article publication date.
  // Accept dates only when the exact title or canonical article path carries it.
  const text=[title,new URL(url).pathname].join(" ");
  const matches=[...text.matchAll(/(?:20\d{2}-\d{2}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2})/gi)];
  if(!matches.length)return null;
  const sourceDate=matches[0][0].replace(/(\d)(?:st|nd|rd|th)\b/i,"$1");
  if(/^20\d{2}-\d{2}-\d{2}$/.test(sourceDate))return new Date(`${sourceDate}T00:00:00.000Z`).toISOString();
  const m=sourceDate.match(/^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(20\d{2})$/i);
  if(!m)return null;
  const months={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  const day=Number(m[2]),year=Number(m[3]),month=months[m[1].slice(0,3).toLowerCase()],value=Date.UTC(year,month,day);
  const date=new Date(value);
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month&&date.getUTCDate()===day?date.toISOString():null;
}
function pulseNumber(){
  // Editions start on Monday so the Monday cron opens the new weekly cycle.
  const start=Date.UTC(2026,8,28), now=Date.now();
  return Math.max(1,Math.floor((now-start)/(7*86400000))+1);
}
function cycle(){const now=new Date(), day=(now.getUTCDay()+6)%7,start=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-day);return {start,end:start+7*86400000};}
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
    // Circle news is not automatically Arc news. The published item itself
    // must make a concrete Arc connection before it can enter Arc Pulse.
    if(!/\barc\b/i.test(title)) continue;
    items.push({title,url:link,publishedAt:publishedAt(title,link),owner:url.includes("circle.com")?"OFFICIAL CIRCLE":"OFFICIAL ARC COMMUNITY"});
  }
  return items;
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  let items=[];
  for(const s of SOURCES){try{items.push(...await collect(s))}catch(_){}}
  const seen=new Set();
  const current=cycle();
  items=items.filter(x=>{
    const titleKey=x.title.toLowerCase().replace(/(?:20\d{2}-\d{2}-\d{2}|(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2})/gi,"").replace(/[^a-z0-9]+/g," ").trim();
    const urlKey=`url:${x.url}`;
    if(seen.has(urlKey)||seen.has(`title:${titleKey}`))return false;
    seen.add(urlKey);seen.add(`title:${titleKey}`);
    return !!x.publishedAt&&Date.parse(x.publishedAt)>=current.start&&Date.parse(x.publishedAt)<current.end;
  }).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||a.title.localeCompare(b.title)).slice(0,5);
  if(!items.length)return res.status(503).json({ok:false,cards:[],message:"No dated official update is available for the current Pulse cycle.",number:pulseNumber(),generatedAt:new Date().toISOString(),cycle:{start:new Date(current.start).toISOString(),end:new Date(current.end).toISOString()},sources:SOURCES});
  const cards=items.map((x,i)=>({
    owner:x.owner,
    publishedAt:x.publishedAt,
    kind:["week","new","watch","signal","week"][i],
    title:x.title,
    summary:i===0?"Latest official ecosystem update. Open the source for the full announcement and scope.":i===1?"A new Arc/Circle ecosystem development to watch this week.":"Watch for measurable adoption, liquidity and repeat onchain activity behind this update.",
    url:x.url
  }));
  res.status(200).json({ok:true,number:pulseNumber(),generatedAt:new Date().toISOString(),cycle:{start:new Date(current.start).toISOString(),end:new Date(current.end).toISOString()},cards,take:"Infrastructure matters, but measurable usage is the test: users, liquidity, settlement activity and repeat demand.",sources:SOURCES});
}
