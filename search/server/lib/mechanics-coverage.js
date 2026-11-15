'use strict';
// Thin, strictly additive Mechanics wrapper. The protected source-verification and
// evidence precedence function in mechanics-deep.enrich remains byte-identical.
const deep=require('./mechanics-deep'),gap=require('./mechanics-gaps');
function annotateCard(card){
 if(!card?.fields||typeof card.fields!=='object')return card;
 let changed=false;const fields={...card.fields};
 for(const [key,field]of Object.entries(fields)){
  if(field?.dataState==='DATA_FOUND'||!field?.analysisDiagnostics)continue;
  const next=gap.explain(key,field,field.analysisDiagnostics);
  if(next!==field){fields[key]=next;changed=true;}
 }
 return changed?{...card,fields}:card;
}
// Mechanics V5: Transfer Restrictions is a supplementary, evidence-only field. It is kept OUT of card.fields so the four
// visible rows and the 20-check Search contract are unchanged; the UI shows it under 'View sources & evidence'.
const {chain}=require('./chains');
function restrictionGap(card,network){
 const cfg=chain(network);
 const diagnostics=Object.values(card.fields||{}).map(f=>f?.analysisDiagnostics).find(Boolean)||null;
 const base={value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',chainId:cfg.chainId,network,source:null,evidence:[],
  ...(diagnostics?{analysisDiagnostics:diagnostics}:{}),
  reasonCode:'RESTRICTIONS_NOT_REVIEWED',reason:'No reviewed transfer-restriction evidence for this exact runtime. A missing pause or blacklist selector does not prove that transfers cannot be blocked.'};
 const explained=diagnostics?gap.explain('transferRestrictions',{...base,reasonCode:'RESTRICTIONS_NOT_VERIFIED'},diagnostics):base;
 return explained.reasonCode==='RESTRICTIONS_NOT_VERIFIED'?base:explained;
}
function supplement(card,network){
 if(!card?.fields||typeof card.fields!=='object')return card;
 const extra=card.supplementary&&typeof card.supplementary==='object'?card.supplementary:{};
 const restriction=extra.transferRestrictions?.dataState==='DATA_FOUND'?extra.transferRestrictions:restrictionGap(card,network);
 return {...card,supplementary:{...extra,transferRestrictions:restriction}};
}
async function enrich(options){
 // deep.enrich (protected, byte-identical) forwards its options to deep.inspect, which reports supplementary evidence here.
 let extra=null;
 const enriched=annotateCard(await deep.enrich({...options,onSupplementary:s=>{extra=s;}}));
 const card=supplement(extra?{...enriched,supplementary:{...(enriched?.supplementary||{}),...extra}}:enriched,options.network);
 // Inert unless the Risk Engine public flag is explicitly enabled; reads only a signed worker snapshot, never RPC.
 return require('./mechanics-risk-evidence').attach(card,{network:options.network,address:options.address,env:options.env||process.env,reader:options.riskReader||null});
}
module.exports={enrich,annotateCard,supplement,restrictionGap};
