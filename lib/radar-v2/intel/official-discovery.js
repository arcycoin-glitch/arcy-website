'use strict';
// ARCY Radar V6 — live official-source discovery (issue #279). Builder only (CI), never in a visitor request.
// For a bounded set of candidates the builder looks for a project page that PUBLISHES THE EXACT CONTRACT:
//   1. Established registry entries: pages on the maintainer-reviewed official domains listed in established-universe.json.
//   2. Other contracts: the website the token creator submitted to DEX Screener (creator-submitted, so it is only used to FIND a
//      site to check) — the homepage and at most one documentation page on the same registrable domain.
// The result is a dated, machine-made dossier (source BUILDER_LIVE_CHECK) with the evidence URL, the time, the documentation URL,
// GitHub organisation/repositories LINKED FROM the official page, and the page's own one-line description:
//   registry domain + exact contract published  -> PRIMARY_SOURCE_VERIFIED (official contract identity)
//   creator-submitted site + exact contract     -> PARTIAL_EVIDENCE (two-way token<->site link; identity stays metadata-level)
// Nothing is inferred: no address on the page, no dossier. Hardening: https, port 443, public host names only, at most one
// same-site redirect, 8 s timeout, 1.5 MB cap, no cookies, concurrency-limited, per-run fetch budget.
const MAX_BYTES=1536*1024,TIMEOUT_MS=8000;
const SKIP_HOSTS=/(^|\.)(x\.com|twitter\.com|t\.me|telegram\.(me|org)|discord\.(gg|com)|medium\.com|github\.com|linktr\.ee|youtube\.com|instagram\.com|facebook\.com|tiktok\.com|dexscreener\.com|geckoterminal\.com|coingecko\.com|coinmarketcap\.com|etherscan\.io|blockscout\.com|gitbook\.io|notion\.site|google\.com|pump\.fun)$/i;
const MULTI_TLD=new Set(['co.uk','com.au','co.jp','com.br','co.in','com.tr','org.uk']);
function registrable(h){const p=String(h||'').toLowerCase().split('.');if(p.length<2)return null;const two=p.slice(-2).join('.');return MULTI_TLD.has(two)&&p.length>=3?p.slice(-3).join('.'):two;}
function safeUrl(u){
 let x;try{x=new URL(u);}catch{return null;}
 if(x.protocol!=='https:'||x.username||x.password||(x.port&&x.port!=='443'))return null;
 const h=x.hostname.toLowerCase();
 if(!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)||/^\d+\.\d+\.\d+\.\d+$/.test(h)||h==='localhost'||h.endsWith('.local')||h.endsWith('.internal'))return null;
 x.hash='';return x;
}
async function getText(url,fetcher,depth=0){
 const u=safeUrl(url);if(!u)return {error:'UNSAFE_URL'};
 let res;
 try{res=await fetcher(u.href,{method:'GET',redirect:'manual',headers:{accept:'text/html,text/plain;q=0.9,*/*;q=0.5','user-agent':'arcy-radar-official-check/1 (+https://www.arcyusdc.xyz)'},signal:AbortSignal.timeout(TIMEOUT_MS)});}
 catch(e){return {error:e?.name==='TimeoutError'?'TIMEOUT':'NETWORK'};}
 if(res.status>=300&&res.status<400){
  const loc=res.headers?.get?.('location');const next=loc?safeUrl(new URL(loc,u).href):null;
  if(depth===0&&next&&registrable(next.hostname)===registrable(u.hostname))return getText(next.href,fetcher,1);
  return {error:'REDIRECT_OFF_SITE'};
 }
 if(!res.ok)return {error:'HTTP_'+res.status};
 let t;try{t=await res.text();}catch{return {error:'READ'};}
 return {text:t.length>MAX_BYTES?t.slice(0,MAX_BYTES):t,url:u.href};
}
const META=/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']{10,400})["']/i;
const META2=/<meta[^>]+content=["']([^"']{10,400})["'][^>]*(?:name|property)=["'](?:description|og:description)["']/i;
function describe(html){const m=META.exec(html)||META2.exec(html);if(!m)return null;
 return m[1].replace(/&#x([0-9a-f]{1,6});/gi,(_,h)=>String.fromCodePoint(parseInt(h,16))).replace(/&#(\d{1,7});/g,(_,d)=>String.fromCodePoint(Number(d))).replace(/&(amp|quot|lt|gt|apos|nbsp);/g,(_,e)=>({amp:'&',quot:'"',lt:'<',gt:'>',apos:"'",nbsp:' '})[e]).replace(/&[#a-z0-9]{0,8}$/i,'').replace(/[<>\u0000-\u001f]/g,'').replace(/\s+/g,' ').trim().slice(0,160)||null;}
function githubLinks(html){
 const out=new Map();
 for(const m of html.matchAll(/https:\/\/github\.com\/([A-Za-z0-9-]{1,39})(?:\/([A-Za-z0-9._-]{1,100}))?/g)){
  const owner=m[1],repo=m[2]&&!/^(orgs|sponsors|features|about|pricing|login|topics|marketplace)$/i.test(owner)?m[2].replace(/\.git$/,''):null;
  if(/^(orgs|sponsors|features|about|pricing|login|topics|marketplace|settings)$/i.test(owner))continue;
  if(!out.has(owner))out.set(owner,new Set());if(repo&&!/^(issues|pulls|blob|tree|releases)$/.test(repo))out.get(owner).add(owner+'/'+repo);
 }
 return [...out.entries()].map(([owner,repos])=>({owner,repos:[...repos].slice(0,3)}));
}
function docsLink(html,base){
 for(const m of html.matchAll(/href=["']([^"']{1,200})["']/gi)){
  let u;try{u=new URL(m[1],base);}catch{continue;}
  if(u.protocol!=='https:')continue;
  if(registrable(u.hostname)!==registrable(new URL(base).hostname))continue;
  if(/^docs\.|^developers?\./i.test(u.hostname)||/\/(docs?|documentation|whitepaper|guide|reference|developers?|contracts)(\/|$)/i.test(u.pathname))return u.href;
 }
 return null;
}
const U=require('./universe');
const has=(text,address)=>text.toLowerCase().includes(String(address).toLowerCase());
// Only a maintainer-reviewed project GitHub organisation in the canonical
// registry may serve as a primary contract-address source; no creator-submitted
// or symbol-matched repository is accepted.
function reviewedRaw(url,owner){
 const u=safeUrl(url);
 if(!u||u.hostname!=='raw.githubusercontent.com'||!owner)return false;
 const p=u.pathname.split('/').filter(Boolean);
 return p.length>=4&&p[0].toLowerCase()===String(owner).toLowerCase()&&
  p.slice(1).every(v=>/^[a-z0-9_.-]{1,120}$/i.test(v));
}
// candidate -> {pages:[urls], domains:[...], basis}
function plan(c){
 // A contract already seen by V3 need not have been re-enriched through
 // independent universe intake. Resolve the reviewed exact-chain/address
 // registry explicitly; never use ticker/name to discover official domains.
 const registered=U.registered(c.chainId,c.address);
 const reg=c.universe?.registry?.official||c.registryOfficial||registered?.official||null;
 if(reg&&Array.isArray(reg.domains)&&reg.domains.length){
  const pages=(reg.pages||[]).filter(u=>{const x=safeUrl(u);return x&&
   (reg.domains.some(d=>x.hostname===d||x.hostname.endsWith('.'+d))||reviewedRaw(u,reg.github));});
  return {basis:'REGISTRY_OFFICIAL_DOMAIN',domains:reg.domains.map(d=>String(d).toLowerCase()),pages:pages.length?pages:['https://'+reg.domains[0]+'/'],github:reg.github||null};
 }
 const site=(c.officialLinks?.websites||[]).map(safeUrl).find(x=>x&&!SKIP_HOSTS.test(x.hostname));
 if(!site)return null;
 return {basis:'CREATOR_SUBMITTED_SITE',domains:[registrable(site.hostname)],pages:[site.href],github:null};
}
async function inspect(c,{fetcher=global.fetch,now=Date.now(),budget={max:120,used:0}}={}){
 const p=plan(c);if(!p)return {status:'NO_SITE_TO_CHECK'};
 if(budget.used>=budget.max)return {status:'NOT_CHECKED_BUDGET'}; // not a check: the rotation ledger must not record it
 const at=new Date(now).toISOString();let home=null,evidence=null,docs=null,desc=null;const gh=[];const errors=[];
 const take=async url=>{if(budget.used>=budget.max)return {error:'RUN_BUDGET'};budget.used++;return getText(url,fetcher);};
 for(const url of p.pages.slice(0,2)){
  const r=await take(url);if(r.error){errors.push(r.error);continue;}
  home=home||r;desc=desc||describe(r.text);gh.push(...githubLinks(r.text));
  if(has(r.text,c.address)){evidence=r.url;break;}
  docs=docs||docsLink(r.text,r.url);
 }
 if(!evidence&&docs&&!p.pages.includes(docs)){
  const r=await take(docs);
  if(!r.error){gh.push(...githubLinks(r.text));desc=desc||describe(r.text);if(has(r.text,c.address))evidence=r.url;}else errors.push(r.error);
 }
 if(!evidence)return {status:home?'ADDRESS_NOT_PUBLISHED':'SITE_UNREACHABLE',basis:p.basis,errors:errors.slice(0,3),at};
 const ev=new URL(evidence);
 if(!p.domains.some(d=>ev.hostname===d||ev.hostname.endsWith('.'+d))&&!reviewedRaw(evidence,p.github))
  return {status:'EVIDENCE_OFF_DOMAIN',basis:p.basis,at};
 // GitHub: only organisations linked FROM the official page; a registry-declared org must also be linked to count as "linked".
 const owners=[...new Map(gh.map(g=>[g.owner.toLowerCase(),g])).values()];
 const regGh=p.github?owners.find(g=>g.owner.toLowerCase()===String(p.github).toLowerCase()):null;
 const chosen0=regGh||(p.basis==='CREATOR_SUBMITTED_SITE'?owners[0]:null)||null;
 // documentation / website repositories are not product development: fall back to the organisation's own most recent repos
 const DOCS_REPO=/(^|[-_.\/])(docs?|documentation|website|site|blog|brand|media-kit)([-_.]|$)/i;
 const chosen=chosen0?{...chosen0,repos:chosen0.repos.filter(x=>!DOCS_REPO.test(x.split('/')[1]))}:null;
 const officialSite='https://'+(p.basis==='REGISTRY_OFFICIAL_DOMAIN'?p.domains[0]:new URL(p.pages[0]).hostname)+'/';
 return {status:'ADDRESS_PUBLISHED',basis:p.basis,at,dossier:{id:'live:'+c.chainId+':'+c.address,source:'BUILDER_LIVE_CHECK',
  status:p.basis==='REGISTRY_OFFICIAL_DOMAIN'?'PRIMARY_SOURCE_VERIFIED':'PARTIAL_EVIDENCE',checkedAt:at,recheckedAt:at,siteShowsExactAddress:true,
  officialSite,officialDomains:p.domains,evidenceUrl:evidence,evidenceStatic:true,docsUrl:docs&&ev.href!==docs?docs:
   ((ev.hostname==='raw.githubusercontent.com'&&reviewedRaw(evidence,p.github))||
    /^docs\.|^developers?\./i.test(ev.hostname)||
    /\/(docs?|documentation|whitepaper|guide|reference|developers?|contracts)(\/|$)/i.test(ev.pathname)?evidence:null),
  siteContext:desc?desc+' (self-description on the official page)':null,
  github:chosen?{owner:chosen.owner,repos:chosen.repos,linkedFromOfficialSite:true}:
   (reviewedRaw(evidence,p.github)?{owner:p.github,repos:[p.github+'/'+ev.pathname.split('/')[2]],linkedFromOfficialSite:false}:null),
  missing:[]},
  officialCheck:{status:'ADDRESS_FOUND',url:evidence,at}};
}
async function discover(cands,{fetcher=global.fetch,now=Date.now(),max=60,concurrency=4,budget={max:150,used:0}}={}){
 const todo=cands.filter(c=>plan(c)).slice(0,max),out=new Map(),statuses=new Map(),report={considered:todo.length,published:0,primary:0,notPublished:0,unreachable:0,offDomain:0};
 let i=0;
 await Promise.all(Array.from({length:Math.min(concurrency,todo.length)},async()=>{
  while(i<todo.length){const c=todo[i++];let r;try{r=await inspect(c,{fetcher,now,budget});}catch{r={status:'SITE_UNREACHABLE'};}
   statuses.set(c.chainId+':'+c.address,r.status);
   if(r.status==='ADDRESS_PUBLISHED'){out.set(c.chainId+':'+c.address,r);report.published++;if(r.dossier.status==='PRIMARY_SOURCE_VERIFIED')report.primary++;}
   else if(r.status==='ADDRESS_NOT_PUBLISHED')report.notPublished++;else if(r.status==='EVIDENCE_OFF_DOMAIN')report.offDomain++;else if(r.status==='NOT_CHECKED_BUDGET')report.notChecked=(report.notChecked||0)+1;else report.unreachable++;}
 }));
 report.fetches=budget.used;
 return {found:out,statuses,report};
}
module.exports={discover,inspect,plan,registrable,safeUrl,reviewedRaw,githubLinks,docsLink,describe,SKIP_HOSTS};
