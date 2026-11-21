#!/usr/bin/env node
'use strict';
// Real-chain validation of holder role proofs (read-only). For each Ethereum cohort token: Blockscout's ranked candidates,
// then classifyRoles() at ONE pinned block via the configured Ethereum RPC. Prints the role distribution and every proof.
const fs=require('node:fs'),path=require('node:path');
const {rpc}=require('../search/server/lib/eth');
const LH=require('../search/server/lib/large-holders');
const HI=require('../search/server/lib/holder-intelligence');
const cohort=JSON.parse(fs.readFileSync(process.env.COVERAGE_COHORT||path.join(__dirname,'../data/coverage/radar-cohort-20261121.json'),'utf8'));
(async()=>{
 const block=await rpc('eth_blockNumber',[]);const out={block,tokens:[]};const dist={};
 for(const t of cohort.tokens.filter(x=>x.network==='ethereum')){
  try{
   const page=LH.parsePage(await LH.fetchPage(t.address),t.address);
   if(!page.ok){out.tokens.push({symbol:t.symbol,error:page.reasonCode});continue;}
   const cands=page.rows.slice(0,12).map((r,i)=>({address:r.address,rank:i+1,role:require('../search/server/lib/holder-attribution').classify({network:'ethereum',chainId:1,address:r.address}).role}));
   const roles=await HI.classifyRoles(cands,{token:t.address,block,rpc:(m,p)=>rpc(m,p),network:'ethereum',max:12});
   for(const r of roles)dist[r.role]=(dist[r.role]||0)+1;
   out.tokens.push({symbol:t.symbol,address:t.address,roles:roles.map(r=>({rank:r.rank,address:r.address,role:r.role,evidence:r.roleEvidence?.dex||r.roleEvidence?.method||null}))});
  }catch(e){out.tokens.push({symbol:t.symbol,error:e.message.slice(0,80)});}
  await new Promise(r=>setTimeout(r,800));
 }
 out.distribution=dist;
 fs.writeFileSync(process.env.ROLE_OUT||'/tmp/arcy-holder-roles.json',JSON.stringify(out,null,1));
 console.log('::notice title=holder role probe::'+JSON.stringify({block,distribution:dist,tokens:out.tokens.map(x=>x.symbol+':'+(x.error||x.roles.map(r=>r.role[0]+(r.role==='LIQUIDITY_POOL'?'('+r.evidence+')':'')).join('')))}).slice(0,3800));
 let md='## Holder role probe (Ethereum, block '+parseInt(block,16)+')\n\n| Token | Roles of top candidates |\n|---|---|\n';
 for(const x of out.tokens)md+='| '+x.symbol+' | '+(x.error||x.roles.map(r=>'#'+r.rank+' '+r.role+(r.evidence&&r.role==='LIQUIDITY_POOL'?' ('+r.evidence+')':'')).join(', '))+' |\n';
 md+='\nDistribution: `'+JSON.stringify(dist)+'`\n';
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
