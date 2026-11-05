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
async function enrich(options){return annotateCard(await deep.enrich(options));}
module.exports={enrich,annotateCard};
