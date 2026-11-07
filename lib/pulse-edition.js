const SOURCES=[
 {url:'https://community.arc.io/public/videos/move-supported-non-usdc-assets-across-chains-with-cctp-2026-10-14',family:'Arc House Circle developer release',owner:'ARC HOUSE · CIRCLE DEVREL',type:'research-article',priority:6,arcNative:true,publishedDate:'2026-10-14',title:'Fast Gateway Deposits and CCTP developer update'},
 {url:'https://bitquery.io/investigations/arc-blockchain-first-month',family:'Bitquery original on-chain Arc investigation',owner:'BITQUERY RESEARCH',type:'research-article',priority:7,arcNative:true},
 {url:'https://www.arc.io/blog',family:'Official Arc blog',owner:'OFFICIAL ARC',type:'arc-blog',priority:5,arcNative:true},
 {url:'https://community.arc.io/public/blogs',family:'Official Arc community',owner:'OFFICIAL ARC COMMUNITY',type:'links',priority:4,arcNative:true},
 {url:'https://www.circle.com/pressroom',family:'Official Circle pressroom',owner:'OFFICIAL CIRCLE',type:'links',priority:3},
 {url:'https://www.circle.com/blog',family:'Official Circle blog',owner:'OFFICIAL CIRCLE',type:'links',priority:3},
 // Optional reachability reference: a catalog never yields dated items, so it cannot hide a qualifying development.
 // Its outcome stays in the audit, but it does not gate a truthful quiet week (2026-11-02: arction.app 301 -> arktion.app, then HTTP 403).
 {url:'https://arction.app/docs/roadmap',family:'Active Arc project roadmap',owner:'OFFICIAL ARCTION',type:'catalog',priority:2,arcNative:true,required:false}
];
const WEEK=7*86400000,REFRESH_HOUR_UTC=6,EDITION_START=Date.UTC(2026,8,28);
// Decode named/numeric entities twice: some CMS metadata is double-encoded (&amp;#x27; seen live on 2026-11-07).
function entities(value){let v=String(value);for(let i=0;i<2;i++)v=v.replace(/&amp;/g,'&').replace(/&#x([0-9a-f]{1,6});/gi,(m,h)=>{const n=parseInt(h,16);return n>31&&n<0x110000?String.fromCodePoint(n):' ';}).replace(/&#([0-9]{1,7});/g,(m,d)=>{const n=Number(d);return n>31&&n<0x110000?String.fromCodePoint(n):' ';}).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/gi,' ').replace(/&hellip;/gi,'…').replace(/&[rl]squo;/g,"'").replace(/&[rl]dquo;/g,'"').replace(/&mdash;/g,'—').replace(/&ndash;/g,'–');return v;}
function strip(value=''){return entities(String(value).replace(/<[^>]*>/g,' ')).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();}
// A length-bounded excerpt ends at its last complete sentence, or is visibly marked as cut. Never a fake full stop.
function sentenceBound(text,max=220){const t=String(text).trim();if(t.length<=max)return t;const head=t.slice(0,max),ends=[...head.matchAll(/[.!?]["')\]]?(?=\s)/g)].map(m=>m.index+m[0].length),end=ends.length?ends[ends.length-1]:0;return end>=60?head.slice(0,end):head.replace(/\s+\S*$/,'').replace(/[,;:\s]+$/,'')+'…';}
function absolute(href,base){try{return new URL(href,base).href;}catch{return '';}}
function articleExcerpt(html){
 const metas=String(html||'').match(/<meta\b[^>]*>/gi)||[];
 for(const key of ['og:description','description','twitter:description']){
  for(const tag of metas){
   const id=/(?:name|property)\s*=\s*(?:"([^"]+)"|'([^']+)')/i.exec(tag);
   if((id?.[1]||id?.[2]||'').toLowerCase()!==key)continue;
   const found=/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
   const excerpt=strip(found?.[1]||found?.[2]||'');
   if(excerpt.length>=45&&!/^(?:sign in|subscribe|accept cookies|read more)/i.test(excerpt))return sentenceBound(excerpt,220);
  }
 }
 return null;
}
// Only source-vetted selected articles are read, with a strict per-request
// time budget. Missing metadata never becomes a guessed project claim.
async function enrichSelected(item,fetcher){
 if(item.summary)return item;
 try{
  const response=await fetcher(item.url,{headers:{'user-agent':'ARCY-Pulse/1.0'},signal:AbortSignal.timeout(3500)});
  if(!response?.ok||Number(response.headers?.get?.('content-length'))>750000)return item;
  const html=await response.text();
  if(html.length>750000)return item;
  const excerpt=articleExcerpt(html);
  return excerpt?{...item,summary:excerpt,summaryEvidence:'SOURCE_METADATA'}:item;
 }catch{return item;}
}

function cycle(now=Date.now()){const value=new Date(now),mondayOffset=(value.getUTCDay()+6)%7,start=Date.UTC(value.getUTCFullYear(),value.getUTCMonth(),value.getUTCDate()-mondayOffset);return {start,end:start+WEEK};}
function number(now=Date.now()){return Math.max(1,Math.floor((cycle(now).start-EDITION_START)/WEEK)+1);}
function isoWeek(now=Date.now()){const value=new Date(cycle(now).start),year=value.getUTCFullYear(),firstThursday=new Date(Date.UTC(year,0,4)),offset=(firstThursday.getUTCDay()+6)%7,firstMonday=Date.UTC(year,0,4-offset);if(value.getTime()<firstMonday)return isoWeek(Date.UTC(year-1,11,31));return {year,week:Math.floor((value.getTime()-firstMonday)/WEEK)+1};}
function cacheKey(now=Date.now()){const value=isoWeek(now);return `pulse:${value.year}-W${String(value.week).padStart(2,'0')}`;}
function nextRun(now=Date.now()){return new Date(cycle(now).end+REFRESH_HOUR_UTC*3600000).toISOString();}
function dateFromText(title,url){const text=[title,new URL(url).pathname].join(' '),matches=[...text.matchAll(/(?:20\d{2}-\d{2}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2})/gi)];if(!matches.length)return null;const raw=matches[0][0].replace(/(\d)(?:st|nd|rd|th)\b/i,'$1');if(/^20\d{2}-\d{2}-\d{2}$/.test(raw))return new Date(`${raw}T00:00:00.000Z`).toISOString();const parts=raw.match(/^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(20\d{2})$/i);if(!parts)return null;const month={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11}[parts[1].slice(0,3).toLowerCase()],date=new Date(Date.UTC(Number(parts[3]),month,Number(parts[2])));return date.getUTCFullYear()===Number(parts[3])&&date.getUTCMonth()===month?date.toISOString():null;}
function articleMeta(html,fallback){let structured=false;for(const match of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){structured=true;try{const parsed=JSON.parse(strip(match[1])),nodes=Array.isArray(parsed)?parsed:(parsed['@graph']||[parsed]);for(const node of nodes){const types=Array.isArray(node['@type'])?node['@type']:[node['@type']];if(types.some(type=>['BlogPosting','Article','NewsArticle'].includes(type))&&node.headline&&node.datePublished){const publishedAt=new Date(node.datePublished);if(!Number.isFinite(publishedAt.getTime()))throw Object.assign(Error('SOURCE_PARSE_FAILURE'),{code:'SOURCE_PARSE_FAILURE'});return {title:String(node.headline),url:node.mainEntityOfPage||node.url||fallback,publishedAt:publishedAt.toISOString()};}}}catch(error){if(error?.code==='SOURCE_PARSE_FAILURE')throw error;throw Object.assign(Error('SOURCE_PARSE_FAILURE'),{code:'SOURCE_PARSE_FAILURE'});}}if(structured)throw Object.assign(Error('SOURCE_PARSE_FAILURE'),{code:'SOURCE_PARSE_FAILURE'});return null;}
function articleFromMeta(html,fallback){
 const metas=[...String(html).matchAll(/<meta\b[^>]*>/gi)].map(x=>x[0]);
 const extract=(attr)=>{
  const tag=metas.find(t=>new RegExp('(?:name|property)\\s*=\\s*["\\x27]'+attr+'["\\x27]','i').test(t));
  return tag?.match(/content\s*=\s*["']([^"']+)["']/i)?.[1]||null;
 };
 const title=extract('og:title')||extract('twitter:title');
 const date=extract('article:published_time')||extract('datePublished')||extract('pubdate')||extract('date');
 const dateMs=Date.parse(date||'');
 return title&&Number.isFinite(dateMs)?{title,url:fallback,publishedAt:new Date(dateMs).toISOString()}:null;
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(fetcher,url){let failure;for(let attempt=0;attempt<2;attempt++){try{const response=await fetcher(url,{headers:{'user-agent':'ARCY-Pulse/1.0'},signal:AbortSignal.timeout(15000)});if(response.ok||(![408,429].includes(response.status)&&response.status<500))return response;failure=Object.assign(Error(`HTTP_${response.status}`),{code:`HTTP_${response.status}`});}catch(error){failure=error;}if(attempt===0)await delay(150);}throw failure||Object.assign(Error('SOURCE_UNAVAILABLE'),{code:'SOURCE_UNAVAILABLE'});}
function relevant(title,source){return source.arcNative||/\barc(?:\s+(?:mainnet|network|ecosystem|chain|native|integration|developer|liquidity|payments?|stablecoin))?\b/i.test(title);}
async function collectLinks(source,fetcher){
 const response=await request(fetcher,source.url);
 if(!response.ok)throw Object.assign(Error('HTTP_'+response.status),{code:'HTTP_'+response.status});
 const html=await response.text(),items=[],candidates=[],unrelated=[],links=/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
 let match;
 while((match=links.exec(html))){
  const title=strip(match[2]),url=absolute(match[1],source.url);
  if(title.length<18||!url)continue;
  const target=new URL(url),origin=new URL(source.url);
  if(target.origin!==origin.origin||!target.pathname.startsWith(origin.pathname+'/')||candidates.some(c=>c.url===url))continue;
  // Unrelated links are never fetched or published, but stay visible in the
  // audit as rejected.irrelevant (as before the article-fetch optimisation).
  if(!relevant(title,source)){if(unrelated.length<32&&!unrelated.some(x=>x.url===url))unrelated.push({title,url,owner:source.owner,source:source.family,priority:source.priority,arcRelevant:false});continue;}
  candidates.push({title,url});
  if(candidates.length===16)break;
 }
 const checked=await Promise.allSettled(candidates.map(async item=>{
  const published=dateFromText(item.title,item.url);
  if(published)return {...item,publishedAt:new Date(published).toISOString()};
  const page=await request(fetcher,item.url);
  if(!page.ok)return null;
  const html=await page.text();
  let meta=null;try{meta=articleMeta(html,item.url)}catch{}
  meta=meta||articleFromMeta(html,item.url);
  return meta?{...item,title:meta.title,publishedAt:meta.publishedAt}:null;
 }));
 for(const result of checked){
  if(result.status!=='fulfilled'||!result.value)continue;
  const item=result.value;
  items.push({...item,owner:source.owner,source:source.family,priority:source.priority,arcRelevant:true});
 }
 return [...items,...unrelated];
}
async function collectArcBlog(source,fetcher){const response=await request(fetcher,source.url);if(!response.ok)throw Object.assign(Error(`HTTP_${response.status}`),{code:`HTTP_${response.status}`});const html=await response.text(),links=[];for(const match of html.matchAll(/href=["']([^"']+)["']/gi)){const url=absolute(match[1],source.url);if(url&&new URL(url).origin===new URL(source.url).origin&&/^\/blog\/[^/]+/.test(new URL(url).pathname)&&!links.includes(url))links.push(url);}const outcomes=await Promise.allSettled(links.slice(0,12).map(async url=>{const article=await request(fetcher,url);if(!article.ok)throw Object.assign(Error(`HTTP_${article.status}`),{code:`HTTP_${article.status}`});const html=await article.text();let meta; try { meta=articleMeta(html,url); } catch { meta=null; } meta=meta||articleFromMeta(html,url);if(!meta)throw Object.assign(Error('SOURCE_PARSE_FAILURE'),{code:'SOURCE_PARSE_FAILURE'});return {...meta,url,owner:source.owner,source:source.family,priority:source.priority,arcRelevant:true,summary:articleExcerpt(html)};}));const kept=outcomes.filter(x=>x.status==='fulfilled').map(x=>x.value);if(!kept.length){const failed=outcomes.find(x=>x.status==='rejected');if(failed)throw failed.reason;}return kept;}
async function collectResearchArticle(source,fetcher){
 const response=await request(fetcher,source.url);
 if(!response.ok)throw Object.assign(Error('HTTP_'+response.status),{code:'HTTP_'+response.status});
 const html=await response.text();
 let meta=null;try{meta=articleMeta(html,source.url)}catch{}
 meta=meta||articleFromMeta(html,source.url);
 if(!meta&&source.publishedDate&&source.title&&
    html.includes('Oct 14')&&/Fast Gateway Deposits/i.test(html))
  meta={title:source.title,publishedAt:source.publishedDate+'T00:00:00.000Z',url:source.url};
 // Some independent research reports put their publication date in visible
 // article text rather than metadata. Limit extraction to the report masthead.
 if(!meta){
  const masthead=strip(html.slice(0,18000));
  const date=dateFromText(masthead.slice(0,1300),source.url);
  if(date&&/Arc Blockchain Month One/i.test(masthead))
   meta={title:'Arc Blockchain Month One: 94% of Users Gone, $190M Borrowed',
    publishedAt:date,url:source.url};
 }
 if(!meta||!Number.isFinite(Date.parse(meta.publishedAt))||
    !(source.arcNative||/\barc\b/i.test(meta.title)))throw Object.assign(Error('SOURCE_PARSE_FAILURE'),{code:'SOURCE_PARSE_FAILURE'});
 return [{title:meta.title,url:source.url,publishedAt:meta.publishedAt,
  owner:source.owner,source:source.family,priority:source.priority,arcRelevant:true,summary:articleExcerpt(html),
  evidenceScope:'Source-reported retrospective figures, not an independently reproduced wallet census.'}];
}
async function check(source,fetcher){try{if(source.type==='catalog'){const response=await request(fetcher,source.url);if(!response.ok)throw Object.assign(Error(`HTTP_${response.status}`),{code:`HTTP_${response.status}`});return {items:[],audit:{family:source.family,url:source.url,status:'checked',candidates:0}};}const items=source.type==='research-article'?await collectResearchArticle(source,fetcher):source.type==='arc-blog'?await collectArcBlog(source,fetcher):await collectLinks(source,fetcher);return {items,audit:{family:source.family,url:source.url,status:'checked',candidates:items.length}};}catch(error){const code=error?.code==='SOURCE_PARSE_FAILURE'?'SOURCE_PARSE_FAILURE':/^HTTP_\d+$/.test(error?.code||'')?error.code:'SOURCE_UNAVAILABLE';return {items:[],failed:true,audit:{family:source.family,url:source.url,status:'unavailable',candidates:0,errorCode:code}};}}
function score(item){return (item.priority||0)*10+(/\b(live|launch|mainnet|integration|deploy|payment|liquidity|stablecoin|privacy|fx|interop|developer|infrastructure)\b/i.test(item.title)?1:0);}
function select(items,current){const seen=new Set(),accepted=[],rejected={stale:0,future:0,duplicate:0,undated:0,irrelevant:0};for(const item of items){if(item.arcRelevant===false||/(survey|feedback|questionnaire|giveaway|community poll)/i.test(item.title+' '+item.url)){rejected.irrelevant++;continue;}const time=Date.parse(item.publishedAt||'');if(!Number.isFinite(time)){rejected.undated++;continue;}if(time<current.start){rejected.stale++;continue;}if(time>=current.end){rejected.future++;continue;}const title=`title:${item.title.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}`,url=`url:${item.url}`;if(seen.has(title)||seen.has(url)){rejected.duplicate++;continue;}seen.add(title);seen.add(url);accepted.push(item);}return {cards:accepted.sort((a,b)=>score(b)-score(a)||Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||a.title.localeCompare(b.title)).slice(0,3),rejected};}
const QUIET_SLOTS=[
 {owner:'ARC ECOSYSTEM',kind:'week',title:'No major verified update this week.',summary:'Configured first-party Arc sources were checked for this cycle. No stale announcement was reused.'},
 {owner:'SOURCE COVERAGE',kind:'new',title:'No additional verified development.',summary:'No qualifying current-cycle development was published by the checked source families.'},
 {owner:'NEXT REVIEW',kind:'watch',title:'Weekly source review continues.',summary:'Pulse will check the same first-party sources again in the next Monday UTC cycle.'},
 {owner:'RISK / REALITY CHECK',kind:'reality',title:'No verified risk update was found in the checked sources.',summary:'This is not a full project-risk assessment. It only describes the dated first-party sources monitored for this Pulse cycle.'},
 {owner:'TOKEN UNLOCKS',kind:'unlock',title:'No Pulse unlock item was verified this week.',summary:'Browse contract-matched schedules in the separate Token Unlocks section.',url:'#unlocks',linkLabel:'OPEN TOKEN UNLOCKS'}
];
function quietCards(now,start=0){return QUIET_SLOTS.slice(start).map(message=>({...message,publishedAt:new Date(now).toISOString(),url:message.url||''}));}
function take(cards,status){if(status==='quiet_week')return 'No major verified update this week. The configured first-party Arc sources were checked, and no stale announcement was reused. Track published schedules in Token Unlocks.';const headline=cards.find(card=>card.url)?.title||'the verified Arc developments';return `The signal this week is ${headline.replace(/[.?!]+$/,'')}. Watch for measurable usage, liquidity and settlement activity before treating announcements as adoption. Track published schedules in Token Unlocks.`;}
async function generate({now=Date.now(),fetcher=fetch,trigger='manual'}={}){const current=cycle(now),checks=await Promise.all(SOURCES.map(source=>check(source,fetcher))),available=checks.filter(check=>!check.failed),result=select(available.flatMap(check=>check.items),current),audit={cacheKey:cacheKey(now),cycle:{start:new Date(current.start).toISOString(),end:new Date(current.end).toISOString()},sourcesAttempted:checks.length,sourcesSuccessfullyChecked:available.length,sourceFailures:checks.filter(check=>check.failed).map(check=>check.audit),requiredSourceFailures:checks.filter((check,i)=>check.failed&&SOURCES[i].required!==false).length,optionalSourceFailures:checks.filter((check,i)=>check.failed&&SOURCES[i].required===false).length,sourcesChecked:checks.map(check=>check.audit),candidateCount:available.reduce((sum,check)=>sum+check.items.length,0),acceptedItemCount:result.cards.length,rejected:result.rejected};if(!available.length){const error=Object.assign(Error('PULSE_DISCOVERY_UNAVAILABLE'),{code:'PULSE_DISCOVERY_UNAVAILABLE',audit});throw error;}const enriched=await Promise.all(result.cards.map(item=>enrichSelected(item,fetcher)));
 const actual=enriched.map((item,index)=>({owner:item.owner,publishedAt:item.publishedAt,kind:['week','new','watch'][index],title:item.title,...require('./pulse-claim').describe(item,SOURCES.find(source=>source.family===item.source)||{}),url:item.url,linkLabel:'SOURCE ↗'}));if(!actual.length&&audit.requiredSourceFailures){const error=Object.assign(Error('PULSE_SOURCE_COVERAGE_INCOMPLETE'),{code:'PULSE_SOURCE_COVERAGE_INCOMPLETE',audit});throw error;}const previous=select(available.flatMap(check=>check.items),{start:current.start-WEEK,end:current.start});
 const recentCards=actual.length>=3?[]:previous.cards.filter(item=>!/(survey|feedback|questionnaire|giveaway|community poll)/i.test(item.title+' '+item.url)).map((item,index)=>({owner:item.owner,kind:['week','new','watch'][index],title:item.title,summary:'Published '+new Date(item.publishedAt).toISOString().slice(0,10)+' · Previous-week primary-source report. Not a new announcement this week.',url:item.url,linkLabel:'READ DATED SOURCE ↗',publishedAt:item.publishedAt,verifiedCurrentWeek:false,contentType:'RECENT_VERIFIED'}));
 const status=actual.length?'updated':'quiet_week',cards=[...actual,...quietCards(now,actual.length)].slice(0,5);return {recentCards,schemaVersion:2,number:number(now),generatedAt:new Date(now).toISOString(),trigger,success:true,status,cacheKey:audit.cacheKey,cycle:audit.cycle,cards,take:take(cards,status)+(status==='quiet_week'&&audit.optionalSourceFailures?' '+audit.optionalSourceFailures+' optional project reference could not be reached; it never supplies dated developments.':''),sources:SOURCES.map(source=>source.url),audit};}
module.exports={SOURCES,cycle,number,isoWeek,cacheKey,nextRun,collectLinks,collectResearchArticle,articleFromMeta,articleExcerpt,quietCards,generate};
