'use strict';
// Radar V4 research dossiers (issue #279): owner-reviewable record of primary-source checks. Never identity, never eligibility.
const STATUSES=new Set(['OWNER_APPROVED','PRIMARY_SOURCE_VERIFIED','PARTIAL_EVIDENCE','NOT_VERIFIED','CONFLICTING_EVIDENCE']);
const ADDRESS=/^0x[0-9a-f]{40}$/,COMMIT=/^[0-9a-f]{40}$/,REPO=/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
function load(doc=require('./dossiers.json')){
 const byKey=new Map(),rejected=[];
 for(const d of Array.isArray(doc?.dossiers)?doc.dossiers:[]){
  const ok=d&&ADDRESS.test(d.address||'')&&Number.isInteger(d.chainId)&&STATUSES.has(d.status)&&d.status!=='OWNER_APPROVED'&&Number.isFinite(Date.parse(d.checkedAt))&&
   (!d.github||(Array.isArray(d.github.repos)&&d.github.repos.every(r=>REPO.test(r)&&r.split('/')[0].toLowerCase()===String(d.github.owner).toLowerCase())&&
    (!d.github.binding||(COMMIT.test(d.github.binding.ref||'')&&d.github.repos.includes(d.github.binding.repo)))));
  // V6: every URL is https; the page that shows the exact contract (evidenceUrl) and the documentation must live on one of the
  // project's official domains (officialDomains, which must include the official site's host) or in its official GitHub organisation.
  const urls=[d?.officialSite,d?.evidenceUrl,d?.docsUrl].filter(Boolean);
  const okUrls=urls.every(u=>officialUrl(u,d));
  if(!ok||!okUrls){rejected.push(d?.id||null);continue;}
  byKey.set(d.chainId+':'+d.address,d);
 }
 return {version:doc?.version||null,byKey,rejected};
}
function host(u){try{const x=new URL(u);return x.protocol==='https:'&&!x.username&&!x.password?x.hostname.toLowerCase():null;}catch{return null;}}
function officialUrl(u,d){
 const h=host(u);if(!h)return false;
 const domains=Array.isArray(d.officialDomains)&&d.officialDomains.length?d.officialDomains.map(x=>String(x).toLowerCase()):[host(d.officialSite)].filter(Boolean);
 if(d.officialSite&&!domains.some(x=>host(d.officialSite)===x||host(d.officialSite).endsWith('.'+x)))return false;
 if(domains.some(x=>h===x||h.endsWith('.'+x)))return true;
 if(!d.github?.owner)return false;
 const path=new URL(u).pathname.toLowerCase(),owner=String(d.github.owner).toLowerCase();
 if(h==='github.com')return path.startsWith('/'+owner+'/');
 if(h==='raw.githubusercontent.com'){
  const p=path.split('/').filter(Boolean);
  return p.length>=4&&p[0]===owner&&p.every(z=>/^[a-z0-9_.-]{1,120}$/.test(z));
 }
 return false;
}
const lookup=(set,chainId,address)=>set?.byKey?.get(Number(chainId)+':'+String(address||'').toLowerCase())||null;
// Public-repository activity may be researched only when the OFFICIAL SITE links the repository (site -> repo direction).
const researchableRepo=d=>Boolean(d&&d.github&&d.github.linkedFromOfficialSite===true&&['PRIMARY_SOURCE_VERIFIED','PARTIAL_EVIDENCE'].includes(d.status));
const label=d=>d?{id:d.id||null,status:d.status,checkedAt:d.checkedAt,siteShowsExactAddress:d.siteShowsExactAddress===true,officialSite:d.officialSite||null,
 evidenceUrl:d.evidenceUrl||null,evidenceStatic:d.evidenceStatic===true,docsUrl:d.docsUrl||null,siteContext:d.siteContext||null,officialDomains:d.officialDomains||null,
 github:d.github?{owner:d.github.owner,repos:(d.github.repos||[]).slice(0,3),linkedFromOfficialSite:d.github.linkedFromOfficialSite===true}:null,missing:(d.missing||[]).slice(0,4)}:null;
module.exports={load,lookup,researchableRepo,label,officialUrl,STATUSES};
