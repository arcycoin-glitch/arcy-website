'use strict';
// Independent first-party weekly reviews. Arc's collector and issue history are untouched.
const WEEK=604800000,START=Date.UTC(2026,9,26);
const CONFIG=Object.freeze({
 ethereum:{chainId:1,label:'Ethereum',sources:[
  {url:'https://blog.ethereum.org/en/feed.xml',type:'rss',owner:'ETHEREUM FOUNDATION',host:'blog.ethereum.org'},
  {url:'https://api.github.com/repos/ethereum/go-ethereum/releases?per_page=10',type:'releases',owner:'GO ETHEREUM · OFFICIAL RELEASE',host:'github.com'}]},
 robinhood:{chainId:4663,label:'Robinhood Chain',sources:[
  {url:'https://robinhood.com/newsroom/category/crypto/',type:'newsroom',owner:'OFFICIAL ROBINHOOD',host:'robinhood.com',redirectHosts:['robinhood.com','www.robinhood.com']},
  {url:'https://docs.robinhood.com/chain/connecting/',type:'network',owner:'ROBINHOOD CHAIN DOCUMENTATION',host:'docs.robinhood.com'},
  {url:'https://investors.robinhood.com/press-releases',type:'ir',owner:'ROBINHOOD MARKETS · OFFICIAL INVESTOR RELATIONS',host:'investors.robinhood.com'}]}
});
function config(chain){if(!Object.hasOwn(CONFIG,chain))throw Object.assign(Error('Unsupported Pulse chain'),{code:'INVALID_PULSE_CHAIN'});return CONFIG[chain];}
function windowFor(now=Date.now()){
 const d=new Date(now);if(!Number.isFinite(d.getTime()))throw Error('INVALID_PULSE_TIME');
 const start=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7);
 return {publicationWeek:new Date(start).toISOString(),start:new Date(start-WEEK).toISOString(),end:new Date(start).toISOString(),number:Math.floor((start-START)/WEEK)+1};
}
function nextRun(now=Date.now()){const w=windowFor(now),monday=Date.parse(w.publicationWeek)+21600000;return new Date(now<monday?monday:monday+WEEK).toISOString();}
function clean(s=''){return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<!--[\s\S]*?-->/g,'').replace(/```[\s\S]*?```/g,'').replace(/<[^>]*>/g,' ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#(?:39|x27);/g,"'").replace(/\s+/g,' ').trim();}
function summary(text){return clean(text).slice(0,260).replace(/\s+\S*$/,'').trim();}
function publicationTime(value){
 if(typeof value!=='string')return NaN;const iso=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(value);
 if(iso){const [,y,m,d,h='0',minute='0',second='0']=iso,date=new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));if(date.getUTCFullYear()!==Number(y)||date.getUTCMonth()+1!==Number(m)||date.getUTCDate()!==Number(d)||Number(h)>23||Number(minute)>59||Number(second)>59)return NaN;}
 return Date.parse(value);
}
function officialUrl(value,source){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hostname!==source.host)return null;if(source.type==='releases'&&!u.pathname.startsWith('/ethereum/go-ethereum/releases/'))return null;if(source.type==='ir'&&!/^\/news-releases\/news-release-details\/[a-z0-9-]{3,160}\/?$/.test(u.pathname))return null;if(source.type==='newsroom'&&!/^\/(?:us\/en\/)?newsroom\/[^/]+\/?$/.test(u.pathname))return null;u.hash='';for(const key of [...u.searchParams.keys()])if(key.startsWith('utm_'))u.searchParams.delete(key);return u.href;}catch{return null;}}
function rss(text,source){if(!/<rss\b/i.test(text)||!/<channel\b/i.test(text)||!/<\/rss>/i.test(text))throw Error('SOURCE_PARSE_FAILURE');return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,30).map(([,item])=>{const get=tag=>clean(item.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+tag+'>','i'))?.[1]||'');return {title:get('title'),url:get('link'),publishedAt:get('pubDate'),summary:summary(item.match(/<description>([\s\S]*?)<\/description>/i)?.[1]),owner:source.owner};});}
function releases(data,source){if(!Array.isArray(data))throw Error('SOURCE_PARSE_FAILURE');return data.filter(x=>!x.draft).slice(0,10).map(x=>({title:'Go Ethereum '+String(x.name||x.tag_name||''),url:x.html_url,publishedAt:x.published_at,summary:summary(x.body),owner:source.owner+(x.prerelease?' · PRE-RELEASE':''),whyItMatters:'Client release evidence; not proof that operators have upgraded or that a fork is active on mainnet.'}));}
function newsroom(text,source){const raw=text.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];if(!raw)throw Error('SOURCE_PARSE_FAILURE');const data=JSON.parse(raw),items=data?.props?.pageProps?.articlesCollection?.items;if(!Array.isArray(items))throw Error('SOURCE_PARSE_FAILURE');return items.map(x=>x.fields).filter(Boolean).filter(x=>/\brobinhood chain\b/i.test(x.title+' '+(x.seo?.fields?.seoDescription||''))).map(x=>({title:clean(x.title),url:'https://robinhood.com/newsroom/'+x.slug+'/',publishedAt:x.publishDate,summary:summary(x.seo?.fields?.seoDescription),owner:source.owner,whyItMatters:'A first-party chain announcement; deployment, liquidity and adoption claims require separate on-chain evidence.'}));}

const GETH_ATOM='https://github.com/ethereum/go-ethereum/releases.atom';
function atom(text,source){
 if(!/<feed\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(text)||!/<\/feed>/i.test(text))throw Error('SOURCE_PARSE_FAILURE');
 return [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0,10).map(([,entry])=>{
  const tag=t=>entry.match(new RegExp('<'+t+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+t+'>','i'))?.[1]||'';
  const href=entry.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1]||'';
  return {title:'Go Ethereum '+clean(tag('title')),url:href,publishedAt:clean(tag('updated')),
   summary:summary(tag('content')),owner:source.owner+' · OFFICIAL RELEASE FEED',
   whyItMatters:'Dated client release; does not establish mainnet activation.'};
 });
}
function irLinks(html,source){
 const seen=new Set(),result=[];
 for(const [,href,titleHtml] of String(html).matchAll(/<a\b[^>]*href=["']([^"']*\/news-releases\/news-release-details\/[a-z0-9-]{3,160}\/?)(?:[?#][^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi)){
  let url;try{url=new URL(href,source.url).href;}catch{continue;}
  if(!officialUrl(url,source)||seen.has(url)||clean(titleHtml).length<8)continue;
  seen.add(url);result.push({url,title:clean(titleHtml)});
 }
 if(!result.length)throw Object.assign(Error('SOURCE_PARSE_FAILURE'),{code:'SOURCE_PARSE_FAILURE'});
 return result;
}
function irRelease(html,link,source){
 const text=clean(String(html).replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' '));
 const dateline=/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(202[6-9])\s*\(GLOBE NEWSWIRE\)/i.exec(text);
 if(!dateline)return null;
 const months={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
 const month=months[dateline[1].slice(0,3).toLowerCase()],day=Number(dateline[2]),year=Number(dateline[3]),date=new Date(Date.UTC(year,month,day));
 if(date.getUTCDate()!==day)return null;
 const before=text.split(/Cautionary Note Regarding Forward-Looking Statements|Forward-Looking Statements|Safe Harbor Statement/i)[0];
 const sentences=before.match(/[^.!?]{15,300}[.!?]/g)||[];
 const evidence=sentences.filter(x=>/\bRobinhood Chain\b/i.test(x)&&!/\b(?:could|may|might|expect|plan to|risk factors)\b/i.test(x));
 if(!evidence.length)return null;
 return {title:link.title,url:link.url,publishedAt:date.toISOString(),summary:summary(evidence[0]),
  owner:source.owner,whyItMatters:'Company-reported chain development, not independently verified on-chain adoption.'};
}
function safeRedirect(response,current,allowedHosts){
 if(!allowedHosts||response.status<300||response.status>=400)return null;
 const location=response.headers?.get?.('location');if(!location)throw Object.assign(Error('SOURCE_REDIRECT_INVALID'),{code:'SOURCE_REDIRECT_INVALID'});
 const next=new URL(location,current);
 if(next.protocol!=='https:'||next.username||next.password||!allowedHosts.includes(next.hostname))
  throw Object.assign(Error('SOURCE_REDIRECT_REFUSED'),{code:'SOURCE_REDIRECT_REFUSED'});
 return next.href;
}

async function request(url,fetcher,{timeoutMs=10000,redirectHosts=null}={}){
 const controller=new AbortController();let timer;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(Error('SOURCE_TIMEOUT'),{code:'SOURCE_TIMEOUT'}));},timeoutMs);});
 const work=(async()=>{let current=url,r;for(let hop=0;;hop++){r=await fetcher(current,{headers:{'user-agent':'ARCY-Pulse/2.0','accept':'application/json,application/xml,text/html'},redirect:redirectHosts?'manual':'error',signal:controller.signal});const next=safeRedirect(r,current,redirectHosts);if(!next)break;if(hop>=3)throw Object.assign(Error('SOURCE_REDIRECT_LIMIT'),{code:'SOURCE_REDIRECT_LIMIT'});current=next;}if(!r.ok)throw Object.assign(Error('SOURCE_HTTP_'+r.status),{code:'SOURCE_HTTP_'+r.status});
  if(r.body?.getReader){const reader=r.body.getReader(),parts=[];let size=0;for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>2*1024*1024){controller.abort();Promise.resolve(reader.cancel()).catch(()=>{});throw Object.assign(Error('SOURCE_TOO_LARGE'),{code:'SOURCE_TOO_LARGE'});}parts.push(Buffer.from(chunk.value));}return Buffer.concat(parts).toString('utf8');}
  const text=await r.text();if(Buffer.byteLength(text)>2*1024*1024)throw Object.assign(Error('SOURCE_TOO_LARGE'),{code:'SOURCE_TOO_LARGE'});return text;
 })();try{return await Promise.race([work,deadline]);}finally{clearTimeout(timer);}
}
async function collect(source,fetcher,{timeoutMs=10000}={}){
 if(source.type==='releases'){
  try{return releases(JSON.parse(await request(source.url,fetcher,{timeoutMs})),source);}
  catch(error){if(!['SOURCE_HTTP_403','SOURCE_HTTP_429'].includes(error?.code))throw error;
   return atom(await request(GETH_ATOM,fetcher,{timeoutMs}),source);}
 }
 if(source.type==='ir'){
  const half=Math.max(1000,Math.floor(timeoutMs/2)),links=irLinks(await request(source.url,fetcher,{timeoutMs:half}),source).slice(0,3);
  const pages=await Promise.all(links.map(link=>request(link.url,fetcher,{timeoutMs:half})));
  return pages.map((html,i)=>irRelease(html,links[i],source)).filter(Boolean);
 }
 const text=await request(source.url,fetcher,{timeoutMs,redirectHosts:source.redirectHosts||null});
 if(source.type==='network'){if(!/4663/.test(text)||!/rpc\.mainnet\.chain\.robinhood\.com/.test(text))throw Error('SOURCE_CHAIN_IDENTITY_MISMATCH');return [];}
 if(source.type==='rss')return rss(text,source);
 if(source.type==='newsroom')return newsroom(text,source);
 throw Error('SOURCE_PARSE_FAILURE');
}
function select(items,cycle,now){const events=new Map(),seen=new Set(),releaseSources=new Set(),accepted=[],rejected={stale:0,future:0,duplicate:0,unsourced:0,undated:0,irrelevant:0,supersededRelease:0};for(const {item,source}of [...items].sort((a,b)=>Date.parse(b.item.publishedAt)-Date.parse(a.item.publishedAt))){const time=publicationTime(item.publishedAt),url=officialUrl(item.url,source),title=clean(item.title);if(!Number.isFinite(time)){rejected.undated++;continue;}if(time<Date.parse(cycle.start)){rejected.stale++;continue;}if(time>=Date.parse(cycle.end)||time>now){rejected.future++;continue;}if(!url||!title||!item.summary){rejected.unsourced++;continue;}if(/giveaway|survey|community poll|job opening/i.test(title)){rejected.irrelevant++;continue;}const canonicalTitle=title.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();const text=(title+' '+item.summary).toLowerCase(),testnet=text.match(/(?:^|[^a-z])(hoodi|sepolia|holesky)(?:[^a-z]|$)/)?.[1],eventKey=testnet&&/postpon|delay(?:ed)?|reschedul/.test(text)?'activation-delay:'+testnet:null;if(eventKey&&events.has(eventKey)){rejected.duplicate++;const previous=events.get(eventKey);previous.corroboratingSources=[...(previous.corroboratingSources||[]),{url,publishedAt:new Date(time).toISOString(),title,scope:'Same named testnet activation-delay topic in this review; not a separate news item.'}];continue;}if(seen.has(url)||seen.has(canonicalTitle)){rejected.duplicate++;continue;}if(source.type==='releases'&&releaseSources.has(source.url)){rejected.supersededRelease++;continue;}if(source.type==='releases')releaseSources.add(source.url);seen.add(url);seen.add(canonicalTitle);const kept={...item,title,url,publishedAt:new Date(time).toISOString(),sourceUrl:source.url,verifiedCurrentWeek:false,verifiedReviewWindow:true,contentType:'VERIFIED_DEVELOPMENT'};accepted.push(kept);if(eventKey)events.set(eventKey,kept);}return {items:accepted.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,3),rejected};}
function statusCards(chain,reason='No additional verified development in this review window.',offset=0){const cfg=config(chain);return ['week','new','unlock'].slice(offset).map(kind=>({kind,owner:cfg.label.toUpperCase()+' · SOURCE STATUS',title:kind==='unlock'?'No contract-linked unlock verified.':kind==='new'?'No additional verified development.':'No major verified update in this review window.',summary:kind==='unlock'?'No contract-linked unlock item was established by these news sources. A release announcement is not an unlock schedule.':reason,url:'',publishedAt:null,verifiedCurrentWeek:false,contentType:'SOURCE_STATUS'}));}
async function generate({chain,now=Date.now(),fetcher=fetch,trigger='manual',allowPartial=false,sourceTimeoutMs=10000,recentWindow=false}={}){
 const cfg=config(chain),baseCycle=windowFor(now),cycle=recentWindow?{...baseCycle,end:new Date(Date.parse(baseCycle.publicationWeek)+WEEK).toISOString()}:baseCycle;if(cycle.number<1)throw Object.assign(Error('PULSE_NOT_STARTED'),{code:'PULSE_NOT_STARTED'});
 const checks=await Promise.allSettled(cfg.sources.map(s=>collect(s,fetcher,{timeoutMs:sourceTimeoutMs}))),failures=checks.flatMap((x,i)=>x.status==='rejected'?[{url:cfg.sources[i].url,code:x.reason?.name==='SyntaxError'?'SOURCE_PARSE_FAILURE':/^SOURCE_[A-Z_0-9]{1,70}$/.test(x.reason?.code||x.reason?.message||'')?String(x.reason.code||x.reason.message):'SOURCE_UNAVAILABLE'}]:[]);
 const audit={sourcesAttempted:checks.length,sourcesSuccessfullyChecked:checks.filter(x=>x.status==='fulfilled').length,sourceFailures:failures,nextScheduledAt:nextRun(now)};
 if(failures.length&&!allowPartial)throw Object.assign(Error('PULSE_SOURCE_COVERAGE_INCOMPLETE'),{code:'PULSE_SOURCE_COVERAGE_INCOMPLETE',audit});
 if(failures.length)return partialEdition({cfg,chain,cycle,now,trigger,checks,failures,audit,recentWindow});
 const selected=select(checks.flatMap((x,i)=>x.value.map(item=>({item,source:cfg.sources[i]}))),cycle,now),status=selected.items.length?'updated':'quiet_week';
 const actual=selected.items.slice(0,allowPartial?3:2);
 const cards=[...actual.map((item,i)=>({...item,kind:['week','new','unlock'][i],summary:item.summary+' '+(item.whyItMatters||'First-party research, not independent proof of adoption or economic activity.'),linkLabel:'READ PRIMARY SOURCE ↗'})),
  ...statusCards(chain,undefined,actual.length).map(x=>allowPartial&&x.kind==='unlock'?{...x,title:'No further verified project update.',summary:'No additional dated project development was verified from the selected sources; not a token unlock report.'}:x)].slice(0,3);
 return {schemaVersion:3,chain,chainId:cfg.chainId,number:cycle.number,publicationWeek:cycle.publicationWeek,generatedAt:new Date(now).toISOString(),cycle:{start:cycle.start,end:cycle.end},success:true,status,trigger,cards,...(recentWindow?{recentWindow:true,reviewPeriodComplete:false}:{}),take:status==='quiet_week'?'The checked '+cfg.label+' sources contained no qualifying new development in this completed weekly review. No old story was reused.':actual.map(x=>x.title).join('; ')+'. Treat these as dated first-party reports. Verify release scope and on-chain usage separately; publication is not adoption evidence.',sources:cfg.sources.map(s=>s.url),audit:{...audit,acceptedItemCount:actual.length,additionalQualifiedDevelopments:Math.max(0,selected.items.length-actual.length),rejected:selected.rejected}};
}

function partialEdition({cfg,chain,cycle,now,trigger,checks,failures,audit,recentWindow}){
 const good=checks.flatMap((check,i)=>check.status==='fulfilled'?check.value.map(item=>({item,source:cfg.sources[i]})):[]);
 const selected=select(good,cycle,now),actual=selected.items.slice(0,3);
 const failed=[...new Set(failures.map(f=>{try{return new URL(f.url).hostname;}catch{return 'unknown source';}}))].join(', ');
 const reason=failures.length+' of '+cfg.sources.length+' official sources failed ('+failed+'). Coverage is incomplete, not a quiet week.';
 const cards=[...actual.map((item,i)=>({...item,kind:['week','new','unlock'][i],summary:item.summary+' '+(item.whyItMatters||''),linkLabel:'READ PRIMARY SOURCE ↗'})),
  ...statusCards(chain,reason,actual.length).map(x=>({...x,title:'Source coverage incomplete.',summary:reason}))].slice(0,3);
 return {schemaVersion:3,chain,chainId:cfg.chainId,number:cycle.number,publicationWeek:cycle.publicationWeek,generatedAt:new Date(now).toISOString(),cycle:{start:cycle.start,end:cycle.end},success:true,status:'partial_source_coverage',complete:false,
  ...(recentWindow?{recentWindow:true,reviewPeriodComplete:false}:{}),trigger,cards,
  take:actual.length?actual.map(x=>x.title).join('; ')+'. '+reason:'No verified story from responding sources. '+reason,
  sources:cfg.sources.map(x=>x.url),audit:{...audit,acceptedItemCount:actual.length,additionalQualifiedDevelopments:Math.max(0,selected.items.length-actual.length),rejected:selected.rejected}};
}

function pending(chain,reasonCode='PULSE_PUBLICATION_UNAVAILABLE'){const cfg=config(chain);return {ok:true,chain,chainId:cfg.chainId,number:null,status:'source_pending',generatedAt:null,cycle:windowFor(),cards:statusCards(chain,'A verified weekly publication is not available. No news has been substituted.').map(c=>({...c,title:'Verified weekly publication unavailable.'})),take:'No verified weekly edition is available for '+cfg.label+'.',sources:cfg.sources.map(x=>x.url),audit:{reasonCode,nextScheduledAt:nextRun()}};}
module.exports={CONFIG,config,windowFor,nextRun,clean,officialUrl,rss,releases,atom,newsroom,irLinks,irRelease,select,generate,pending,statusCards,request,publicationTime};
