'use strict';
const keccak=require('../../../lib/keccak');
const {addressWord}=require('./admin-getters');
const {root}=require('./mechanics-v8-authority');
const STORAGE=keccak(Buffer.from('diamond.standard.diamond.storage'));
const OWNER='0x'+(BigInt(STORAGE)+4n).toString(16).padStart(64,'0');
const CUT='diamondCut((address,uint8,bytes4[])[],address,bytes)';
const SIGNATURES=[CUT,'transfer(address,uint256)','transferFrom(address,address,uint256)','owner()'];
const selector=signature=>keccak(Buffer.from(signature)).slice(0,10);
const slot=sel=>keccak(Buffer.from(sel.slice(2).padEnd(64,'0')+STORAGE.slice(2),'hex'));
const word=/^0x[0-9a-f]{64}$/i;

// This storage layout comes from the exact reviewed LibDiamond bundle; EIP-2535
// itself doesn't mandate it. Reading a loupe does not attest selector routing.
async function resolve({subject,source,storageAt,codeAt,sourceAt,stamp}){
 if(source?.runtimeFamily?.kind!=='DIAMOND')return null;
 const checks=await Promise.all(SIGNATURES.map(async signature=>{
  const selectorValue=selector(signature),storageSlot=slot(selectorValue),raw=await storageAt(storageSlot);
  const facet=word.test(raw||'')?addressWord('0x'+raw.slice(-40).padStart(64,'0')):null;
  const code=facet&&facet!==subject?await codeAt(facet):null;
  const status=!word.test(raw||'')?'UNKNOWN':!facet?'NOT_APPLICABLE':code?'VERIFIED':'UNSUPPORTED';
  return {facet,code,proof:stamp({signature,selector:selectorValue,slot:storageSlot,contractAddress:subject,
   facet,packedStorageWord:word.test(raw||'')?raw:null,sourceDigest:source.digest,
   sourceReference:source.runtimeFamily.sourceReference,storageContext:subject},
  'DIAMOND_SELECTOR_ROUTE','Pinned source-defined selector storage and facet bytecode',status)};
 }));
 const cut=checks[0];
 let authority=root(null,'DIAMOND_CUT','Diamond cut authorization','UNKNOWN_AUTHORITY',source);
 if(cut.code){
  const targetSource=await sourceAt(cut.facet,cut.code);
  if(targetSource?.runtimeFamily?.kind==='DIAMOND_CUT'){
   const owner=addressWord(await storageAt(OWNER));
   authority=root(owner,'DIAMOND_CUT',CUT,owner?'CONFIRMED_AUTHORITY':'UNKNOWN_AUTHORITY',targetSource,
    {method:'Bound cut selector, reviewed facet owner guard and pinned diamond owner slot',checkedSlot:OWNER,implementation:cut.facet});
  }
 }
 return {routes:checks.map(x=>x.proof),authority};
}
module.exports={resolve,slot,OWNER,CUT};
