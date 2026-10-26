'use strict';
// Non-gating public production audit. Never logs credentials or provider secrets.
// DATA_FOUND is provider/evidence availability, not independently verified truth.
const origin='https://www.arcyusdc.xyz';
const sample=[
 ['arc','ARCY','0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'],
 ['arc','TOLLY','0xbc43ce8dec648ea298c4275559b81d6261c90b67'],
 ['arc','cirBTC','0x171a4217b86a807a64eb94757db6849fb4bdbaa0'],
 ['ethereum','USDT','0xdac17f958d2ee523a2206206994597c13d831ec7'],
 ['ethereum','USDC','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
 ['ethereum','ONDO','0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3'],
 ['robinhood','LINK','0x492641f648a4986844848e0befe66d14817bce34'],
 ['robinhood','TSLA','0x322f0929c4625ed5bad873c95208d54e1c003b2d'],
 ['robinhood','PONS','0x39dbed3a2bd333467115de45665cc57f813c4571']
];
async function get(path,ms=22000){
 try{const response=await fetch(origin+path,{headers:{accept:'application/json'},signal:AbortSignal.timeout(ms)});
 const body=await response.json();return {http:response.status,body};}
 catch(e){return {error:e.name==='TimeoutError'?'TIMEOUT':'UNREACHABLE_OR_INVALID_JSON'};}
}
function cardSummary(card){const f=card?.fields||{};return {found:Object.values(f).filter(v=>v?.dataState==='DATA_FOUND'&&v.value!==null&&v.value!==undefined).length,total:Object.keys(f).length};}
async function report([chain,symbol,address]){
 const r=await get('/api/search?action=report&chain='+chain+'&address='+address);
 if(!r.body?.ok)return {chain,symbol,http:r.http||null,error:r.body?.error||r.error||'UNAVAILABLE'};
 const cards=r.body.cards||{},mechanics=cards.mechanics?.fields||{};
 return {chain,symbol,block:r.body.block,supply:cardSummary(cards.supply),holder:cardSummary(cards.holders),
 liquidity:cardSummary(cards.liquidity),market:cardSummary(cards.activity),mechanics:cardSummary(cards.mechanics),
 tradingTaxes:mechanics.tradingTaxes?.dataState==='DATA_FOUND'?String(mechanics.tradingTaxes.value).slice(0,140):'NOT_VERIFIED',
 mint:mechanics.mintCapability?.dataState,owner:mechanics.ownerAdmin?.dataState,architecture:mechanics.contractArchitecture?.dataState};
}
(async()=>{
 const output=[];
 for(let i=0;i<sample.length;i+=3)output.push(...await Promise.all(sample.slice(i,i+3).map(report)));
 console.log('LIVE_NINE_TOKEN_AUDIT '+JSON.stringify({date:new Date().toISOString(),results:output}));
 const mechanics=await get('/api/mechanics?address='+sample[0][2]);
 const m=mechanics.body||{};
 console.log('ARCY_ORIGINAL_MECHANICS '+JSON.stringify({http:mechanics.http||null,error:mechanics.error||null,
  coverage:m.analysisCoverage||null,block:m.block||null,
  buy:m.contractFields?.buyTax?.dataState==='DATA_FOUND'?m.contractFields.buyTax.value:'NOT_VERIFIED',
  sell:m.contractFields?.sellTax?.dataState==='DATA_FOUND'?m.contractFields.sellTax.value:'NOT_VERIFIED',
  transfer:m.contractFields?.transferTax?.dataState==='DATA_FOUND'?m.contractFields.transferTax.value:'NOT_VERIFIED',
  hookEvidenceCount:m.hookEvidence?.length||0}));
 const originalCard=require('../search/server/lib/arc-legacy-evidence').contract(m,sample[0][2]);
 const tax=originalCard.tradingTaxes;
 console.log('ARCY_BRIDGE_DIAGNOSTIC '+JSON.stringify({state:tax?.dataState,status:tax?.status,
  source:tax?.source,value:tax?.value,
  proof:(tax?.evidence||[]).slice(0,3).map(e=>({source:e.source,chainId:e.chainId,
   address:e.address,block:e.block,hookSourceDigest:!!e.hookSourceDigest,
   sourceDigest:!!e.sourceDigest,method:e.method}))}));
 const pulse=await get('/api/pulse?chains=all',22000),p=pulse.body||{};
 console.log('LIVE_PULSE_AUDIT '+JSON.stringify({http:pulse.http||null,error:pulse.error||null,
  arc:{status:p.status||null,cards:p.cards?.length||0},
  networks:Object.fromEntries(['ethereum','robinhood'].map(chain=>[chain,{
    status:p.chains?.[chain]?.status||'UNAVAILABLE',
    publicationAvailability:p.chains?.[chain]?.publicationAvailability||null,
    verifiedCards:(p.chains?.[chain]?.cards||[]).filter(c=>c.contentType==='VERIFIED_DEVELOPMENT').length,
    sourceChecked:p.chains?.[chain]?.audit?.sourcesSuccessfullyChecked??null
  }]))}));
})().catch(e=>{console.log('LIVE_AUDIT_UNAVAILABLE '+String(e?.code||e?.name||'UNKNOWN'));});
