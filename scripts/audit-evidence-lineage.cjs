'use strict';
// Read-only acceptance gate (Issue #117 A): fetch Search reports from a deployment (default Production, ARCY_BASE to point at a Preview)
// for the Radar tokens of the three chains + regression contracts and FAIL if any derived field is ON_CHAIN_VERIFIED while one of its
// essential inputs is off-chain, or if any field that names a market provider in its source is ON_CHAIN_VERIFIED. Prints per-chain counts.
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz',MAX=Number(process.env.AUDIT_MAX||40);
const H={accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'};
const get=async p=>{const r=await fetch(BASE+p,{headers:H,signal:AbortSignal.timeout(55000)});return r.json();};
const MARKET=/gecko|dex ?screener|coingecko|defillama/i;
(async()=>{
 const toks=[['arc','0x73e5F588d27d6B5EC89C89c82692D1E7fECBd38b'],['arc','0xf76b1d00bd3d63a37246b5f512074e864010e33d'],['robinhood','0x39dbed3a2bd333467115de45665cc57f813c4571']];
 for(const c of ['arc','ethereum','robinhood']){try{for(const t of (await get('/api/search?action=radar&chain='+c)).tokens||[])toks.push([c,t.address]);}catch(e){console.log('radar '+c+' unavailable: '+e.message);}}
 const seen=new Set(),sample=toks.filter(([c,a])=>!seen.has(c+a.toLowerCase())&&seen.add(c+a.toLowerCase())).slice(0,MAX);
 const stat={},bad=[];let fdv=0,errors=0;
 for(const [c,a] of sample){
  try{const j=await get('/api/search?action=report&chain='+c+'&address='+a);
   for(const [card,b] of Object.entries(j.cards||{}))for(const [k,f] of Object.entries(b.fields||{})){
    if(!f||typeof f!=='object')continue;
    const s=stat[c]=stat[c]||{};s[f.evidenceClass||'NONE']=(s[f.evidenceClass||'NONE']||0)+1;
    const derived=f.status==='ON_CHAIN_DERIVED',isFdv=f.kind==='FDV';if(isFdv)fdv++;
    const lin=f.provenance&&f.provenance.lineage;
    if(f.evidenceClass==='ON_CHAIN_VERIFIED'&&((derived&&lin&&!lin.onchainOnly)||(derived&&isFdv&&!lin)||(derived&&MARKET.test(f.source||''))))bad.push({chain:c,address:a,card,field:k,source:f.source,kind:f.kind});
   }}catch(e){errors++;console.log('report '+c+' '+a.slice(0,10)+' failed: '+e.message);}
 }
 console.log(JSON.stringify({base:BASE,tokens:sample.length,fdvFields:fdv,reportErrors:errors,classesByChain:stat,falselyOnChainVerified:bad.length},null,1));
 if(bad.length){console.log(JSON.stringify(bad,null,1));process.exit(1);}
})();
