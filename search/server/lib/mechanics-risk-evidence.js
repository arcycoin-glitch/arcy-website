'use strict';
// Optional Risk Engine reuse for Contract & Mechanics (V5). INERT unless ARC_AUTONOMY_RISK_PUBLIC_ENABLED === 'true', which
// stays OFF until the Risk Engine acceptance conditions are met. When enabled it issues NO blockchain request: it reads the
// worker's Ed25519-signed snapshot (lib/risk-engine/publication.js verify: signature, network, chainId, token, digest) and
// reuses only the reviewed sell-transfer-tax record, which already carries its own block, observation time and
// two-operator agreement state.
//  - Agreement with reviewed Mechanics tax evidence: the record is attached as corroborating evidence only.
//  - Disagreement: no tax value is shown (fail closed); both observations stay in the evidence.
//  - No reviewed Mechanics tax: a two-operator VERIFIED_ONCHAIN deduction >= 1% may be shown as a simulated SELL deduction
//    only; buy and wallet-transfer taxes remain NOT VERIFIED. A record below 1%, unverified, stale or missing adds nothing.
const MAX_AGE_MS=24*3600*1000,THRESHOLD_BPS=100;
const SUPPORTED=new Set(['ethereum','robinhood']);
const CHAIN={ethereum:1,robinhood:4663};
const pct=bps=>Number((bps/100).toFixed(2));
function enabled(env){return env?.ARC_AUTONOMY_RISK_PUBLIC_ENABLED==='true';}
function record(snapshot,network,address){
 const token=address.toLowerCase();
 return (Array.isArray(snapshot?.records)?snapshot.records:[]).find(r=>r?.metricId==='risk.sell-transfer-tax'&&r.network===network&&String(r.token||'').toLowerCase()===token)||null;
}
function sellPercent(value){
 const s=/\bSell\s+([0-9]+(?:\.[0-9]+)?)%/.exec(String(value||''));if(s)return Number(s[1]);
 // A reviewed full-value transfer claim ("Transfer 0% · …") covers transfers into a pool as well.
 return /^Transfer\s+0%/.test(String(value||''))?0:null;
}
async function attach(card,{network,address,env=process.env,reader=null,now=Date.now()}={}){
 if(!enabled(env)||!card?.fields?.tradingTaxes||!SUPPORTED.has(network)||!/^0x[0-9a-f]{40}$/i.test(address||''))return card;
 const client=reader||require('../../../lib/risk-engine/publication').remote({env});
 if(!client||typeof client.getSnapshot!=='function')return card;
 let snapshot=null;try{snapshot=await client.getSnapshot(network,address.toLowerCase());}catch{return card;}
 const r=record(snapshot,network,address);if(!r)return card;
 const observed=Date.parse(r.observedAt||''),age=now-observed;
 const item={source:'ARCY Risk Engine signed snapshot',method:'Pinned sell-transfer state-override simulation (Risk Engine)',chainId:CHAIN[network],network,token:address.toLowerCase(),
  block:r.block?.number!==undefined?'0x'+BigInt(r.block.number).toString(16):null,blockHash:r.block?.hash||null,observedAt:r.observedAt||null,recordState:r.state,reasonCode:r.reasonCode||null,
  deductionBps:Number.isFinite(r.value)?r.value:null,operators:(r.observations||[]).map(o=>o?.source?.operator).filter(Boolean).slice(0,4),
  scope:'Simulated transfer from an unprivileged holder into the reviewed pool at the record block; token-side deduction only. DEX fees, slippage, gas and liquidity effects are excluded. Observed at a separate block from the Mechanics analysis.'};
 const usable=r.state==='VERIFIED_ONCHAIN'&&Number.isFinite(r.value)&&r.value>=0&&r.value<=10000&&Number.isFinite(observed)&&age>=0&&age<=MAX_AGE_MS;
 const tax=card.fields.tradingTaxes,fields={...card.fields};
 if(!usable){
  if(tax.dataState==='DATA_FOUND')fields.tradingTaxes={...tax,evidence:[...(tax.evidence||[]),{...item,status:age>MAX_AGE_MS?'STALE':'NOT_USED'}]};
  return {...card,fields};
 }
 if(tax.dataState==='DATA_FOUND'){
  const claimed=sellPercent(tax.value);
  if(claimed!==null&&Math.abs(claimed-pct(r.value))>0.5&&(r.value>=THRESHOLD_BPS||claimed>=1)){
   fields.tradingTaxes={value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',chainId:tax.chainId,network:tax.network,source:null,
    reasonCode:'MECHANICS_RISK_EVIDENCE_CONFLICT',reason:'Reviewed source evidence and the Risk Engine sell simulation disagree; no tax value is shown.',
    evidence:[...(tax.evidence||[]).map(e=>({...e,conflictingObservation:tax.value})),{...item,status:'CONFLICTING'}]};
  }else fields.tradingTaxes={...tax,evidence:[...(tax.evidence||[]),{...item,status:'CORROBORATING'}]};
  return {...card,fields};
 }
 if(r.value<THRESHOLD_BPS)return card;
 fields.tradingTaxes={value:'Sell '+pct(r.value)+'% (simulated) · Buy/Transfer NOT VERIFIED',status:'SIMULATED_ONCHAIN',dataState:'DATA_FOUND',
  chainId:CHAIN[network],network,source:'ARCY Risk Engine signed snapshot',freshness:{block:item.block,retrievedAt:r.observedAt},
  evidence:[{...item,address:address.toLowerCase(),status:'VERIFIED_ONCHAIN'}],scope:item.scope,
  ...(tax.reasonCode?{previousReasonCode:tax.reasonCode}:{})};
 return {...card,fields};
}
module.exports={attach,enabled,MAX_AGE_MS,THRESHOLD_BPS};
