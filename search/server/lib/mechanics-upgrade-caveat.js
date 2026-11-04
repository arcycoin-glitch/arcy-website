'use strict';
// An absence finding about the CURRENT implementation is not permanent behind an upgradeable proxy: whoever controls the
// implementation/beacon slot can replace the code. Keep the verified finding, but never present it as a final 'NONE ✓'.
const UPGRADEABLE=new Set(['EIP-1967 implementation','Legacy implementation slot','EIP-1967 beacon']);
function qualifyUpgradeable(fields,kind,{admin=null,beacon=null}={}){
 if(!UPGRADEABLE.has(kind))return fields;
 const caveat={upgradeCaveat:'Upgradeable proxy ('+kind+'): this finding covers the current implementation only; the upgrade authority can replace it.',upgradeAuthority:admin||beacon||null};
 const mint=fields.mintCapability;
 if(mint?.dataState==='DATA_FOUND'&&/^NONE (?:DETECTED|ACTIVE)/.test(String(mint.value)))fields.mintCapability={...mint,value:'No direct mint · upgradeable',evidence:[...(mint.evidence||[]),{method:'Upgradeability qualification',originalValue:mint.value,...caveat}]};
 const owner=fields.ownerAdmin;
 if(owner?.dataState==='DATA_FOUND'&&/^(?:No token owner\/admin|Ownership renounced)/.test(String(owner.value))&&!/upgrade/i.test(String(owner.value)))fields.ownerAdmin={...owner,value:String(owner.value).split(' · ')[0]+' · upgradeable proxy',evidence:[...(owner.evidence||[]),{method:'Upgradeability qualification',originalValue:owner.value,...caveat}]};
 return fields;
}
module.exports={qualifyUpgradeable,UPGRADEABLE};
