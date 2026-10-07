async function fetchWithTimeout(url,options={}){return fetch(url,{...options,signal:AbortSignal.timeout(15000)});}

// First-party sources only. A source's page-wide updated timestamp never becomes
// an article publication date.
const SOURCES=[
  {url:"https://www.arc.network/blog",family:"Official Arc blog",owner:"OFFICIAL ARC",type:"arc-blog"},
  {url:"https://community.arc.io/public/blogs",family:"Official Arc community",owner:"OFFICIAL ARC COMMUNITY",type:"links"},
  {url:"https://www.circle.com/pressroom",family:"Official Circle pressroom",owner:"OFFICIAL CIRCLE",type:"links"},
  {url:"https://www.circle.com/blog",family:"Official Circle blog",owner:"OFFICIAL CIRCLE",type:"links"},
  // Checked as an active Arc-project primary source. Its roadmap milestones
  // are not dated announcements, so they cannot become Pulse items by default.
  {url:"https://arction.app/docs/roadmap",family:"Active Arc project roadmap",owner:"OFFICIAL ARCTION",type:"catalog"}
];

function strip(s=""){return s.replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g," ").trim();}
function abs(href,base){try{return new URL(href,base).href}catch{return ""}}
function publishedAt(title,url){
  const text=[title,new URL(url).pathname].join(" "),matches=[...text.matchAll(/(?:20\d{2}-\d{2}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2})/gi)];
  if(!matches.length)return null;
  const value=matches[0][0].replace(/(\d)(?:st|nd|rd|th)\b/i,"$1");
  if(/^20\d{2}-\d{2}-\d{2}$/.test(value))return new Date(`${value}T00:00:00.000Z`).toISOString();
  const m=value.match(/^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(20\d{2})$/i);
  if(!m)return null;
  const months={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11},day=Number(m[2]),year=Number(m[3]),month=months[m[1].slice(0,3).toLowerCase()],date=new Date(Date.UTC(year,month,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month&&date.getUTCDate()===day?date.toISOString():null;
}
function pulseNumber(){const start=Date.UTC(2026,8,28),now=Date.now();return Math.max(1,Math.floor((now-start)/(7*86400000))+1);}
function cycle(){const now=new Date(),day=(now.getUTCDay()+6)%7,start=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-day);return {start,end:start+7*86400000};}
function inCycle(value,current){const time=Date.parse(value||"");return Number.isFinite(time)&&time>=current.start&&time<current.end;}
function articleJsonLd(html,fallbackUrl){
  for(const script of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{
    const parsed=JSON.parse(strip(script[1])),nodes=Array.isArray(parsed)?parsed:(parsed["@graph"]||[parsed]);
    for(const node of nodes){const types=Array.isArray(node["@type"])?node["@type"]:[node["@type"]];if(types.includes("BlogPosting")&&node.headline&&node.datePublished)return {title:String(node.headline),url:node.mainEntityOfPage||node.url||fallbackUrl,publishedAt:new Date(node.datePublished).toISOString()};}
  }catch(_){}
  return null;
}
async function collect(url,owner=url.includes("circle.com")?"OFFICIAL CIRCLE":"OFFICIAL ARC COMMUNITY"){
  const r=await fetchWithTimeout(url,{headers:{"user-agent":"ARCY-Pulse/1.0"}});if(!r.ok)return [];
  const h=await r.text(),items=[],re=/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(h))){
    const title=strip(m[2]),link=abs(m[1],url);if(title.length<18||!link)continue;
    const parsed=new URL(link),source=new URL(url);if(parsed.origin!==source.origin||!parsed.pathname.startsWith(source.pathname+"/"))continue;
    // Circle/community landing pages contain unrelated entries. A link must
    // explicitly name Arc before it can be considered.
    if(!/\barc\b/i.test(title))continue;
    items.push({title,url:link,publishedAt:publishedAt(title,link),owner});
  }
  return items;
}
async function collectArcBlog(source){
  const r=await fetchWithTimeout(source.url,{headers:{"user-agent":"ARCY-Pulse/1.0"}});if(!r.ok)throw Error(`HTTP ${r.status}`);
  const page=await r.text(),links=[];
  for(const match of page.matchAll(/href=["']([^"']+)["']/gi)){const link=abs(match[1],source.url);if(link&&new URL(link).origin===new URL(source.url).origin&&/^\/blog\/[^/]+/.test(new URL(link).pathname)&&!links.includes(link))links.push(link);}
  // The official listing is reverse chronological. Fetch each canonical recent
  // article to use its own JSON-LD datePublished rather than the listing time.
  const results=await Promise.allSettled(links.slice(0,12).map(async link=>{const article=await fetchWithTimeout(link,{headers:{"user-agent":"ARCY-Pulse/1.0"}});if(!article.ok)return null;const meta=articleJsonLd(await article.text(),link);return meta?{...meta,url:abs(meta.url,link),owner:source.owner}:null;}));
  return results.flatMap(result=>result.status==="fulfilled"&&result.value?[result.value]:[]);
}
async function checkSource(source){
  try{
    if(source.type==="catalog"){const r=await fetchWithTimeout(source.url,{headers:{"user-agent":"ARCY-Pulse/1.0"}});return {items:[],audit:{family:source.family,url:source.url,status:r.ok?"checked":"unavailable",candidates:0}};}
    const items=source.type==="arc-blog"?await collectArcBlog(source):await collect(source.url,source.owner);
    return {items,audit:{family:source.family,url:source.url,status:"checked",candidates:items.length}};
  }catch(_){return {items:[],audit:{family:source.family,url:source.url,status:"unavailable",candidates:0}};}
}
function uniqueCurrent(items,current){
  const seen=new Set(),result=[],rejected={stale:0,duplicate:0,undated:0};
  for(const item of items){
    if(!item.publishedAt){rejected.undated++;continue;}if(!inCycle(item.publishedAt,current)){rejected.stale++;continue;}
    const titleKey=item.title.toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),urlKey=`url:${item.url}`;
    if(seen.has(urlKey)||seen.has(`title:${titleKey}`)){rejected.duplicate++;continue;}seen.add(urlKey);seen.add(`title:${titleKey}`);result.push(item);
  }
  return {items:result.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||a.title.localeCompare(b.title)).slice(0,5),rejected};
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const current=cycle(),checks=await Promise.all(SOURCES.map(checkSource)),selection=uniqueCurrent(checks.flatMap(check=>check.items),current),audit={cycle:{start:new Date(current.start).toISOString(),end:new Date(current.end).toISOString()},sourcesChecked:checks.map(check=>check.audit),acceptedItemCount:selection.items.length,rejected:selection.rejected};
  if(!selection.items.length)return res.status(503).json({ok:false,cards:[],message:"No dated official update is available for the current Pulse cycle.",number:pulseNumber(),generatedAt:new Date().toISOString(),cycle:audit.cycle,sources:SOURCES.map(source=>source.url),audit});
  const cards=selection.items.map((item,index)=>({owner:item.owner,publishedAt:item.publishedAt,kind:["week","new","watch","signal","week"][index],title:item.title,summary:index===0?"Latest official ecosystem update. Open the source for the full announcement and scope.":index===1?"A new Arc ecosystem development to watch this week.":"Watch for measurable adoption, liquidity and repeat onchain activity behind this update.",url:item.url}));
  res.status(200).json({ok:true,number:pulseNumber(),generatedAt:new Date().toISOString(),cycle:audit.cycle,cards,take:"Infrastructure matters, but measurable usage is the test: users, liquidity, settlement activity and repeat demand.",sources:SOURCES.map(source=>source.url),audit});
}
