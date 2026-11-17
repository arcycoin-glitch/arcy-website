#!/usr/bin/env node
'use strict';
// Issue #279 — owner workflow for the Radar project registry. Produces a PROPOSAL only; nothing here is trusted at runtime.
//
//   node scripts/radar-registry-propose.cjs --network robinhood --address 0x... --repo owner/repo --path deployments/x.json [--domain example.org --url https://example.org/token]
//   node scripts/radar-registry-propose.cjs --network robinhood --address 0x... --search      (needs GITHUB_TOKEN; lists repos mentioning it)
//
// Proposal steps (all read-only):
//  1. Resolve the repository's default-branch HEAD commit and pin the proof to that 40-hex commit.
//  2. Confirm the exact address is present in the file at that commit; reject forks/archived repos.
//  3. Report the owner type and GitHub's verified-domain flag (organizations only).
//  4. Optional: fetch an official-domain JSON document (token list / .well-known file) through ARCY's SSRF-safe fetcher (public IPs only, https, <=4 same-site
//     redirects), confirm the exact address, and record the SHA-256 of the body.
// The reviewer must then read the sources, decide affiliation, and add a review block (reviewer, reviewedAt, expiresAt<=180d)
// in lib/radar-v2/intel/project-registry.json through a pull request. Third-party token lists, wallets, dashboards, bots
// and copy repositories are NOT affiliation even though they contain the address.
const crypto=require('node:crypto');
const F=require('../lib/radar-v2/intel/fetch'),GH=require('../lib/radar-v2/intel/github'),R=require('../lib/radar-v2/intel/registry');
const arg=k=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:null;};
const has=k=>process.argv.includes('--'+k);
async function main(){
 const network=arg('network'),address=String(arg('address')||'').toLowerCase();
 if(!Object.hasOwn(R.NETWORK_CHAIN,network)||!/^0x[0-9a-f]{40}$/.test(address))throw Error('USAGE: --network arc|ethereum|robinhood|pons --address 0x...');
 const o={run:{budget:{max:40,used:0},calls:{}}};
 if(has('search')){
  if(!process.env.GITHUB_TOKEN)throw Error('GitHub code search requires GITHUB_TOKEN');
  const r=await F.json('https://api.github.com/search/code?per_page=30&q='+address,o);
  const items=(r.items||[]).map(i=>({repo:i.repository?.full_name,path:i.path,ownerType:i.repository?.owner?.type,fork:i.repository?.fork===true}));
  console.log(JSON.stringify({address,network,totalCount:r.total_count,note:'Mentions are NOT affiliation. Pick the project\'s own repository, then run again with --repo/--path.',items},null,1));
  return;
 }
 const repo=arg('repo'),path=arg('path');
 if(!repo||!path)throw Error('USAGE: --repo owner/repo --path file');
 const meta=await F.json('https://api.github.com/repos/'+repo,o);
 const head=await F.json('https://api.github.com/repos/'+repo+'/commits/'+encodeURIComponent(meta.default_branch),o);
 const ref=head.sha;
 const file=await F.json('https://api.github.com/repos/'+repo+'/contents/'+path.split('/').map(encodeURIComponent).join('/')+'?ref='+ref,o);
 const text=GH.decodeContent(file);
 const present=text!==null&&GH.ADDRESS_IN_TEXT(address).test(text);
 let ownerInfo;try{const org=await F.json('https://api.github.com/orgs/'+meta.owner.login,o);ownerInfo={type:'Organization',domainVerified:org.is_verified===true,blog:org.blog||null};}catch{ownerInfo={type:'User',domainVerified:false,blog:null};}
 const proofs=[];
 if(present)proofs.push({kind:'GITHUB_FILE',repo,path,ref,addresses:[address],retrievedAt:new Date().toISOString()});
 let domainCheck=null;const domain=arg('domain'),url=arg('url');
 if(domain&&url){
  const PM=require('../lib/project-metadata');
  try{const res=await PM.document(url);const s=JSON.stringify(res.document);const sha256=crypto.createHash('sha256').update(s).digest('hex');
   const ok=GH.ADDRESS_IN_TEXT(address).test(s);domainCheck={url,ok,sha256};
   if(ok)proofs.push({kind:'OFFICIAL_DOMAIN_DOCUMENT',url,sha256,addresses:[address],retrievedAt:new Date().toISOString()});}
  catch(e){domainCheck={url,ok:false,error:e.code||e.message};}
 }
 const proposal={id:String(arg('id')||repo.split('/')[1]).toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,64),name:arg('name')||repo.split('/')[1],
  tokens:[{network,chainId:R.NETWORK_CHAIN[network],address}],official:{domains:domain?[domain.toLowerCase()]:[],github:{owner:meta.owner.login,repos:[repo]}},
  proofs,review:{reviewer:'REQUIRED_OWNER_LOGIN',reviewedAt:'REQUIRED_ISO_TIME',expiresAt:'REQUIRED_ISO_TIME_<=180_DAYS'}};
 console.log(JSON.stringify({status:proofs.length?'PROPOSAL_READY_FOR_OWNER_REVIEW':'NO_PRIMARY_PROOF_FOUND',
  repo:{fork:meta.fork,archived:meta.archived,homepage:meta.homepage,owner:meta.owner.login,ownerInfo,pinnedCommit:ref},addressPresentAtCommit:present,domainCheck,
  proposal,validationIfReviewed:R.validateProject({...proposal,review:{reviewer:'owner',reviewedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+90*86400000).toISOString()}},Date.now())},null,1));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
