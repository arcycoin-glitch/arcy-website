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
  if(!ok){rejected.push(d?.id||null);continue;}
  byKey.set(d.chainId+':'+d.address,d);
 }
 return {version:doc?.version||null,byKey,rejected};
}
const lookup=(set,chainId,address)=>set?.byKey?.get(Number(chainId)+':'+String(address||'').toLowerCase())||null;
// Public-repository activity may be researched only when the OFFICIAL SITE links the repository (site -> repo direction).
const researchableRepo=d=>Boolean(d&&d.github&&d.github.linkedFromOfficialSite===true&&['PRIMARY_SOURCE_VERIFIED','PARTIAL_EVIDENCE'].includes(d.status));
const label=d=>d?{status:d.status,checkedAt:d.checkedAt,siteShowsExactAddress:d.siteShowsExactAddress===true,officialSite:d.officialSite||null,missing:(d.missing||[]).slice(0,4)}:null;
module.exports={load,lookup,researchableRepo,label,STATUSES};
