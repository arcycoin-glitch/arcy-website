'use strict';
// Optional, read-only pinned-block getters when existing owner() / EIP-1967
// checks fail to establish evidence. This reports getter observations only;
// it does NOT claim a complete admin model or prove proxy upgrade permissions.
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const WORD=/^0x[0-9a-f]{64}$/i;
const CHAIN=Object.freeze({ethereum:1,robinhood:4663});
const GETTERS=Object.freeze({admin:'0xf851a440',implementation:'0x5c60da1b'});
function addressWord(word){
 if(typeof word!=='string'||!WORD.test(word)||!/^0{24}$/i.test(word.slice(2,26)))return null;
 const address='0x'+word.slice(-40).toLowerCase();
 return /^0x0{40}$/.test(address)?null:address;
}
function field(value,network,token,block,method,notes){
 const chainId=CHAIN[network],source=(network==='ethereum'?'Ethereum':'Robinhood')+' RPC';
 return {value,status:'GETTER_REPORTED',dataState:'DATA_FOUND',chainId,network,
  source,evidence:[{chainId,network,address:token,block,method,scope:notes}]};
}
async function inspect({network,address,block,rpc,needAdmin=true,needImplementation=true}={}){
 if(!Object.hasOwn(CHAIN,network)||typeof address!=='string'||!ADDRESS.test(address)||
    typeof block!=='string'||!/^0x[0-9a-f]+$/i.test(block)||
    typeof rpc!=='function')throw Error('Invalid pinned on-chain getter request');
 const token=address.toLowerCase(),out={};
 const requested=[...(needAdmin?['admin']:[]),...(needImplementation?['implementation']:[])];
 if(!requested.length)return out;
 const answers=await Promise.allSettled(requested.map(key=>
  rpc('eth_call',[{to:token,data:GETTERS[key]},block],{timeoutMs:5000})));
 const values=Object.fromEntries(requested.map((key,i)=>[
  key,answers[i].status==='fulfilled'?addressWord(answers[i].value):null]));
 if(values.admin)out.ownerAdmin=field('admin() getter: '+values.admin,network,token,block,
  'admin()','A contract getter reports an address; it does not prove all roles or that permissions are active.');
 if(values.implementation&&values.implementation!==token){
  // Avoid treating arbitrary 32-byte getter results as a deployed implementation.
  try{
   const code=await rpc('eth_getCode',[values.implementation,block],{timeoutMs:5000});
   if(typeof code==='string'&&/^0x(?:[0-9a-f]{2})+$/i.test(code)&&code!=='0x')
    out.contractArchitecture=field('implementation() getter: '+values.implementation,
     network,token,block,'implementation() + eth_getCode',
     'Implementation getter reports a contract with bytecode at the same block. Proxy type and upgrade authority remain unverified.');
  }catch{} // Keep unknown if the implementation cannot be confirmed at the pinned block.
 }
 return out;
}
module.exports={inspect,addressWord,GETTERS};
