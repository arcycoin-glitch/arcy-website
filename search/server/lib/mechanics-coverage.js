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
 // Pure evidence-bound refinement for reviewed, non-delegating OZ templates.
 // Never touches non-Mechanics cards, changes the number of visible rows, or performs RPC.
 const qualified=require('./mechanics-template-tax').upgrade(enriched,{network:options.network,address:options.address,
  block:options.block,chainId:chain(options.network).chainId});
 const card=supplement(extra?{...qualified,supplementary:{...(qualified?.supplementary||{}),...extra}}:qualified,options.network);
 // Inert unless the Risk Engine public flag is explicitly enabled; reads only a signed worker snapshot, never RPC.
 return require('./mechanics-risk-evidence').attach(attributeFees(card,options),{network:options.network,address:options.address,env:options.env||process.env,reader:options.riskReader||null});
}
function attributeFees(card,{network,address,block}){
 const cfg=chain(network);
 return require('./mechanics-v8-fees').attach(card,{chainId:cfg.chainId,network,address,block,provider:cfg.label+' RPC / reviewed evidence'});
}
module.exports={enrich,annotateCard,supplement,restrictionGap,attributeFees};
