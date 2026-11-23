'use strict';
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const ZERO='0x'+'0'.repeat(40);
const address=x=>typeof x==='string'&&ADDRESS.test(x)?x.toLowerCase():null;
function recorder({chainId,network,address:subjectAddress,block,provider,observedAt=new Date().toISOString()}){
 return (entry,evidenceType,method,verificationStatus)=>({
  ...entry,chainId,network,address:entry.address||subjectAddress,subjectAddress,block,provider,observedAt,
  evidenceType,method,verificationStatus
 });
}
module.exports={address,ZERO,recorder};
