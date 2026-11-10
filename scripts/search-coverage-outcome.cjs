'use strict';
const VERIFIED=new Set(['ON_CHAIN_VERIFIED','CROSS_VERIFIED']);
function outcome({field,reportAvailable=false,cardStatus=null,evidenceClass='NOT_VERIFIED'}={}){
 if(evidenceClass==='STALE'||field?.freshness?.state==='STALE')return 'STALE';
 if(VERIFIED.has(evidenceClass))return 'VERIFIED';
 if(!reportAvailable||field?.dataState==='SOURCE_API_FAILED')return 'UNAVAILABLE';
 if(field?.dataState==='DATA_FOUND')return 'SINGLE_SOURCE';
 if(cardStatus==='PARTIAL_EVIDENCE'||!field||field.dataState==='NOT_VERIFIED')return 'INCOMPLETE';
 return 'INCOMPLETE';
}
module.exports={outcome};
