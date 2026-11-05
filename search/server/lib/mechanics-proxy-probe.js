'use strict';
// Differential delegation proof (read-only eth_call; nothing is sent on-chain). Probe code 0x30 60 00 52 60 20 60 00 f3 returns
// ADDRESS(): under DELEGATECALL that is the PROXY's own address. Proof requires (1) the override call returns exactly the proxy
// address word and (2) the identical call WITHOUT the override does not. Any RPC error, unsupported override or ambiguous
// result fails closed (null). The selector is unused by design; the caller is a fixed non-admin address.
const PROBE_CODE='0x3060005260206000f3',PROBE_TARGET='0x00000000000000000000000000000000a5c0de01',PROBE_FROM='0x00000000000000000000000000000000a5c0de02';
const PROBE_SELECTOR=require('../../../lib/keccak')(Buffer.from('arcyDelegationProbe()')).slice(0,10);
async function delegationProbe({read,address,slot,block}){
 const tx={from:PROBE_FROM,to:address,data:PROBE_SELECTOR},expected='0x'+address.slice(2).toLowerCase().padStart(64,'0');
 let plain;try{plain=await read('eth_call',[tx,block]);}catch{plain=null;} // a revert is the expected baseline
 if(typeof plain==='string'&&plain.toLowerCase()===expected)return null; // ambiguous: runtime already answers with its own address
 let redirected;try{redirected=await read('eth_call',[tx,block,{[address]:{stateDiff:{[slot]:'0x'+PROBE_TARGET.slice(2).padStart(64,'0')}},[PROBE_TARGET]:{code:PROBE_CODE}}]);}catch{return null;}
 if(typeof redirected!=='string'||redirected.toLowerCase()!==expected)return null;
 return {method:'eth_call state override',selector:PROBE_SELECTOR,caller:PROBE_FROM,slot,baseline:plain===null?'REVERTED':'DIFFERENT_RESULT',redirected:'PROXY_ADDRESS_CONTEXT'};
}
module.exports={delegationProbe,PROBE_CODE,PROBE_TARGET,PROBE_FROM,PROBE_SELECTOR};
