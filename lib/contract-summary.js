const c=require('./core');
function normalize(field){
 const established=field?.value!==null&&field?.value!==undefined&&['ON_CHAIN','ONCHAIN_VERIFIED','ON_CHAIN_VERIFIED_UNITS','VERIFIED_SOURCE','VERIFIED_SOURCE_AND_STATE','MARKET_API_VERIFIED','GETTER_REPORTED','DETECTED','NOT_DETECTED'].includes(field.status)&&field.dataState==='DATA_FOUND'&&Array.isArray(field.evidence)&&field.evidence.length>0;
 if(!established)return {...(field||c.unknown()),value:null,status:'NOT_VERIFIED',dataState:field?.dataState==='SOURCE_API_FAILED'?'SOURCE_API_FAILED':'NOT_VERIFIED',evidence:field?.evidence||[]};
 if(field.value===false&&field.status!=='NOT_DETECTED')return {...field,value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reason:'A state boolean alone does not establish absence of a capability.'};
 return {...field,status:field.status==='NOT_DETECTED'?'NOT_DETECTED':'VERIFIED',originalStatus:field.status};
}
function present(result){
 const authority=[result.owner,result.admin].filter(f=>/^0x[0-9a-f]{40}$/i.test(f?.value||'')&&!c.BURNS.includes(f.value.toLowerCase())&&normalize(f).status==='VERIFIED');
 const ownerAdmin=authority.length?{...c.fact(true,authority.flatMap(f=>f.evidence),'GETTER_REPORTED'),scope:'Validated owner/admin address detected. Detailed permissions and observational-only owners are distinguished in evidence.',authority:result.ownerAuthority}:c.unknown('No validated nonzero owner/admin established. A failed getter does not prove renounced control.','OWNER_ADMIN_NOT_ESTABLISHED');
 const proxy=normalize(result.proxy);let upgradeable=c.unknown('A proxy address alone does not establish upgrade authority.','UPGRADEABILITY_NOT_ESTABLISHED');
 if(result.proxySource?.profile?.id==='FIAT_TOKEN_PROXY'&&proxy.status==='VERIFIED')upgradeable=c.fact(true,[...proxy.evidence,{source:'Bytecode-matched reviewed proxy source',sourceDigest:result.proxySource.sourceDigest,profile:'FIAT_TOKEN_PROXY',block:result.block,scope:'Reviewed admin-controlled proxy upgrade path; capability, not proof that a future upgrade occurs.'}],'VERIFIED_SOURCE');
 else if(proxy.evidence?.some(e=>e.method==='EIP-1167 runtime'))upgradeable={...c.unknown('EIP-1167 fixes the outer target address; this alone does not establish the absence of upgrade/control paths inside that implementation.','IMPLEMENTATION_UPGRADE_PATH_NOT_ESTABLISHED'),evidence:proxy.evidence};
 const fields={buyTax:normalize(result.buyTax),sellTax:normalize(result.sellTax),transferTax:normalize(result.transferTax),burnMechanism:normalize(result.burnMechanism),buybackMechanism:normalize(result.buybackAndBurn),mint:normalize(result.mint),pause:normalize(result.pause),blacklist:normalize(result.blacklist),ownerAdmin:normalize(ownerAdmin),proxyUpgradeable:{...proxy,upgradeable:normalize(upgradeable)}};
 for(const key of ['buyTax','sellTax','transferTax'])if(fields[key].value!==null&&(!Number.isFinite(fields[key].value)||fields[key].value<0||fields[key].value>100))fields[key]={...c.unknown('Invalid established percentage.','INVALID_TAX_VALUE')};
 return {...result,contractFields:fields,verificationScope:'Exact Arc contract/current implementation. Token taxes do not establish external DEX/hook trading fees.'};
}
module.exports={normalize,present};
