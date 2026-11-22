'use strict';
// Offline, fixed-identity measurement. Source-backed findings and the Search
// taxonomy's stricter VERIFIED class are intentionally reported separately.
const fs=require('node:fs'),assert=require('node:assert/strict');
const FIELDS=['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture','transferRestrictions'];
const identity=r=>(r.chain||r.network)+'|'+r.address.toLowerCase();
const verified=f=>Boolean(f?.ok&&['ON_CHAIN_VERIFIED','CROSS_VERIFIED'].includes(f.cls)&&!['STALE','CONFLICTING'].includes(f.state));
function measure(before,after,tokens){
 const b=new Map(before.rows.map(r=>[identity(r),r])),a=new Map(after.rows.map(r=>[identity(r),r]));
 const fields=Object.fromEntries(FIELDS.map(k=>[k,{expected:tokens.length,beforeFound:0,afterFound:0,beforeVerified:0,afterVerified:0,foundGain:0,verifiedGain:0,foundLoss:0,verifiedLoss:0,remainingNotFound:0,remainingNotVerified:0}]));
 const gains=[],changed=[],reasons={},seen=new Set(),contracts=new Set(),latency={before:[],after:[]};
 const requests={before:{rpc:0,sourcify:0},after:{rpc:0,sourcify:0}},taxScope={before:{complete:0,partial:0},after:{complete:0,partial:0}};
 for(const t of tokens){
  const id=identity(t);assert.ok(!seen.has(id),'duplicate token identity '+id);seen.add(id);
  const br=b.get(id),ar=a.get(id);assert.ok(br&&ar,'missing measured token '+id);assert.equal(ar.block,br.block,'different pinned block '+id);
  for(const [name,r] of [['before',br],['after',ar]]){
   latency[name].push(r.ms);for(const k of Object.keys(requests[name]))requests[name][k]+=r.net[k]||0;
   if(r.f.tradingTaxes?.ok)taxScope[name][/Buy\s+\d.*Sell\s+\d/.test(r.f.tradingTaxes.value||'')?'complete':'partial']++;
  }
  for(const k of FIELDS){
   const x=br.f[k],y=ar.f[k],s=fields[k],xf=Boolean(x?.ok),yf=Boolean(y?.ok),xv=verified(x),yv=verified(y);
   s.beforeFound+=xf;s.afterFound+=yf;s.beforeVerified+=xv;s.afterVerified+=yv;
   s.foundGain+=!xf&&yf;s.verifiedGain+=!xv&&yv;s.foundLoss+=xf&&!yf;s.verifiedLoss+=xv&&!yv;
   s.remainingNotFound+=!yf;s.remainingNotVerified+=!yv;
   if((!xf&&yf)||(!xv&&yv)){
    contracts.add(id);gains.push({chain:t.chain||t.network,address:t.address.toLowerCase(),section:t.section||t.group||null,block:ar.block,field:k,
     gain:!xv&&yv?'STRICT_VERIFIED':'SOURCE_BACKED_FINDING',value:y.value,status:y.status,evidenceClass:y.cls,evidence:y.evidence||[]});
   }
   if(xf&&yf&&(x.value!==y.value||x.status!==y.status))changed.push({identity:id,field:k,before:{value:x.value,status:x.status},after:{value:y.value,status:y.status}});
   if(!yf){const reason=y?.reason||ar.err||'NOT_VERIFIED';reasons[k+'|'+reason]=(reasons[k+'|'+reason]||0)+1;}
  }
 }
 const timing={};for(const name of ['before','after']){const ms=latency[name].sort((x,y)=>x-y);timing[name]={totalMs:ms.reduce((x,y)=>x+y,0),p50Ms:ms[Math.ceil(ms.length*.5)-1]??null,p95Ms:ms[Math.ceil(ms.length*.95)-1]??null};}
 return {tokens:tokens.length,contractsWithGains:contracts.size,fields,taxScope,requests,timing,gains,changed,reasons};
}
function main(args){
 const [beforeFile,afterFile,cohortFile,benchmarkFile,outputFile]=args;
 if(!outputFile)throw Error('Usage: measure-mechanics-v6.cjs BEFORE AFTER COHORT BENCHMARK_SAMPLES OUTPUT');
 const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),before=read(beforeFile),after=read(afterFile),cohort=read(cohortFile),samples=read(benchmarkFile);
 const result={at:new Date().toISOString(),baseline:before.commit,candidate:after.commit,
  definition:{found:'DATA_FOUND, includes complete reviewed source findings; does not mean executable authority or full Buy/Sell tax coverage',
   verified:'Unchanged Search taxonomy: fresh ON_CHAIN_VERIFIED or CROSS_VERIFIED; VERIFIED_SOURCE is source-backed only',
   tax:'Complete means Buy and Sell token-tax directions are both present. Transfer-only is partial; DEX/pool/hook fee unknowns stay separate.',
   cohort:{tokens:cohort.tokens.length,coreSlots:cohort.tokens.length*12,mechanicsSlots:cohort.tokens.length*4,otherCoreSlotsMeasured:false,source:cohort.source}},
  mechanicsBenchmark:measure(before,after,samples),fixedSearchCohort:measure(before,after,cohort.tokens)};
 fs.writeFileSync(outputFile,JSON.stringify(result,null,2));
 console.log(JSON.stringify({benchmark:result.mechanicsBenchmark.fields,cohort:result.fixedSearchCohort.fields,requests:result.mechanicsBenchmark.requests,timing:result.mechanicsBenchmark.timing}));
}
if(require.main===module)main(process.argv.slice(2));
module.exports={measure,verified};
