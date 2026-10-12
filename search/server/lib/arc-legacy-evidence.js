'use strict';
// Exact Arc-only compatibility bridge to the mature *original website* Search
// source adapters. No HTTP roundtrip, no worker actions, no transfer/signer API.
// Existing production endpoints are not modified.
const CHAIN=5042,NETWORK='arc',ADDRESS=/^0x[0-9a-f]{40}$/;
// Literal requires are essential for Vercel's serverless dependency tracing.
// Never use a computed require(path.join(...)) for production legacy modules.
const ORIGINAL=Object.freeze({
 holders:()=>require('../../../api/holders'),
 liquidity:()=>require('../../../api/liquidity'),
 activity:()=>require('../../../lib/activity-route'),
 mechanics:()=>require('../../../api/mechanics'),
 market:()=>require('../../../api/market')
});
const NO=(reason,reasonCode='SOURCE_NOT_VERIFIED')=>({value:null,status:'NOT_VERIFIED',
 dataState:'NOT_VERIFIED',source:null,evidence:[],network:NETWORK,chainId:CHAIN,
 reason,reasonCode});
const VALID=new Set(['ONCHAIN_VERIFIED','ON_CHAIN','ON_CHAIN_VERIFIED_UNITS',
 'VERIFIED_SOURCE','VERIFIED_SOURCE_AND_STATE','MARKET_API_VERIFIED',
 'GETTER_REPORTED','SOURCE_REPORTED','DETECTED','NOT_DETECTED','VERIFIED',
 'SIGNED_ONCHAIN_SNAPSHOT','INDEXER_VERIFIED','OFFICIAL_DOCUMENTATION']);
function sourceField(field,address,scope){
 if(!ADDRESS.test(address)||!field||typeof field!=='object'||
  field.dataState!=='DATA_FOUND'||field.value===undefined||field.value===null||
  !VALID.has(field.status)||typeof field.source!=='string'||!field.source||
  !Array.isArray(field.evidence)||!field.evidence.length||
  (typeof field.value==='number'&&!Number.isFinite(field.value)))
  return NO('The original Arc adapter has no complete source-backed evidence for this field.');
 // The legacy route pins itself to Arc chain 5042 and a validated contract;
 // preserve its block/source/evidence, annotate the exact call identity.
 return {...field,network:NETWORK,chainId:CHAIN,evidence:[
  ...field.evidence,{chainId:CHAIN,network:NETWORK,address,
   legacySource:'Original ARCY SEARCH Arc source reader',scope}
 ]};
}
function selectedBoolOrText(field,address,scope){
 const raw=sourceField(field,address,scope);
 if(raw.dataState!=='DATA_FOUND')return raw;
 const val=raw.value;
 if(typeof val!=='boolean'&&typeof val!=='string'&&typeof val!=='number')
  return NO('The verified Arc capability has an unsupported result type.','UNSUPPORTED_CAPABILITY_TYPE');
 return raw;
}
async function callOriginal(name,address,options={},custom){
 if(!Object.hasOwn(ORIGINAL,name)||!ADDRESS.test(address))
  throw Error('Invalid Arc legacy adapter request');
 const handler=custom||ORIGINAL[name]();
 if(typeof handler!=='function')throw Error('Original Arc route missing');
 const req={method:'GET',query:{...options,address},headers:{}};
 const res={statusCode:200,
  setHeader(){return this},status(code){this.statusCode=code;return this},
  json(value){this.body=value;return value}};
 await handler(req,res);
 if(res.statusCode!==200||res.body?.ok!==true||res.body.address!==address||
  res.body.chainId!==CHAIN)throw Error('Original Arc source returned an unverified contract identity');
 return res.body;
}
function contract(result,address){
 if(!result?.contractFields)return {};
 const legacy=result.contractFields;
 const taxBuy=sourceField(legacy.buyTax,address,'Reviewed onchain or independently verified buy tax');
 const taxSell=sourceField(legacy.sellTax,address,'Reviewed onchain or independently verified sell tax');
 const taxes=taxBuy.dataState==='DATA_FOUND'&&taxSell.dataState==='DATA_FOUND'&&
  [taxBuy.value,taxSell.value].every(n=>typeof n==='number'&&n>=0&&n<=100)?
  {value:'Buy '+taxBuy.value+'% · Sell '+taxSell.value+'%',status:'SOURCE_REPORTED',
   dataState:'DATA_FOUND',source:taxBuy.source===taxSell.source?taxBuy.source:
    taxBuy.source+' / '+taxSell.source,network:NETWORK,chainId:CHAIN,
   evidence:[...taxBuy.evidence,...taxSell.evidence],
   scope:'Token-level/source-reported trade taxes; pool and hook fees may be additional.'}:
  NO('Both buy and sell tax rates require valid explicit source evidence.','TRADE_TAX_PAIR_UNVERIFIED');
 const mint=selectedBoolOrText(legacy.mint,address,
  'Reviewed token mint control. NOT_DETECTED applies only to the inspected runtime.');
 const owner=selectedBoolOrText(legacy.ownerAdmin,address,
  'Current validated Arc owner/admin control; not proof that all roles were enumerated.');
 const proxy=legacy.proxyUpgradeable;
 const implementation=sourceField(proxy,address,'Pinned Arc proxy/implementation observation.');
 let architecture=NO('Verified Arc implementation/proxy structure could not be established.',
  'ARC_PROXY_ARCHITECTURE_UNVERIFIED');
 if(implementation.dataState==='DATA_FOUND'&&
  typeof implementation.value==='string'&&/^0x[0-9a-f]{40}$/i.test(implementation.value))
  architecture={...implementation,value:'Observed proxy/implementation: '+implementation.value,
   scope:'Implementation observed only. Upgradeability and actual upgrade admin require independent proof.'};
 else if(proxy?.upgradeable){
  const upgrade=selectedBoolOrText(proxy.upgradeable,address,'Reviewed upgradeable proxy authority');
  if(upgrade.dataState==='DATA_FOUND'&&upgrade.value===true)
   architecture={...upgrade,value:'Upgradeable proxy capability verified'};
 }
 return {tradingTaxes:taxes,mintCapability:mint,ownerAdmin:owner,contractArchitecture:architecture};
}
function liquidity(result,address){
 const field=result?.fields?.lpStatus||result?.lpStatus;
 const lp=selectedBoolOrText(field,address,'LP custody and transfer/lock evidence for verified Arc pools.');
 // Never promote a pool description or ordinary liquidity figure as LP lock proof.
 if(lp.dataState!=='DATA_FOUND'||!['BURNED','UNLOCKED','UNLOCKED (POSITION)'].includes(lp.value))
  return NO('No complete reviewed Arc LP burn/transfer/locker evidence for source-returned pools.',
   'ARC_LP_CUSTODY_NOT_PROVED');
 return lp;
}
function circulation(result,address){
 return sourceField(result?.field,address,'Contract-matched circulating supply from established providers.');
}
const MAX_HOLDER_AGE_MS=48*60*60*1000;
function holders(result,address,{now=Date.now()}={}){
 const output={};
 const date=Date.parse(result?.snapshot?.completedAt||result?.scannedAt||'');
 const fresh=Number.isFinite(date)&&date>=now-MAX_HOLDER_AGE_MS&&date<=now+60000;
 for(const name of ['holderCount','largestWalletPct','top10Pct','top20Pct']){
  const candidate=result?.fields?.[name];
  const validated=sourceField(candidate,address,'Historical COMPLETE Arc holder snapshot, not live.');
  if(validated.dataState==='DATA_FOUND'&&result?.coverage?.complete!==true)
   output[name]=NO('Legacy holder read is not a complete reconciled snapshot.','ARC_HOLDER_COVERAGE_INCOMPLETE');
  else if(validated.dataState==='DATA_FOUND'&&!fresh){
   // Show completed historical readings only with explicit age, never as current balances.
   const age=Number.isFinite(date)?new Date(date).toISOString():null;
   output[name]=age&&date>=now-30*86400000?{
    ...validated,status:'HISTORICAL_ONCHAIN_VERIFIED',
    freshness:{state:'LAST_VERIFIED',observedAt:age},
    reason:'Historical complete snapshot from '+age+'. Not a current wallet balance or concentration reading.'
   }:NO('Historical holder snapshot is too old to publish.','ARC_HOLDER_SNAPSHOT_STALE');
  }
  else output[name]=validated;
 }
 return output;
}
module.exports={callOriginal,contract,liquidity,circulation,holders,sourceField,NO,MAX_HOLDER_AGE_MS};
