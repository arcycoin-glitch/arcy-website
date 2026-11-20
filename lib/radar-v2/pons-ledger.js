'use strict';
// Seed for the Pons launch ledger from earlier snapshots: their own ledger, plus Pons rows whose launch was verified on-chain
// (status ONCHAIN_VERIFIED with an exact factory address). Factory membership never expires; nothing is inferred from symbols.
const ADDRESS=/^0x[0-9a-f]{40}$/;
function seedLedger(docs){
 const out=new Map();
 for(const d of Array.isArray(docs)?docs:[]){
  if(!d||typeof d!=='object')continue;
  for(const e of Array.isArray(d.ponsLaunchLedger)?d.ponsLaunchLedger:[]){const a=String(e?.address||'').toLowerCase(),f=String(e?.factory||'').toLowerCase();
   if(ADDRESS.test(a)&&ADDRESS.test(f)&&Number.isFinite(Date.parse(e?.verifiedAt||''))&&!out.has(a))out.set(a,{address:a,factory:f,verifiedAt:e.verifiedAt});}
  const at=Number.isFinite(Date.parse(d.generatedAt||''))?d.generatedAt:null;
  for(const r of Array.isArray(d.sections?.pons?.rows)?d.sections.pons.rows:[]){const a=String(r?.address||'').toLowerCase(),f=String(r?.launch?.factory||'').toLowerCase();
   if(at&&r?.launch?.status==='ONCHAIN_VERIFIED'&&ADDRESS.test(a)&&ADDRESS.test(f)&&!out.has(a))out.set(a,{address:a,factory:f,verifiedAt:at});}
 }
 return [...out.values()].slice(0,1000);
}
module.exports={seedLedger};
