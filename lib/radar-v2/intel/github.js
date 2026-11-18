'use strict';
// Radar Intelligence — GitHub REST evidence for REGISTERED projects only (issue #279).
// Reads (all public, read-only, api.github.com via the guarded fetcher):
//   identity  : repos/{repo}/contents/{path}?ref={pinned commit} must contain the exact address (GITHUB_FILE proof);
//               repos/{repo} must not be a fork/archived/disabled and must belong to the registered owner.
//   activity  : repos/{repo}, releases (published, non-draft), commits since 90 days (count + distinct authors).
//   milestones: open milestones with a due date inside the next 90 days (dated, official, public plan).
// GitHub's own "verified domain" badge is read when the owner is an organization; it is reported, not required, because the
// owner-reviewed registry is the trust root. Nothing here ever searches GitHub for arbitrary addresses at runtime.
const F=require('./fetch');
const API='https://api.github.com/';
const DAY=86400000;
const ADDRESS_IN_TEXT=a=>new RegExp('(^|[^0-9a-fA-F])0x'+a.slice(2)+'(?![0-9a-fA-F])','i');
const enc=p=>p.split('/').map(encodeURIComponent).join('/');
function decodeContent(body){
 if(!body||body.type!=='file'||body.encoding!=='base64'||typeof body.content!=='string'||body.size>400000)return null;
 try{return Buffer.from(body.content.replace(/\n/g,''),'base64').toString('utf8');}catch{return null;}
}
async function repoMeta(repo,o){
 const r=await F.json(API+'repos/'+repo,o);
 return {fullName:r.full_name,ownerLogin:r.owner?.login,ownerType:r.owner?.type,fork:r.fork===true,archived:r.archived===true,disabled:r.disabled===true,
  pushedAt:r.pushed_at||null,homepage:typeof r.homepage==='string'?r.homepage:null,htmlUrl:r.html_url,defaultBranch:r.default_branch};
}
async function ownerVerification(owner,o){
 try{const org=await F.json(API+'orgs/'+encodeURIComponent(owner),o);return {type:'Organization',domainVerified:org.is_verified===true,blog:typeof org.blog==='string'?org.blog:null};}
 catch(e){if(e.httpStatus===404)return {type:'User',domainVerified:false,blog:null};throw e;}
}
// Live re-check of every GITHUB_FILE proof at its pinned commit.
async function identity({project,token,now,o}){
 const proofs=[],problems=[];
 const gh=project.official?.github;
 for(const pr of (project.proofs||[]).filter(p=>p.kind==='GITHUB_FILE'&&p.addresses.includes(token.address))){
  try{
   const meta=await repoMeta(pr.repo,o);
   // An archived official repository still proves the binding (and later proves abandonment); forks never do.
   if(meta.fork||meta.disabled||String(meta.ownerLogin).toLowerCase()!==gh.owner.toLowerCase()){problems.push({repo:pr.repo,reason:'REPO_NOT_ELIGIBLE_AS_OFFICIAL'});continue;}
   const body=await F.json(API+'repos/'+pr.repo+'/contents/'+enc(pr.path)+'?ref='+pr.ref,o);
   const text=decodeContent(body);
   if(text===null){problems.push({repo:pr.repo,reason:'PROOF_FILE_UNREADABLE'});continue;}
   if(!ADDRESS_IN_TEXT(token.address).test(text)){problems.push({repo:pr.repo,reason:'ADDRESS_ABSENT_AT_PINNED_COMMIT',contradiction:true});continue;}
   proofs.push({kind:'GITHUB_FILE',sourceUrl:'https://github.com/'+pr.repo+'/blob/'+pr.ref+'/'+pr.path,repo:pr.repo,ref:pr.ref,path:pr.path,checkedAt:new Date(now).toISOString()});
  }catch(e){problems.push({repo:pr.repo,reason:e.code||'GITHUB_UNAVAILABLE',transient:true});}
 }
 for(const pr of (project.proofs||[]).filter(p=>p.kind==='OFFICIAL_DOMAIN_DOCUMENT'&&p.addresses.includes(token.address)))
  proofs.push({kind:'OFFICIAL_DOMAIN_DOCUMENT',sourceUrl:pr.url,sha256:pr.sha256,checkedAt:pr.retrievedAt,reviewedOnly:true});
 let owner=null;
 if(gh){try{owner=await ownerVerification(gh.owner,o);}catch(e){problems.push({owner:gh.owner,reason:e.code||'GITHUB_UNAVAILABLE',transient:true});}}
 return {proofs,problems,owner};
}
async function activity({project,now,o,maxRepos=2}){
 const repos=(project.official?.github?.repos||[]).slice(0,maxRepos),since=new Date(now-90*DAY).toISOString(),out=[];
 for(const repo of repos){
  const row={repo,status:'UNAVAILABLE'};
  try{
   const meta=await repoMeta(repo,o);Object.assign(row,{meta});
   const rel=await F.json(API+'repos/'+repo+'/releases?per_page=10',o);
   row.releases=(Array.isArray(rel)?rel:[]).filter(r=>r&&r.draft!==true&&r.published_at).map(r=>({tag:String(r.tag_name).slice(0,60),name:String(r.name||r.tag_name).slice(0,80),
    publishedAt:r.published_at,prerelease:r.prerelease===true,url:r.html_url})).filter(r=>/^https:\/\/github\.com\//.test(r.url||''));
   const commits=await F.json(API+'repos/'+repo+'/commits?per_page=100&since='+encodeURIComponent(since),o);
   const list=Array.isArray(commits)?commits:[];
   row.commits90d=list.length;row.commitsCapped=list.length>=100;
   row.authors90d=new Set(list.map(c=>c?.author?.login||c?.commit?.author?.email).filter(Boolean)).size;
   row.lastCommitAt=list[0]?.commit?.committer?.date||null;
   // Development rhythm (V4 team quality): 7/30/90-day counts, distinct active ISO weeks, single-day burst share.
   const times=list.map(c=>Date.parse(c?.commit?.committer?.date||c?.commit?.author?.date||'')).filter(Number.isFinite);
   row.commits7d=times.filter(t=>now-t<=7*DAY).length;row.commits30d=times.filter(t=>now-t<=30*DAY).length;
   row.activeWeeks90d=new Set(times.map(t=>Math.floor((now-t)/(7*DAY)))).size;
   const byDay=new Map();for(const t of times){const d=Math.floor(t/DAY);byDay.set(d,(byDay.get(d)||0)+1);}
   row.maxDayShare=times.length?Math.max(...byDay.values())/times.length:null;
   const authors30=new Set(list.filter(c=>now-Date.parse(c?.commit?.committer?.date||'')<=30*DAY).map(c=>c?.author?.login||c?.commit?.author?.email).filter(Boolean));
   row.authors30d=authors30.size;
   try{const issues=await F.json(API+'repos/'+repo+'/issues?state=closed&per_page=100&since='+encodeURIComponent(since),o);
    row.closedIssues90d=(Array.isArray(issues)?issues:[]).filter(i=>i&&i.closed_at&&now-Date.parse(i.closed_at)<=90*DAY).length;}
   catch{row.closedIssues90d=null;}
   const ms=await F.json(API+'repos/'+repo+'/milestones?state=open&sort=due_on&direction=asc&per_page=20',o);
   row.milestones=(Array.isArray(ms)?ms:[]).filter(m=>m&&m.due_on).map(m=>({title:String(m.title).slice(0,100),dueOn:m.due_on,url:m.html_url,
    openIssues:m.open_issues|0,closedIssues:m.closed_issues|0,description:typeof m.description==='string'?m.description.slice(0,200):''}));
   row.status='OK';
  }catch(e){row.reason=e.code||'GITHUB_UNAVAILABLE';}
  out.push(row);
 }
 return out;
}
// Classification of activity rows into the product/catalyst evidence shapes consumed by pre-catalyst.evaluate.
function classifyActivity(rows,{now,chainId,address}){
 const ok=rows.filter(r=>r.status==='OK');
 if(!ok.length)return {product:null,catalyst:null,reason:'GITHUB_ACTIVITY_UNAVAILABLE'};
 const recent=x=>Number.isFinite(Date.parse(x))&&now-Date.parse(x)<=90*DAY&&Date.parse(x)<=now;
 const allArchived=ok.every(r=>r.meta.archived);
 const stale=ok.every(r=>!r.commits90d&&(!r.meta.pushedAt||now-Date.parse(r.meta.pushedAt)>180*DAY));
 const releases=ok.flatMap(r=>r.releases.filter(x=>!x.prerelease&&recent(x.publishedAt)).map(x=>({...x,repo:r.repo})));
 const commits=ok.reduce((s,r)=>s+r.commits90d,0),authors=Math.max(0,...ok.map(r=>r.authors90d));
 const status=allArchived||stale?'ABANDONED_VERIFIED':commits>=5?'VERIFIED_ACTIVE':'INACTIVE_DEVELOPMENT';
 const head=ok[0];
 const product={chainId,address,sourceUrl:String(head.meta.htmlUrl).replace(/\/?$/,'/'),observedAt:new Date(now).toISOString(),status,publisherVerified:status!=='INACTIVE_DEVELOPMENT',
  updates:releases.map(x=>({chainId,address,sourceUrl:x.url,observedAt:x.publishedAt,status:'VERIFIED_RELEASE',publisherVerified:true,tag:x.tag,repo:x.repo})),
  activity:{commits90d:commits,commitsCapped:ok.some(r=>r.commitsCapped),maxAuthors90d:authors,repos:ok.map(r=>r.repo),archived:allArchived,
   commits7d:ok.reduce((s,r)=>s+(r.commits7d||0),0),commits30d:ok.reduce((s,r)=>s+(r.commits30d||0),0),
   activeWeeks90d:Math.max(0,...ok.map(r=>r.activeWeeks90d||0)),authors30d:Math.max(0,...ok.map(r=>r.authors30d||0)),
   maxDayShare:ok.map(r=>r.maxDayShare).filter(Number.isFinite).reduce((a,b)=>Math.max(a,b),0),
   closedIssues90d:ok.some(r=>Number.isInteger(r.closedIssues90d))?ok.reduce((s,r)=>s+(r.closedIssues90d||0),0):null,
   releases90d:releases.length,lastReleaseAt:releases.map(x=>x.publishedAt).sort().at(-1)||null}};
 const upcoming=ok.flatMap(r=>r.milestones.map(m=>({...m,repo:r.repo})))
  .filter(m=>Date.parse(m.dueOn)>now&&Date.parse(m.dueOn)<=now+90*DAY&&(m.openIssues+m.closedIssues)>0&&/^https:\/\/github\.com\//.test(m.url||''))
  .sort((a,b)=>Date.parse(a.dueOn)-Date.parse(b.dueOn));
 const m=upcoming[0];
 const catalyst=m?{chainId,address,sourceUrl:m.url,observedAt:new Date(now).toISOString(),status:'CONFIRMED_PUBLIC_EVENT',publisherVerified:true,kind:'PRODUCT_RELEASE',
  evidenceClass:'OFFICIAL_REPOSITORY_MILESTONE',eventAt:m.dueOn,claim:('Official GitHub milestone "'+m.title+'" in '+m.repo+' is due '+m.dueOn.slice(0,10)+' ('+m.closedIssues+'/'+(m.openIssues+m.closedIssues)+' issues closed).').slice(0,240)}:null;
 return {product,catalyst,reason:null};
}
module.exports={identity,activity,classifyActivity,decodeContent,ADDRESS_IN_TEXT};
