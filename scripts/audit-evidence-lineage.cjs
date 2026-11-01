'use strict';
// Read-only FDV release gate. Missing reports, HTTP errors or an unexercised
// derived-FDV path cannot produce a successful verification result.
const MARKET=/gecko|dex ?screener|coingecko|coinmarketcap|defillama|market ?api/i;
const SEEDS=[
 ['arc','0x4621a0baa0b5d97aae77704cf2a84dabe78a4fed'],
 ['ethereum','0xa0df17b5ac76ababa36e1450e2cbcd18a620c845'],
 ['robinhood','0x39dbed3a2bd333467115de45665cc57f813c4571']
];
async function audit({base=process.env.ARCY_BASE||'https://www.arcyusdc.xyz',max=Number(process.env.AUDIT_MAX||40),fetchImpl=globalThis.fetch,log=console.log}={}){
 if(!Number.isInteger(max)||max<3||max>100)throw Error('AUDIT_MAX must be an integer from 3 to 100');
 const headers={accept:'application/json',referer:base+'/','sec-fetch-site':'same-origin'};
 const get=async path=>{
  const r=await fetchImpl(base+path,{headers,signal:AbortSignal.timeout(55000)});
  if(!r.ok)throw Error('HTTP '+r.status);
  return r.json();
 };
 const tokens=[...SEEDS];let radarErrors=0;
 for(const chain of ['arc','ethereum','robinhood']){
  try{
   const j=await get('/api/search?action=radar&chain='+chain);
   if(!Array.isArray(j.tokens))throw Error('Radar token list missing');
   for(const t of j.tokens)if(/^0x[0-9a-f]{40}$/i.test(t.address||''))tokens.push([chain,t.address]);
  }catch(e){radarErrors++;log('radar '+chain+' unavailable: '+e.message);}
 }
 const seen=new Set(),sample=tokens.filter(([c,a])=>!seen.has(c+a.toLowerCase())&&seen.add(c+a.toLowerCase())).slice(0,max);
 const classesByChain={},bad=[];let fdvFields=0,derivedFdvFields=0,reportErrors=0,fields=0;
 for(const [chain,address] of sample){
  try{
   const j=await get('/api/search?action=report&chain='+chain+'&address='+address);
   const entries=Object.entries(j.cards||{}).flatMap(([card,b])=>Object.entries(b?.fields||{}).map(([key,f])=>({card,key,f})));
   if(!entries.length)throw Error('Report fields missing');
   for(const {card,key,f} of entries){
    if(!f||typeof f!=='object')continue;
    fields++;
    const counts=classesByChain[chain]??={};counts[f.evidenceClass||'NONE']=(counts[f.evidenceClass||'NONE']||0)+1;
    const derived=f.status==='ON_CHAIN_DERIVED',present=f.value!==null&&f.value!==undefined;
    if(f.kind==='FDV'&&present){fdvFields++;if(derived)derivedFdvFields++;}
    const lin=f.provenance?.lineage;
    const claimsOnchain=f.evidenceClass==='ON_CHAIN_VERIFIED'||f.provenance?.underlyingClass==='ON_CHAIN_VERIFIED';
    if(claimsOnchain&&((derived&&(!lin||lin.onchainOnly!==true))||MARKET.test(f.source||'')))bad.push({chain,address,card,field:key,source:f.source,kind:f.kind});
   }
  }catch(e){reportErrors++;log('report '+chain+' '+address.slice(0,10)+' failed: '+e.message);}
 }
 const summary={base,tokens:sample.length,fields,fdvFields,derivedFdvFields,radarErrors,reportErrors,classesByChain,falselyOnChainVerified:bad.length};
 summary.ok=radarErrors===0&&reportErrors===0&&fields>0&&derivedFdvFields>0&&bad.length===0;
 log(JSON.stringify(summary,null,1));if(bad.length)log(JSON.stringify(bad,null,1));
 return summary;
}
if(require.main===module)audit().then(s=>{process.exitCode=s.ok?0:1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={audit};
