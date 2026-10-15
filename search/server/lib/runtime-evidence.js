'use strict';
// Read-only, chain-scoped architecture observations, never tax/mint inference.
const {chain}=require('./chains'),{addressWord}=require('./admin-getters');
const {nonDelegating}=require('../../../lib/mechanics-runtime');
const keccak=require('../../../lib/keccak');
const ADDRESS=/^0x[0-9a-f]{40}$/i,CODE=/^0x(?:[0-9a-f]{2})+$/i;
const LEGACY='0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3';
const BEACON='0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
const ADMIN='0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
async function inspect({network,address,block,rpc,needArchitecture=true,needAdmin=true}={}){
 const cfg=chain(network),out={};
 if(!ADDRESS.test(address||'')||!/^0x[0-9a-f]+$/i.test(block||'')||typeof rpc!=='function')throw Error('Invalid runtime evidence identity');
 if(!needArchitecture&&!needAdmin)return out;
 const token=address.toLowerCase(),read=(method,params)=>rpc(method,params,{timeoutMs:4500});
 const fact=(value,method,extra={})=>({value,status:'ON_CHAIN',dataState:'DATA_FOUND',chainId:cfg.chainId,network,source:cfg.label+' RPC',evidence:[{chainId:cfg.chainId,network,address:token,block,method,...extra}]});
 let code;try{code=await read('eth_getCode',[token,block]);}catch{return out;}
 if(!CODE.test(code||'')||/^0xef/i.test(code))return out;
 const hash=keccak(Buffer.from(code.slice(2),'hex'));
 if(nonDelegating(code)){
  if(needArchitecture)out.contractArchitecture=fact('NON-PROXY · runtime verified','Conservative complete runtime control-flow inspection',{runtimeCodeHash:hash,scope:'No reachable DELEGATECALL, CALLCODE or SELFDESTRUCT. All valid JUMPDESTs are roots; no metadata stripped. Does not establish external permissions or future chain governance.'});
  // Storage words of a non-delegating runtime must not be treated as a proxy.
  return out;
 }
 const clone=/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code);
 const targetCode=async target=>target&&target!==token&&CODE.test(await read('eth_getCode',[target,block]));
 if(clone){const target='0x'+clone[1].toLowerCase();try{if(needArchitecture&&await targetCode(target))out.contractArchitecture=fact('EIP-1167 minimal proxy','Exact EIP-1167 runtime + pinned target bytecode',{implementation:target,runtimeCodeHash:hash,scope:'Fixed outer clone target; implementation behavior and effective upgrade authority remain unverified.'});}catch{}return out;}
 // Unknown delegating runtimes may use the legacy ZeppelinOS or beacon layout.
 const slots=await Promise.allSettled([...(needArchitecture?[LEGACY,BEACON]:[]),...(needAdmin?[ADMIN]:[])].map(slot=>read('eth_getStorageAt',[token,slot,block])));
 const values=slots.map(r=>r.status==='fulfilled'?addressWord(r.value):null);
 if(needArchitecture){
  const [legacy,beacon]=values;
  try{if(legacy&&await targetCode(legacy))out.contractArchitecture=fact('Legacy implementation slot: '+legacy,'ZeppelinOS implementation slot + pinned implementation bytecode',{slot:LEGACY,runtimeCodeHash:hash,scope:'Observed implementation slot; upgrade permissions are not established.'});}catch{}
  if(!out.contractArchitecture&&beacon)try{if(await targetCode(beacon)){const impl=addressWord(await read('eth_call',[{to:beacon,data:'0x5c60da1b'},block]));if(impl&&await targetCode(impl))out.contractArchitecture=fact('Beacon implementation: '+impl,'EIP-1967 beacon slot + implementation() + pinned bytecode',{beacon,implementation:impl,slot:BEACON,runtimeCodeHash:hash,scope:'Observed beacon/implementation contracts; upgrade authority remains unverified.'});}}catch{}
 }
 const admin=needAdmin?values[needArchitecture?2:0]:null;
 if(admin)out.ownerAdmin=fact('Proxy admin slot: '+admin,'EIP-1967 admin slot',{slot:ADMIN,runtimeCodeHash:hash,scope:'Stored admin address on a delegating runtime; not a complete authority audit.'});
 return out;
}
module.exports={inspect,LEGACY,BEACON,ADMIN};
