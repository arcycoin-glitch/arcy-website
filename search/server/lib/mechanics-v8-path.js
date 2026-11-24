'use strict';
const CANONICAL=/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i;
const SOLADY=/^0x3d3d3d3d363d3d37363d73([0-9a-f]{40})5af43d3d93803e602a57fd5bf3$/i;
function cloneTarget(code){
 const canonical=CANONICAL.exec(code||''),solady=canonical?null:SOLADY.exec(code||'');
 const match=canonical||solady;
 return match?{address:'0x'+match[1].toLowerCase(),kind:canonical?'EIP-1167 minimal proxy':'Minimal proxy (Solady LibClone, 44-byte)'}:null;
}
// Only follow targets encoded in exact runtime. Storage-based pointers belong
// to the original delegatecall context, never the child proxy address.
async function resolveClonePath({address,target,targetCode,deployed}) {
 if(address===target)return {addresses:[address],status:'CYCLE',candidate:target};
 const addresses=[address,target],seen=new Set(addresses);
 let code=targetCode;
 for(let i=0;i<3;i++){
  const next=cloneTarget(code)?.address;
  if(!next)return {addresses,status:'NO_FURTHER_STANDARD_CLONE'};
  if(seen.has(next))return {addresses,status:'CYCLE',candidate:next};
  code=await deployed(next);
  if(!code)return {addresses,status:'TARGET_CODE_UNAVAILABLE',candidate:next};
  seen.add(next);
  addresses.push(next);
 }
 return {addresses,status:cloneTarget(code)?'DEPTH_LIMIT':'NO_FURTHER_STANDARD_CLONE'};
}
module.exports={resolveClonePath,cloneTarget};
