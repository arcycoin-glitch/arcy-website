'use strict';
// Read-only release evidence. Uses public snapshot/API responses, the existing
// exact-chain market adapter and optional pinned public RPC code checks.
const fs=require('node:fs'),path=require('node:path');
const {chain,verifyChainId}=require('../search/server/lib/chains');
const S=require('../lib/radar-v2/v4-snapshot');
const NETWORKS=['arc','ethereum','robinhood','pons'],BASE='https://www.arcyusdc.xyz';
const expected={arc:5042,ethereum:1,robinhood:4663,pons:4663};
const arg=name=>{const i=process.argv.indexOf('--'+name);return i<0?null:process.argv[i+1];};
const age=(at,now)=>Number.isFinite(Date.parse(at))?Math.round((now-Date.parse(at))/60000):null;
async function json(url,options={}){
 const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error('HTTP_'+r.status);
 return r.json();
}
async function rpc(network,calls){
 const endpoint=chain(network).publicRpc;
 const body=calls.map(([method,params],i)=>({jsonrpc:'2.0',id:i+1,method,params}));
 const rows=await json(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 if(!Array.isArray(rows)||rows.length!==body.length||new Set(rows.map(x=>x.id)).size!==body.length)throw Error('RPC_BATCH_IDENTITY');
 return body.map(q=>{const r=rows.find(x=>x.id===q.id);if(!r||r.error||!Object.hasOwn(r,'result'))throw Error('RPC_READ_UNAVAILABLE');return r.result;});
}
async function audit(snapshot,{onchain=false,now=Date.now()}={}){
 const rows=NETWORKS.flatMap(section=>(snapshot.sections?.[section]?.rows||[]).map(row=>({section,...row})));
 const seen=new Set(),duplicates=[],incorrectNetwork=[];
 for(const row of rows){
  const id=row.chainId+':'+row.address;
  if(seen.has(id))duplicates.push(id);seen.add(id);
  if(row.chainId!==expected[row.section]||row.network!==row.section)incorrectNetwork.push({section:row.section,address:row.address,chainId:row.chainId,network:row.network});
 }
 const result={observedAt:new Date(now).toISOString(),snapshot:{generatedAt:snapshot.generatedAt,engineCommit:snapshot.engineCommit,
  generatedAgeMin:age(snapshot.generatedAt,now),validation:S.validate(snapshot)},duplicates,incorrectNetwork,sections:{},api:{},onchain:{},market:{}};
 for(const n of NETWORKS){
  const sec=snapshot.sections?.[n],listed=sec?.rows||[];
  result.sections[n]={count:listed.length,unique:new Set(listed.map(r=>r.address)).size,asOf:sec?.asOf,sourceRadarAsOf:sec?.sourceRadarAsOf,
   ageMin:age(sec?.asOf,now),sourceAgeMin:age(sec?.sourceRadarAsOf,now),status:sec?.status,carriedForward:Boolean(sec?.carriedForward),
   displayClasses:sec?.display?.byClass||null,shortfall:sec?.display?.shortfall||null,
   rows:listed.map(r=>({address:r.address,symbol:r.symbol,chainId:r.chainId,pool:r.pool,
    identity:r.opportunity?.identityLevel,projectProfile:r.opportunity?.researchRank?.projectProfile?.level||null,
    band:r.opportunity?.researchRank?.researchBand,liquidityUsd:r.liquidityUsd,volume24hUsd:r.volume24hUsd,
    confirmedCritical:r.opportunity?.integrity?.confirmedCritical||[],warnings:r.opportunity?.researchRank?.warnings||[],
    maxObservedRunup:r.opportunity?.marketHistory?.maxRunupMultiple??null,measuredAt:r.measuredAt,
    crossCheck:r.verification?.crossCheck||null}))};
  const started=Date.now();
  try{
   const body=await json(BASE+'/api/search?action=radar&chain='+n,{headers:{accept:'application/json',referer:BASE+'/', 'sec-fetch-site':'same-origin'}});
   const tokens=body.tokens||[],ids=tokens.map(t=>t.address).sort();
   result.api[n]={http:200,ms:Date.now()-started,count:tokens.length,asOf:body.asOf||null,freshness:body.freshness||null,
    opportunity:body.opportunity||null,source:body.source||null,
    matchesSnapshot:JSON.stringify(ids)===JSON.stringify(listed.map(t=>t.address).sort()),addresses:ids};
  }catch(e){result.api[n]={error:e.message,ms:Date.now()-started};}
 }
 if(onchain)for(const n of ['arc','ethereum','robinhood']){
  const listed=rows.filter(r=>(r.section==='pons'?'robinhood':r.section)===n);
  try{
   const [rawId,block]=await rpc(n,[['eth_chainId',[]],['eth_blockNumber',[]]]);
   verifyChainId(n,rawId);if(!/^0x[0-9a-f]+$/i.test(block))throw Error('RPC_BLOCK_UNAVAILABLE');
   const code=await rpc(n,listed.map(r=>['eth_getCode',[r.address,block]]));
   result.onchain[n]={chainId:expected[n],block,provider:new URL(chain(n).publicRpc).hostname,
    code:listed.map((r,i)=>({section:r.section,address:r.address,codePresent:/^0x(?:[0-9a-f]{2})+$/i.test(code[i]||''),bytes:(code[i]?.length-2)/2}))};
  }catch(e){result.onchain[n]={error:e.message};}
  try{
   const market=await require('../lib/radar-v2/dexscreener').tokens(n,listed.map(r=>r.address),{fetcher:global.fetch,now:Date.now});
   result.market[n]={provider:'DEX Screener',observedAt:new Date().toISOString(),rows:listed.map(r=>{
    const matches=market.get(r.address)||[],exact=matches.find(m=>m.pair===r.pool?.toLowerCase()&&m.side==='base');
    return {section:r.section,address:r.address,exactPoolFound:Boolean(exact),basePairs:matches.filter(m=>m.side==='base').length,
     priceUsd:exact?.priceUsd??null,liquidityUsd:exact?.liquidityUsd??null,volume24hUsd:exact?.volume24hUsd??null};
   })};
  }catch(e){result.market[n]={error:e.code||e.message};}
 }
 result.scope='Snapshot/UI consumption and current exact-chain contract/market observations. These checks do not certify project safety, distinct traders, future returns or complete lifetime pump history. Market observations occur after snapshot asOf and are not a paired price comparison.';
 return result;
}
if(require.main===module)(async()=>{
 const source=arg('snapshot'),output=arg('out');
 if(!source||!output)throw Error('Usage: --snapshot FILE --out FILE [--onchain]');
 const result=await audit(JSON.parse(fs.readFileSync(source,'utf8')),{onchain:process.argv.includes('--onchain')});
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({snapshot:result.snapshot,duplicates:result.duplicates,incorrectNetwork:result.incorrectNetwork,
  counts:Object.fromEntries(NETWORKS.map(n=>[n,{n:result.sections[n].count,ageMin:result.sections[n].ageMin,api:result.api[n].count,freshness:result.api[n].freshness,matches:result.api[n].matchesSnapshot}])),
  onchain:Object.fromEntries(Object.entries(result.onchain).map(([n,v])=>[n,v.error||{block:v.block,verifiedCode:v.code.filter(x=>x.codePresent).length,total:v.code.length}]))}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={audit};
