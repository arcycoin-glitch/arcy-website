'use strict';

const CLONE = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i;

// Only follow targets encoded in an exact clone runtime. Storage-based
// pointers belong to the original delegatecall context, never the child.
async function resolveClonePath({address,target,targetCode,deployed}) {
 const addresses=[address,target];
 const seen=new Set(addresses);
 let code=targetCode;
 for(let i=0;i<3;i++){
  const match=CLONE.exec(code);
  if(!match)return {addresses,status:'NO_FURTHER_STANDARD_CLONE'};
  const next='0x'+match[1].toLowerCase();
  if(seen.has(next))return {addresses,status:'CYCLE',candidate:next};
  code=await deployed(next);
  if(!code)return {addresses,status:'TARGET_CODE_UNAVAILABLE',candidate:next};
  seen.add(next);
  addresses.push(next);
 }
 return {addresses,status:CLONE.test(code)?'DEPTH_LIMIT':'NO_FURTHER_STANDARD_CLONE'};
}
module.exports={resolveClonePath};
