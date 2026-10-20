const c=require('./core');
function normalize(field){
 // A security provider's negative is not a complete reviewed absence proof.
 // Retain the original field in the response/evidence, but do not certify it.
 if(field?.value===false&&(field.verificationStatus==='MARKET_API_VERIFIED'||field.source==='GoPlus'))return {...field,value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reasonCode:'SECONDARY_ABSENCE_NOT_PROVEN',reason:'External security-source absence is not an independent proof that every capability path is absent.'};
 const established=field?.value!==null&&field?.value!==undefined&&['ON_CHAIN','ONCHAIN_VERIFIED','ON_CHAIN_VERIFIED_UNITS','VERIFIED_SOURCE','VERIFIED_SOURCE_AND_STATE','MARKET_API_VERIFIED','GETTER_REPORTED','DETECTED','NOT_DETECTED'].includes(field.status)&&field.dataState==='DATA_FOUND'&&Array.isArray(field.evidence)&&field.evidence.length>0;
 if(!established)return {...(field||c.unknown()),value:null,status:'NOT_VERIFIED',dataState:field?.dataState==='SOURCE_API_FAILED'?'SOURCE_API_FAILED':'NOT_VERIFIED',evidence:field?.evidence||[]};
 if(field.value===false&&field.status!=='NOT_DETECTED')return {...field,value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reason:'A state boolean alone does not establish absence of a capability.'};
 const secondary=field.verificationStatus==='MARKET_API_VERIFIED'||field.source==='GoPlus';
 return {...field,status:secondary?'SOURCE_REPORTED':field.status==='NOT_DETECTED'?'NOT_DETECTED':'VERIFIED',originalStatus:field.status};
}
function present(result,context){
 const roleAuthorities=result.verifiedSource?.profile?.id==='FIAT_TOKEN_V2_2'?['masterMinter','pauser','blacklister'].map(role=>result.roles?.[role]).filter(Boolean):[];
 const authority=[result.owner,result.admin,...roleAuthorities].filter(f=>/^0x[0-9a-f]{40}$/i.test(f?.value||'')&&!c.BURNS.includes(f.value.toLowerCase())&&normalize(f).status==='VERIFIED');
 const ownerAdmin=authority.length?{...c.fact(true,authority.flatMap(f=>f.evidence),'GETTER_REPORTED'),scope:'Validated owner/admin or reviewed permissioned-role address detected. Detailed permissions and observational-only owners are distinguished in evidence; zero owner does not renounce surviving roles.',authority:result.ownerAuthority}:result.ownerAbsence?.status==='NOT_DETECTED'?result.ownerAbsence:c.unknown('No validated nonzero owner/admin established. A failed getter does not prove renounced control.','OWNER_ADMIN_NOT_ESTABLISHED');
 const proxy=normalize(result.proxy);let upgradeable=c.unknown('A proxy address alone does not establish upgrade authority.','UPGRADEABILITY_NOT_ESTABLISHED');
 if(result.proxySource?.profile?.id==='FIAT_TOKEN_PROXY'&&proxy.status==='VERIFIED')upgradeable=c.fact(true,[...proxy.evidence,{source:'Bytecode-matched reviewed proxy source',sourceDigest:result.proxySource.sourceDigest,profile:'FIAT_TOKEN_PROXY',block:result.block,scope:'Reviewed admin-controlled proxy upgrade path; capability, not proof that a future upgrade occurs.'}],'VERIFIED_SOURCE');
 else if(proxy.evidence?.some(e=>e.method==='EIP-1167 runtime'))upgradeable={...c.unknown('EIP-1167 fixes the outer target address; this alone does not establish the absence of upgrade/control paths inside that implementation.','IMPLEMENTATION_UPGRADE_PATH_NOT_ESTABLISHED'),evidence:proxy.evidence};
 const fields={buyTax:normalize(result.buyTax),sellTax:normalize(result.sellTax),transferTax:normalize(result.transferTax),burnMechanism:normalize(result.burnMechanism),buybackMechanism:normalize(result.buybackAndBurn),mint:normalize(result.mint),pause:normalize(result.pause),blacklist:normalize(result.blacklist),ownerAdmin:normalize(ownerAdmin),proxyUpgradeable:{...proxy,upgradeable:normalize(upgradeable)}};
 for(const key of ['buyTax','sellTax','transferTax'])if(fields[key].value!==null&&(!Number.isFinite(fields[key].value)||fields[key].value<0||fields[key].value>100))fields[key]={...c.unknown('Invalid established percentage.','INVALID_TAX_VALUE')};
 if(context?.chainId===5042&&/^0x[0-9a-f]{40}$/i.test(context.address||'')&&/^0x[0-9a-f]+$/i.test(context.block||'')&&context.block===result.block){
  for(const field of Object.values(fields))if(field.dataState==='DATA_FOUND')field.evidence=[{
   chainId:5042,network:'arc',address:context.address.toLowerCase(),block:context.block,
   source:field.source||result.source||'Arc RPC / reviewed contract evidence',method:'Mechanics summary subject binding',
   verificationStatus:field.originalStatus||field.status,scope:'Primary subject is the token; subsequent storage values, implementation addresses and authority addresses retain their distinct original meanings.'
  },...field.evidence];
 }
 return {...result,contractFields:fields,verificationScope:'Exact Arc contract/current implementation. Token taxes do not establish external DEX/hook trading fees.'};
}
module.exports={normalize,present};
