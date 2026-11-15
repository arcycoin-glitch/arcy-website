'use strict';
// Read-only live verification of Mechanics V5 on Production (public Search API only; no writes, no secrets).
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const TOKENS=[['robinhood','0x18e674231a58c239dc7daedcffe15ec3a24cff5c','UERC20'],['ethereum','0x4Fabb145d64652a948d72533023f6E7A623C7C53','BUSD'],
 ['ethereum','0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE','SHIB'],['ethereum','0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48','USDC'],
 ['ethereum','0xdAC17F958D2ee523a2206206994597C13D831ec7','USDT'],['ethereum','0x45804880De22913dAFE09f4980848ECE6EcbAf78','PAXG'],
 ['arc','0x73e5F588d27d6B5EC89C89c82692D1E7fECBd38b','ARCY'],['robinhood','0x6dbe95076584f869dd09a44131e9a3c13f34d7d6','PONS-subset']];
const headers={accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'};
async function get(p){const t0=Date.now();const r=await fetch(BASE+p,{headers,signal:AbortSignal.timeout(60000),cache:'no-store'});return {status:r.status,ms:Date.now()-t0,json:await r.json().catch(()=>null)};}
(async()=>{let fail=0;
 for(const [chain,address,label] of TOKENS){
  const q=new URLSearchParams({address,chain});let r=await get('/api/search?action=report&'+q);
  for(let i=0;i<8&&r.status===200&&!r.json?.cards?.mechanics?.fields;i++){await new Promise(s=>setTimeout(s,4000));r=await get('/api/search?action=report&'+q);}
  const m=r.json?.cards?.mechanics,f=m?.fields||{},rest=m?.supplementary?.transferRestrictions;
  const row={label,chain,status:r.status,ms:r.ms,fields:Object.keys(f).length,
   rows:Object.fromEntries(Object.entries(f).map(([k,v])=>[k,v?.dataState==='DATA_FOUND'?String(v.value).slice(0,70):'NV: '+String(v?.reason||v?.reasonCode||'').slice(0,60)])),
   restrictions:rest?(rest.dataState==='DATA_FOUND'?rest.value:'NV: '+(rest.reason||rest.reasonCode)):'ABSENT',
   note:(m?.researchNotes||[]).find(n=>n.startsWith('Transfer Restrictions:'))?.slice(0,110)||null,
   totalFields:Object.values(r.json?.cards||{}).reduce((n,c)=>n+Object.keys(c.fields||{}).length,0)};
  if(r.status!==200||row.fields!==4||row.totalFields!==20)fail++;
  console.log('::notice title=v5-live-'+label+'::'+JSON.stringify(row));
  await new Promise(s=>setTimeout(s,2500));
 }
 const st=await get('/api/search?action=status');console.log('::notice title=v5-live-status::'+JSON.stringify({http:st.status,version:st.json?.version,risk:st.json?.worker?.risk}));
 if(fail)process.exitCode=1;
})();
