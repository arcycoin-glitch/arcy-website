'use strict';
// Radar Intelligence — owner-reviewed primary-source project registry (issue #279).
//
// Why a registry: no source available to ARCY binds a token contract to an official project team on-chain. An exact
// contract can be listed in hundreds of third-party repositories (token lists, wallets, dashboards, copy-trading bots),
// so "the address appears on GitHub" is NOT affiliation. The registry is the trust root: a version-controlled file in this
// repository, changed only by reviewed pull requests, that binds ONE exact chainId+address to official sources.
// Runtime never accepts registry entries from requests, query strings, env JSON or storage.
//
// Each approved token binding needs at least one primary-source proof recorded at review time:
//  - GITHUB_FILE: an official repository file at a PINNED 40-hex commit that contains the exact address (re-checked live
//    by the GitHub adapter at that commit, so the file cannot be edited after review without breaking the proof).
//  - OFFICIAL_DOMAIN_DOCUMENT: an https page on an official domain that contains the exact address, with the SHA-256 of
//    the body as fetched by scripts/radar-registry-propose.cjs at review time.
// A review (GitHub login of the reviewer, reviewedAt, expiresAt <= 180 days) is mandatory. Expired entries stop counting.
const crypto=require('node:crypto');
const NETWORK_CHAIN=Object.freeze({arc:5042,ethereum:1,robinhood:4663,pons:4663});
const ADDRESS=/^0x[0-9a-f]{40}$/,COMMIT=/^[0-9a-f]{40}$/,HOSTNAME=/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const GH_NAME=/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,GH_REPO=/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/,SNAPSHOT_SPACE=/^[a-z0-9.-]{3,64}$/;
// Shared hosting / social hosts: anyone can publish there, so a bare host here never proves official status.
const SHARED_HOSTS=Object.freeze(['github.com','raw.githubusercontent.com','gist.github.com','gitlab.com','medium.com','mirror.xyz','x.com','twitter.com',
 't.me','discord.gg','discord.com','docs.google.com','notion.site','linktr.ee','substack.com','youtube.com','reddit.com','gitbook.io','vercel.app','netlify.app','pages.dev','github.io']);
const isShared=h=>SHARED_HOSTS.some(s=>h===s||h.endsWith('.'+s));
const MAX_PROJECTS=200,MAX_TOKENS=5,MAX_DOMAINS=5,MAX_REPOS=5,MAX_PROOFS=10,MAX_REVIEW_DAYS=180,DAY=86400000;
const iso=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&/^\d{4}-\d{2}-\d{2}T/.test(s);
function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x);}
const digest=x=>crypto.createHash('sha256').update(canonical(x)).digest('hex');
function validateProject(p,now){
 const e=[];
 if(!p||typeof p!=='object')return ['PROJECT_NOT_OBJECT'];
 if(typeof p.id!=='string'||!/^[a-z0-9-]{2,64}$/.test(p.id))e.push('ID_INVALID');
 if(typeof p.name!=='string'||!p.name.trim()||p.name.length>80)e.push('NAME_INVALID');
 const tokens=Array.isArray(p.tokens)?p.tokens:[];
 if(!tokens.length||tokens.length>MAX_TOKENS)e.push('TOKENS_INVALID');
 for(const t of tokens){
  if(!t||!Object.hasOwn(NETWORK_CHAIN,t.network)||t.chainId!==NETWORK_CHAIN[t.network]||!ADDRESS.test(t.address||''))e.push('TOKEN_IDENTITY_INVALID');
 }
 const o=p.official||{},domains=Array.isArray(o.domains)?o.domains:[];
 if(domains.length>MAX_DOMAINS||domains.some(d=>typeof d!=='string'||!HOSTNAME.test(d)||isShared(d)))e.push('OFFICIAL_DOMAIN_INVALID_OR_SHARED');
 const gh=o.github;
 if(gh!==undefined){
  if(!gh||!GH_NAME.test(gh.owner||'')||!Array.isArray(gh.repos)||!gh.repos.length||gh.repos.length>MAX_REPOS||
     gh.repos.some(r=>!GH_REPO.test(r)||r.split('/')[0].toLowerCase()!==gh.owner.toLowerCase()))e.push('GITHUB_BINDING_INVALID');
 }
 if(o.snapshotSpace!==undefined&&!SNAPSHOT_SPACE.test(o.snapshotSpace))e.push('SNAPSHOT_SPACE_INVALID');
 if(!domains.length&&!gh)e.push('NO_OFFICIAL_SOURCE');
 const proofs=Array.isArray(p.proofs)?p.proofs:[];
 if(!proofs.length||proofs.length>MAX_PROOFS)e.push('PROOFS_REQUIRED');
 const covered=new Set();
 for(const pr of proofs){
  const addrs=Array.isArray(pr?.addresses)?pr.addresses:[];
  if(!addrs.length||addrs.some(a=>!ADDRESS.test(a))){e.push('PROOF_ADDRESSES_INVALID');continue;}
  if(!iso(pr.retrievedAt)||Date.parse(pr.retrievedAt)>now){e.push('PROOF_RETRIEVED_AT_INVALID');continue;}
  if(pr.kind==='GITHUB_FILE'){
   if(!gh||!gh.repos.map(r=>r.toLowerCase()).includes(String(pr.repo).toLowerCase())||!COMMIT.test(pr.ref||'')||typeof pr.path!=='string'||!/^[A-Za-z0-9._\/-]{1,200}$/.test(pr.path)||pr.path.includes('..')){e.push('GITHUB_PROOF_INVALID');continue;}
  }else if(pr.kind==='OFFICIAL_DOMAIN_DOCUMENT'){
   let u;try{u=new URL(pr.url);}catch{e.push('DOMAIN_PROOF_URL_INVALID');continue;}
   const h=u.hostname.toLowerCase();
   if(u.protocol!=='https:'||u.username||u.password||!domains.some(d=>h===d||h.endsWith('.'+d))||!/^[0-9a-f]{64}$/.test(pr.sha256||'')){e.push('DOMAIN_PROOF_INVALID');continue;}
  }else{e.push('PROOF_KIND_UNKNOWN');continue;}
  for(const a of addrs)covered.add(a);
 }
 for(const t of tokens)if(ADDRESS.test(t?.address||'')&&!covered.has(t.address))e.push('TOKEN_WITHOUT_PROOF');
 const r=p.review;
 if(!r||!GH_NAME.test(r.reviewer||'')||!iso(r.reviewedAt)||!iso(r.expiresAt))e.push('REVIEW_REQUIRED');
 else{
  const at=Date.parse(r.reviewedAt),exp=Date.parse(r.expiresAt);
  if(at>now)e.push('REVIEW_IN_FUTURE');
  if(exp-at>MAX_REVIEW_DAYS*DAY||exp<=at)e.push('REVIEW_WINDOW_INVALID');
  if(exp<=now)e.push('REVIEW_EXPIRED');
 }
 return [...new Set(e)];
}
// Returns only individually valid projects; one bad entry never poisons the rest, and is reported.
function load(doc,now=Date.now()){
 const out={schema:doc?.schema||null,version:doc?.version||null,digest:null,projects:[],rejected:[],byKey:new Map()};
 if(!doc||doc.schema!=='arcy-radar-project-registry/1'||typeof doc.version!=='string'||!Array.isArray(doc.projects)||doc.projects.length>MAX_PROJECTS){
  out.rejected.push({id:null,errors:['REGISTRY_SCHEMA_INVALID']});return out;
 }
 out.digest=digest(doc);
 const seenId=new Set();
 for(const p of doc.projects){
  const errors=validateProject(p,now);
  if(seenId.has(p?.id))errors.push('DUPLICATE_PROJECT_ID');
  for(const t of p?.tokens||[]){const k=t?.chainId+':'+t?.address;if(out.byKey.has(k))errors.push('DUPLICATE_TOKEN_BINDING');}
  if(errors.length){out.rejected.push({id:p?.id||null,errors});continue;}
  seenId.add(p.id);
  const frozen=structuredClone(p);out.projects.push(frozen);
  for(const t of p.tokens)out.byKey.set(t.chainId+':'+t.address,{project:frozen,token:t});
 }
 return out;
}
// Pons is a launch subset of Robinhood Chain: one 4663 binding serves both views.
function lookup(reg,chainId,address){return reg?.byKey?.get(Number(chainId)+':'+String(address||'').toLowerCase())||null;}
// URL prefixes that count as official for this project (path-scoped for GitHub; never a bare shared host).
function officialPrefixes(project){
 const o=project?.official||{},out=[];
 for(const d of o.domains||[])out.push('https://'+d+'/');
 for(const r of o.github?.repos||[])out.push('https://github.com/'+r+'/');
 if(o.snapshotSpace)out.push('https://snapshot.box/#/s:'+o.snapshotSpace+'/');
 return out;
}
module.exports={load,lookup,validateProject,officialPrefixes,digest,canonical,isShared,SHARED_HOSTS,NETWORK_CHAIN,MAX_REVIEW_DAYS};
